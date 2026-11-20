import type { Company, Customer, EstimateWithItems } from "@workspace/db";
import { ESTIMATE_EXPIRATION_DAYS, formatEstimateNumber } from "@workspace/shared";
import { buildEstimateApprovalEmail, ESTIMATE_PREVIEW_LINK } from "../email-service";
import { addDays, fmtDate } from "../estimate-pdf-html";
import { estimatePdfAttachmentFilename, estimatePdfForPendingSend, generateEstimatePdfForEmail } from "../estimate-pdf-service";
import { senderFromCompany } from "../lib/company-sender";
import {
  estimateOwnershipMatches, requireEstimateBranchForSend, requireEstimateApprovalAccess, requireResendRole,
} from "../routes/estimate-role-guards";
import type { EstimateRouteDeps } from "../routes/estimate-routes";
import { storage } from "../storage";
import { estimateEmailData, nextEstimateSendTime, sendEstimateApprovalEmailFlow, type EstimateSendStorage } from "./estimate-send-flow";
import { OutgoingEmailError, type OutgoingEmailHandler } from "./types";

const PLACEHOLDER_LINKS = {
  approveUrl: ESTIMATE_PREVIEW_LINK,
  rejectUrl: ESTIMATE_PREVIEW_LINK,
  viewUrl: ESTIMATE_PREVIEW_LINK,
};
const noRecipient = "This estimate has no customer email. Enter one before sending.";

interface EstimateEmailEntity {
  estimate: EstimateWithItems;
  customer: Customer | undefined;
  company: Company | null;
  now: Date;
}

type EstimateEmailDeps = Pick<EstimateRouteDeps, "recordLifecycleAudit" | "recordAuditEvent"> & {
  storage: EstimateSendStorage & Pick<typeof storage, "getCustomer" | "getCompanyProfile">;
  now?: () => Date;
};

function templateData({ estimate, customer, company, now }: EstimateEmailEntity, note: string) {
  return estimateEmailData(estimate, estimate.lifecycleStatus === "expired" ? now : new Date(estimate.estimateDate), {
    sender: senderFromCompany(company ?? undefined),
    companyProfile: company,
    customerLabel: customer?.irrigoName ?? customer?.name ?? estimate.customerName,
    note,
  });
}

function attachmentInputs({ estimate, company, now }: EstimateEmailEntity) {
  return estimatePdfForPendingSend(estimate, company, now, estimate.lifecycleStatus === "expired");
}

function attachmentVersion(entity: EstimateEmailEntity) {
  const pdf = attachmentInputs(entity);
  const company = pdf.company;
  // Some edits do not bump updatedAt, and some fields (including site
  // photos and access instructions) are only printed on the PDF.
  // Bind the complete estimate and line-item snapshot plus the company
  // details used by the renderer. Bind prospective printed dates, not
  // the exact clock time: a same-day send must keep its true sent time,
  // but crossing a day boundary must require a new review.
  return JSON.stringify([
    entity.estimate, company?.name, company?.address, company?.email, company?.phone, company?.logo,
    fmtDate(pdf.estimate.estimateDate), fmtDate(addDays(pdf.sentAt, ESTIMATE_EXPIRATION_DAYS)),
  ]);
}

export function createEstimateEmailHandler(
  kind: "estimate" | "estimate_resend",
  deps: EstimateEmailDeps = { storage },
): OutgoingEmailHandler<EstimateEmailEntity> {
  const resend = kind === "estimate_resend";
  return {
    kind,
    capabilities: [resend ? requireResendRole : requireEstimateApprovalAccess, requireEstimateBranchForSend(deps.storage)],
    options: [{ key: "attachPdf", label: "Attach the estimate as a PDF", default: true }],
    noRecipientMessage: noRecipient,
    async load(req, id) {
      const estimate = await deps.storage.getEstimate(id);
      if (!estimate || !estimateOwnershipMatches(req, estimate.companyId)) return null;
      const lc = estimate.lifecycleStatus;
      if (resend) {
        if (lc !== "sent" && lc !== "expired") return null;
      } else if (
        lc === "sent" || lc === "expired" || lc === "approved" || lc === "rejected" ||
        estimate.status !== "pending" ||
        (estimate.internalStatus !== "pending_approval" && estimate.internalStatus !== "approved_internal")
      ) {
        return null;
      }
      const customer = estimate.customerId == null ? undefined : await deps.storage.getCustomer(estimate.customerId);
      if (customer && customer.companyId !== estimate.companyId) return null;
      const company = estimate.companyId == null ? null : await deps.storage.getCompanyProfile(estimate.companyId);
      return { estimate, customer, company: company ?? null, now: nextEstimateSendTime(estimate, deps.now?.() ?? new Date()) };
    },
    async draft(entity, input) {
      const { estimate, customer, company } = entity;
      const attachPdf = input.options?.attachPdf ?? true;
      const note = input.note ?? "";
      const data = templateData(entity, note);
      const built = await buildEstimateApprovalEmail(data, PLACEHOLDER_LINKS);
      const to = input.to || customer?.email?.trim() || estimate.customerEmail?.trim() || "";
      const warnings: string[] = [];
      if (resend) {
        warnings.push(estimate.lifecycleStatus === "expired"
          ? "The estimate date will be reset and the 30-day window restarted from today's send."
          : "The estimate date and approval link remain unchanged, and the 30-day window restarts from today's send.");
      }
      if (!data.sender.usingCompanyAddress && company?.emailFromAddress?.trim()) {
        warnings.push(`Your sending address isn't authenticated yet, so this goes from ${data.sender.from.email} on your behalf.`);
      }
      if (!to) warnings.push(noRecipient);
      return {
        ...built, sender: data.sender, to, cc: input.cc ?? [], bcc: input.bcc ?? [], note,
        subject: input.subject || built.subject,
        attachments: attachPdf
          ? [{ filename: estimatePdfAttachmentFilename(estimate.estimateNumber), viewUrl: `/api/outgoing-email/${kind}/${estimate.id}/attachment` }]
          : [],
        warnings, options: { attachPdf }, variant: null,
        versionStamp: [
          estimate.updatedAt.toISOString(), estimate.approvalSentAt?.toISOString(), estimate.lifecycleStatus, estimate.totalAmount,
          attachPdf ? attachmentVersion(entity) : "no-pdf",
        ].join("|"),
      };
    },
    async renderAttachment(entity) {
      const file = await generateEstimatePdfForEmail(deps.storage, entity.estimate.id, attachmentInputs(entity));
      if (!file) throw new OutgoingEmailError(500, "Could not preview the estimate PDF.");
      return file;
    },
    async send(entity, draft, req) {
      const { estimate, now } = entity;
      const resetEstimateDate = resend && estimate.lifecycleStatus === "expired";
      const { estimate: fresh, sentAt, sentTo } = await sendEstimateApprovalEmailFlow(deps.storage, estimate.id, {
        resetEstimateDate,
        isSentRedelivery: resend && estimate.lifecycleStatus === "sent",
        to: draft.to, cc: draft.cc, bcc: draft.bcc, note: draft.note,
        attachPdf: draft.options.attachPdf, subject: draft.subject, req,
        reviewed: { estimate, data: templateData(entity, draft.note), sentAt: now },
        recordAuditEvent: deps.recordAuditEvent,
      });
      if (resend) {
        // Task #641 — audit the resend so the Activity tab shows it.
        await deps.recordLifecycleAudit?.(req, {
          resource: "estimate",
          action: "estimate.resent",
          targetId: estimate.id,
          companyId: estimate.companyId ?? null,
          before: { status: estimate.status, internalStatus: estimate.internalStatus },
          after: { status: fresh.status, internalStatus: fresh.internalStatus },
          summary: resetEstimateDate
            ? `Estimate ${estimate.estimateNumber ? formatEstimateNumber(estimate.estimateNumber) : estimate.id} resent after expiration`
            : `Estimate ${estimate.estimateNumber ? formatEstimateNumber(estimate.estimateNumber) : estimate.id} re-delivered to customer`,
        });
      }
      return { sentAt, sentTo };
    },
  };
}
