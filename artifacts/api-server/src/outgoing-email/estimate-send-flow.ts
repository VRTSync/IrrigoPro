import type { Request } from "express";
import { randomBytes, randomUUID } from "node:crypto";
import type { EstimateWithItems } from "@workspace/db";
import { formatEstimateNumber } from "@workspace/shared";
import type { EstimateEmailData } from "../email-service";
import { isInspectionOriginEstimate } from "../estimate-pdf-html";
import { resolveCompanySender } from "../lib/company-sender";
import { logger } from "../lib/logger";
import { recordAuditEvent as defaultRecordAuditEvent } from "../routes/audit-log";
import type { IStorage } from "../storage";
import { OutgoingEmailError } from "./types";

export type EstimateSendStorage = Pick<IStorage,
  "getEstimate" | "getCompany" | "claimEstimateEmailSend" | "releaseEstimateEmailSend" | "markEstimateSentToCustomer"
>;

export const ESTIMATE_SEND_BLOCKED =
  "An estimate email is already being sent or its delivery could not be confirmed. Verify delivery before trying again.";

export function nextEstimateSendTime(estimate: EstimateWithItems, now: Date): Date {
  // Re-delivery keeps the same token. Its new send timestamp must still
  // invalidate all outstanding reviews of the previous delivery.
  return new Date(Math.max(now.getTime(), (estimate.approvalSentAt?.getTime() ?? -Infinity) + 1));
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

// Claim before contacting SendGrid, then stamp the customer-facing state only
// after acceptance. An ambiguous outcome leaves the claim in place indefinitely.
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
  if (!estimateWithItems || estimateWithItems.id !== estimateId) throw new Error(`Estimate ${estimateId} not found`);

  // Task #365 — for sent re-delivery, reuse the existing approval token so
  // the customer's previously shared link remains valid. Only refresh expiry.
  // For expired resend and first send, always mint a new token.
  const approvalToken = opts.isSentRedelivery && estimateWithItems.approvalToken
    ? (estimateWithItems.approvalToken as string)
    : randomBytes(32).toString("hex");
  // Task #1955 — one send timestamp for the whole flow. It is the
  // expiry clock, so the PDF we attach below and the row we persist
  // after a successful send must agree on it exactly.
  const sentAt = opts.reviewed?.sentAt ?? nextEstimateSendTime(estimateWithItems, new Date());
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

  const { EmailService, EstimateEmailNotSubmittedError } = await import("../email-service");

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
  const companyId = estimateWithItems.companyId;
  const attemptId = randomUUID();
  const mode = opts.resetEstimateDate ? "resend" : opts.isSentRedelivery ? "redelivery" : "first";
  const claim = await storage.claimEstimateEmailSend(estimateWithItems, attemptId, mode);
  if (claim === "blocked") throw new OutgoingEmailError(409, ESTIMATE_SEND_BLOCKED);
  if (claim === "changed") {
    throw new OutgoingEmailError(409, "The estimate changed after you reviewed it. Review it again before sending. Nothing was sent by this request.");
  }

  const log = opts.req?.log ?? logger;
  try {
    await EmailService.sendEstimateApprovalEmail({
      ...data, approvalToken, subject: opts.subject, to: resolvedTo, cc: resolvedCc,
      bcc: resolvedBcc, attachments: pdfAttachments, deliveryAttemptId: attemptId,
      attachmentFilename: pdfAttachments?.[0]?.filename,
    });
  } catch (error) {
    if (error instanceof EstimateEmailNotSubmittedError) {
      await storage.releaseEstimateEmailSend(estimateId, companyId, attemptId);
      throw new OutgoingEmailError(500, error.message);
    }
    log.warn({ estimateId, companyId, attemptId }, "Could not confirm estimate email delivery; claim retained");
    throw new OutgoingEmailError(502, "The email provider may have accepted this estimate email. Verify delivery before trying again.");
  }

  let persisted;
  try {
    persisted = await storage.markEstimateSentToCustomer(estimateId, {
      companyId,
      deliveryAttemptId: attemptId,
      approvalToken,
      tokenExpiresAt,
      approvalSentAt: sentAt,
      previousApprovalToken: estimateWithItems.approvalToken ?? null,
      newEstimateDate: opts.resetEstimateDate ? effectiveEstimateDate : null,
      isResend: !!opts.resetEstimateDate,
      isSentRedelivery: !!opts.isSentRedelivery,
      sentToEmail: resolvedTo,
    });
    if (!persisted) throw new Error("Estimate no longer matches the send transition");
  } catch (err) {
    // A query error can include parameters such as the new approval token.
    log.error({ errorType: err instanceof Error ? err.name : "unknown", estimateId, companyId, attemptId },
      "SendGrid accepted estimate email but its state update could not be confirmed");
    throw new OutgoingEmailError(500, "The email provider accepted this estimate email, but the estimate update could not be confirmed. Verify delivery before trying again.");
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
