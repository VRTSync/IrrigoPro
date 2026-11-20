import type { Request } from "express";
import type { EstimateWithItems } from "@workspace/db";
import { formatEstimateNumber } from "@workspace/shared";
import type { EstimateEmailData } from "../email-service";
import { isInspectionOriginEstimate } from "../estimate-pdf-html";
import { resolveCompanySender } from "../lib/company-sender";
import { recordAuditEvent as defaultRecordAuditEvent } from "../routes/audit-log";
import type { IStorage } from "../storage";
import { OutgoingEmailError } from "./types";

export type EstimateSendStorage = Pick<IStorage, "getEstimate" | "getCompany" | "markEstimateSentToCustomer">;

// Task #611 — typed error thrown by `sendEstimateApprovalEmailFlow`
// when the CAS-style "mark sent to customer" update matches zero
// rows (i.e. someone else won a concurrent send-to-customer race
// or the estimate moved out of a sendable state between the
// route's precheck and the DB write). The route layer catches it
// and returns 409 instead of the generic 500.
export class EstimateSendConflictError extends OutgoingEmailError {
  constructor(message: string) {
    super(409, message);
    this.name = "EstimateSendConflictError";
  }
}

// Share the estimate snapshot and template inputs between preview and delivery.
export function estimateEmailData(
  estimateWithItems: EstimateWithItems,
  effectiveEstimateDate: Date,
  delivery: Pick<EstimateEmailData, "sender" | "note" | "companyProfile"> & { customerLabel?: string },
): EstimateEmailData {
  const items = estimateWithItems.items ?? [];
  const laborRate = parseFloat(estimateWithItems.laborRate);
  const isInspectionOrigin = isInspectionOriginEstimate(items);
  return {
    ...delivery,
    estimateId: estimateWithItems.id,
    estimateNumber: estimateWithItems.estimateNumber,
    customerName: estimateWithItems.customerName,
    customerLabel: delivery.customerLabel ?? estimateWithItems.customerName,
    customerEmail: estimateWithItems.customerEmail,
    projectName: estimateWithItems.projectName,
    projectAddress: estimateWithItems.projectAddress || undefined,
    // Task #2010 — branch location on the approval email.
    branchName: (estimateWithItems as unknown as { branchName?: string | null }).branchName ?? null,
    workLocationLat: estimateWithItems.workLocationLat ?? null,
    workLocationLng: estimateWithItems.workLocationLng ?? null,
    workLocationAddress: estimateWithItems.workLocationAddress ?? null,
    controllerLetter: estimateWithItems.controllerLetter ?? null,
    zoneNumber: estimateWithItems.zoneNumber ?? null,
    totalAmount: `$${parseFloat(estimateWithItems.totalAmount).toFixed(2)}`,
    partsSubtotal: parseFloat(estimateWithItems.partsSubtotal) || 0,
    laborSubtotal: parseFloat(estimateWithItems.laborSubtotal) || 0,
    totalLaborHours: parseFloat(estimateWithItems.totalLaborHours) || 0,
    laborRate,
    isInspectionOrigin,
    approvalToken: "",
    estimateDate: effectiveEstimateDate.toLocaleDateString(),
    createdBy: estimateWithItems.createdBy,
    companyId: estimateWithItems.companyId!,
    workDescription: estimateWithItems.workDescription ?? null,
    items: items.map((item) => ({
      description: item.description || item.partName,
      partName: item.partName,
      quantity: item.quantity,
      partPrice: parseFloat(item.partPrice),
      laborHours: parseFloat(item.laborHours),
      partsCost: parseFloat(item.totalPrice),
      laborCost: parseFloat(item.laborHours) * laborRate,
      lineTotal: parseFloat(item.totalPrice) + parseFloat(item.laborHours) * laborRate,
      controllerLetter: item.controllerLetter ?? null,
      zoneNumber: item.zoneNumber ?? null,
      issueType: item.issueType ?? null,
    })),
  };
}

// Send approval email to customer
// Shared helper for first delivery and resend after review. Token generation, the
// `approvalSentAt` / `internalStatus = sent_to_customer` write, and the
// SendGrid send all live in one place. Optionally also resets
// `estimateDate` (used by `resend` to clear the expired bucket).
//
// Task #611 — the flow is now email-first: the token is generated in
// memory, the customer email is sent, and only then is the DB row
// marked `sent_to_customer` / stamped with the token. Previously the
// DB write committed first, so a SendGrid failure left the estimate
// marked sent with a token the customer never saw. With the order
// reversed, a transient send failure leaves the estimate in its
// pre-send internal status and the user can retry the single
// "Send to customer" action cleanly.
export async function sendEstimateApprovalEmailFlow(
  storage: EstimateSendStorage,
  estimateId: number,
  opts: {
    resetEstimateDate?: boolean;
    // Task #365 — re-deliver a non-expired sent estimate without
    // resetting estimateDate. Passed through to markEstimateSentToCustomer
    // so the CAS WHERE clause allows internalStatus='sent_to_customer'.
    isSentRedelivery?: boolean;
    to?: string;
    cc?: string[];
    bcc?: string[];
    note?: string;
    // Task #1791 — when true, generate the estimate PDF and attach it to
    // the outgoing SendGrid email as a base64-encoded PDF file.
    attachPdf?: boolean;
    subject?: string;
    req?: Request;
    reviewed?: { estimate: EstimateWithItems; data: EstimateEmailData; sentAt: Date };
    recordAuditEvent?: typeof defaultRecordAuditEvent;
  } = {},
) {
  const estimateWithItems = opts.reviewed?.estimate ?? await storage.getEstimate(estimateId);
  if (!estimateWithItems) throw new Error(`Estimate ${estimateId} not found`);

  const crypto = await import("crypto");
  // Task #365 — for sent re-delivery, reuse the existing approval token so
  // the customer's previously shared link remains valid. Only refresh expiry.
  // For expired resend and first send, always mint a new token.
  const approvalToken = opts.isSentRedelivery && estimateWithItems.approvalToken
    ? (estimateWithItems.approvalToken as string)
    : crypto.randomBytes(32).toString("hex");
  // Task #1955 — one send timestamp for the whole flow. It is the
  // expiry clock, so the PDF we attach below and the row we persist
  // after a successful send must agree on it exactly.
  const sentAt = opts.reviewed?.sentAt ?? new Date();
  const tokenExpiresAt = new Date(sentAt);
  tokenExpiresAt.setDate(tokenExpiresAt.getDate() + 30);

  // If we're going to reset `estimateDate` (the `resend` flow), use the
  // new value in the email body so the customer sees today's date
  // matching what we're about to persist.
  const effectiveEstimateDate = opts.resetEstimateDate
    ? new Date(sentAt)
    : new Date(estimateWithItems.estimateDate);

  const resolvedTo = (opts.to && opts.to.trim()) || estimateWithItems.customerEmail;
  const resolvedCc = (opts.cc ?? []).filter((s) => s && s.trim().length > 0);
  const resolvedBcc = (opts.bcc ?? []).filter((s) => s && s.trim().length > 0);

  const { EmailService } = await import("../email-service");

  // Task #1791 — generate PDF buffer for attachment when opted in.
  let pdfAttachments: Array<{
    content: string;
    filename: string;
    type: string;
    disposition: 'attachment';
  }> | undefined;
  if (opts.attachPdf) {
    const { generateEstimatePdfForEmail, estimatePdfForPendingSend } = await import("../estimate-pdf-service");
    const pdfResult = await generateEstimatePdfForEmail(
      storage,
      estimateId,
      // Task #1955 — the attached PDF must state the window the
      // customer is being given by *this* send, not the one from the
      // previous send still stored on the row. The same `sentAt` is
      // persisted below once the email succeeds.
      estimatePdfForPendingSend(estimateWithItems, opts.reviewed?.data.companyProfile, sentAt, !!opts.resetEstimateDate),
    );
    if (!pdfResult) {
      throw new OutgoingEmailError(500, "Could not generate the estimate PDF. Nothing was sent.");
    }
    pdfAttachments = [{
      content: pdfResult.buffer.toString('base64'),
      filename: pdfResult.filename,
      type: 'application/pdf',
      disposition: 'attachment',
    }];
  }

  const data = opts.reviewed?.data ?? estimateEmailData(estimateWithItems, effectiveEstimateDate, {
    sender: await resolveCompanySender(estimateWithItems.companyId),
    note: opts.note,
  });
  try {
    await EmailService.sendEstimateApprovalEmail({
      ...data, approvalToken, subject: opts.subject, to: resolvedTo, cc: resolvedCc,
      bcc: resolvedBcc, attachments: pdfAttachments,
    });
  } catch (error) {
    throw new OutgoingEmailError(500, error instanceof Error ? error.message : "Failed to send estimate email");
  }

  // Email send succeeded — persist the transition via a single
  // conditional UPDATE (Task #611). The WHERE clause pins
  // internalStatus to a pre-send value (or `status='expired'` for
  // resend), so two concurrent send-to-customer requests can't
  // both stamp tokens: the second writer matches zero rows and we
  // throw EstimateSendConflictError, which the route layer maps
  // to 409. The cost is a redundant email going out for the loser
  // of the race — preferable to burying a stale token in the DB.
  const persisted = await storage.markEstimateSentToCustomer(estimateId, {
    approvalToken,
    tokenExpiresAt,
    approvalSentAt: sentAt,
    // Task #1955 — compare-and-swap value for the resend path (the row
    // that was read at the top of this flow must still be the one on
    // disk, or a concurrent send already won).
    previousApprovalToken: (estimateWithItems.approvalToken as string | null) ?? null,
    newEstimateDate: opts.resetEstimateDate ? effectiveEstimateDate : null,
    isResend: !!opts.resetEstimateDate,
    isSentRedelivery: !!opts.isSentRedelivery,
    // Task #1574 — persist actual delivery address so the rejection
    // audit log records the right recipient even when the send modal's
    // "To" field was overridden.
    sentToEmail: resolvedTo,
  });
  if (!persisted) {
    throw new EstimateSendConflictError(
      opts.resetEstimateDate
        ? "Estimate is no longer in an expired state and cannot be resent"
        : opts.isSentRedelivery
          ? "Estimate is no longer in a sent state and cannot be re-delivered"
          : "Estimate has already been sent to the customer",
    );
  }

  // Task #616 — record a single audit row per send so managers can
  // see in the estimate's history exactly who sent it, to which
  // addresses, and when.
  if (opts.req) {
    const req = opts.req;
    await (opts.recordAuditEvent ?? defaultRecordAuditEvent)(req, {
      actorUserId: req.authenticatedUserId ?? null,
      actorLabel: (req as Request & { authenticatedUserName?: string }).authenticatedUserName ?? null,
      actorRole: req.authenticatedUserRole ?? null,
      actorCompanyId: req.authenticatedUserCompanyId ?? null,
      actionType: "data",
      action: "estimate.email.sent",
      severity: "info",
      targetType: "estimate",
      targetId: String(estimateId),
      summary: `Estimate ${formatEstimateNumber(estimateWithItems.estimateNumber)} sent to ${resolvedTo}`,
      details: {
        estimateId,
        estimateNumber: estimateWithItems.estimateNumber,
        to: resolvedTo,
        cc: resolvedCc,
        bcc: resolvedBcc,
        hasNote: !!(opts.note && opts.note.trim()),
      },
    });
  }

  return { estimate: persisted, sentAt, sentTo: resolvedTo };
}
