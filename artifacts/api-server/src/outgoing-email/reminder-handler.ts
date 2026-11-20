import { REMINDER_TEMPLATE_KEYS, REMINDER_TEMPLATE_LABELS } from "../invoice-reminder-templates";
import {
  evaluateReminderEligibility, isReminderTemplateChoice, resolveTemplateChoice, throttleMessage,
  type ReminderContext, type ReminderCore,
} from "../routes/invoice-reminder-routes";
import { requireInvoiceSend } from "../routes/role-guards";
import { OutgoingEmailError, type OutgoingEmailHandler } from "./types";

export function createReminderEmailHandler(core: ReminderCore): OutgoingEmailHandler<ReminderContext> {
  return {
    kind: "invoice_reminder",
    capabilities: [requireInvoiceSend],
    variants: [
      { key: "suggested", label: "Suggested for this invoice" },
      ...REMINDER_TEMPLATE_KEYS.map(key => ({ key, label: REMINDER_TEMPLATE_LABELS[key] })),
    ],
    defaultVariant: "suggested",
    load: (req, id) => core.resolveContext(req, id),
    async draft(ctx, input, req) {
      if (ctx.refusal) {
        const { message, reason, action } = ctx.refusal;
        throw new OutgoingEmailError(422, message, { reason, action });
      }
      const { invoice, pdf } = ctx;
      const throttle = await core.throttleFor(invoice.id, invoice.companyId, ctx.now);
      if (throttle.throttled) {
        throw new OutgoingEmailError(422, throttleMessage(invoice.invoiceNumber, throttle), {
          reason: "throttled", lastSentAt: throttle.lastSentAt?.toISOString() ?? null,
          nextAllowedAt: throttle.nextAllowedAt?.toISOString() ?? null, windowDays: throttle.windowDays,
        });
      }
      if (!await core.hasSavedCopy(ctx)) {
        const { message, reason, action } = evaluateReminderEligibility({ invoice, recipientEmail: ctx.recipientEmail, hasStoredPdf: false })!;
        throw new OutgoingEmailError(422, message, { reason, action });
      }
      const variant = input.variant ?? "suggested";
      if (!isReminderTemplateChoice(variant)) throw new OutgoingEmailError(400, "Unknown email template.");
      const [company, sender, versionStamp] = await Promise.all([
        core.companyFor(ctx), core.senderFor(ctx), core.versionStamp(req, ctx),
      ]);
      const note = input.note ?? "";
      const rendered = await core.renderOne(ctx, resolveTemplateChoice(variant, ctx.agingBucket), company, note);
      return {
        ...rendered,
        variant, versionStamp, sender, note, to: input.to || ctx.recipientEmail!,
        cc: input.cc ?? [], bcc: input.bcc ?? [], subject: input.subject || rendered.subject,
        attachments: [{ filename: pdf!.filename, viewUrl: `/api/invoices/${invoice.id}/sent-copy` }],
        warnings: [], options: {},
      };
    },
    async send(ctx, draft, req) {
      if (!isReminderTemplateChoice(draft.variant)) throw new OutgoingEmailError(400, "Unknown email template.");
      const { to, cc, bcc, subject, note } = draft;
      const result = await core.sendOne(req, ctx.invoice.id, draft.variant, { to, cc, bcc, subject, note, reviewed: draft });
      if (result.outcome === "not_found") throw new OutgoingEmailError(404, "Invoice not found.");
      if (result.outcome === "skipped") {
        throw new OutgoingEmailError(409, result.message, { reason: result.reason, action: result.refusal?.action });
      }
      if (result.outcome === "failed") throw new OutgoingEmailError(502, result.error, { reason: "send_failed", reminder: result.reminder });
      return { sentTo: result.recipientEmail, sentAt: new Date(result.reminder.sentAt) };
    },
  };
}
