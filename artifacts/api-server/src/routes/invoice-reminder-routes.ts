import { resolveCompanySender, type CompanySender } from "../lib/company-sender";
// Task #1887 — invoice payment reminders.
//
//   GET  /api/invoices/:id/reminders  — history + whether a reminder can be
//                                       sent right now, and if not, why not.
//
// This is the one endpoint in the product where a misclick reaches a
// customer's inbox, so three rules shape the whole module:
//
//   1. The invoice is resolved through the company-scoped fetch BEFORE
//      anything else happens. A bookkeeper in company A asking about a
//      company B invoice gets a 404 and no mailer call is ever made.
//   2. Every refusal has its own message, and the two that a bookkeeper can
//      actually fix name the action that fixes them. A dead button that says
//      "PDF not found" is the failure this work exists to delete.
//   3. Nothing is silent. A throttled request answers with the date the next
//      reminder is allowed — the payment-sync refresh button already taught us
//      what a silent no-op costs.
//
// Nothing here runs on a schedule. Every reminder is a person pressing send.

import type { Express, RequestHandler } from "express";
import type { Company, Customer, Invoice, InvoicePdf } from "@workspace/db";
import { storage as storageModule } from "../storage";
import {
  classifyAgingBucket,
  computeEffectiveDueDate,
  daysOverdue as daysOverdueOf,
  resolveBalanceDue,
  type AgingBucketKey,
} from "@workspace/shared";
import {
  isReminderTemplateKey,
  renderReminderEmail,
  suggestTemplateKey,
  REMINDER_EMAIL_KEY,
  REMINDER_TEMPLATE_KEYS,
  REMINDER_TEMPLATE_LABELS,
  type RenderedReminder,
  type ReminderTemplateKey,
} from "../invoice-reminder-templates";
import { EmailService } from "../email-service";
import { billingDateRange } from "../outgoing-email/invoice-email-format";
import { OutgoingEmailError, type BuiltDraft } from "../outgoing-email/types";
import { getEmailWording } from "../outgoing-email/wording";
import { invoiceBillingPeriod, readInvoiceSentCopy } from "../invoice-pdf-service";
import { ObjectStorageService } from "../objectStorage";

// ── The refusal matrix ──────────────────────────────────────────────────────

export type ReminderRefusalReason =
  | "paid"
  | "zero_balance"
  | "cancelled"
  | "superseded"
  | "merged"
  | "draft"
  | "no_customer_email"
  | "qb_voided"
  | "never_sent"
  | "no_pdf";

/**
 * A refusal the caller can act on. `action` is present only where there is a
 * next step the bookkeeper can actually take from here; the UI renders it in
 * place of the send button rather than leaving a disabled control behind.
 */
export interface ReminderRefusal {
  reason: ReminderRefusalReason;
  message: string;
  action?: { kind: "send_invoice" | "generate_pdf"; label: string };
}

/** The invoice fields the refusal matrix reads. Structural, so tests can fixture it. */
export interface ReminderInvoiceLike {
  id: number;
  invoiceNumber: string;
  status: string;
  customerEmail?: string | null;
  sentAt?: Date | string | null;
  paidAt?: Date | string | null;
  paymentStatus?: string | null;
  balance?: string | number | null;
  totalAmount: string | number;
  paymentSyncedAt?: Date | string | null;
  qbVoidDetectedAt?: Date | string | null;
}

/**
 * The first thing wrong with sending a reminder for this invoice, or null.
 *
 * The order is the order a person would notice the problems in: money first
 * (it is already paid / there is nothing owed), then lifecycle (this invoice
 * is not the live one), then the three things that make the send itself
 * impossible. Each fixture in the tests trips exactly one.
 */
export function evaluateReminderEligibility(args: {
  invoice: ReminderInvoiceLike;
  hasStoredPdf: boolean;
  recipientEmail?: string | null;
}): ReminderRefusal | null {
  const { invoice, hasStoredPdf } = args;
  const num = `#${invoice.invoiceNumber}`;
  const balance = resolveBalanceDue(invoice);

  if (invoice.status === "paid" || invoice.paymentStatus === "paid" || invoice.paidAt) {
    return {
      reason: "paid",
      message: `Invoice ${num} is already paid in full. There is nothing to remind the customer about.`,
    };
  }
  if (balance <= 0) {
    return {
      reason: "zero_balance",
      message: `Invoice ${num} has a zero balance, so there is nothing outstanding to chase.`,
    };
  }
  if (invoice.status === "cancelled") {
    return {
      reason: "cancelled",
      message: `Invoice ${num} was cancelled. Reissue it if this work is still owed — a cancelled invoice must not be chased.`,
    };
  }
  if (invoice.status === "superseded") {
    return {
      reason: "superseded",
      message: `Invoice ${num} was corrected and superseded. Send the reminder from the replacement invoice, which is the one the customer owes.`,
    };
  }
  if (invoice.status === "merged") {
    return {
      reason: "merged",
      message: `Invoice ${num} was merged into another invoice. Send the reminder from the surviving invoice so the customer sees the amount they actually owe.`,
    };
  }
  if (invoice.status === "draft") {
    return {
      reason: "draft",
      message: `Invoice ${num} is still a draft. Finalise and send it before asking the customer to pay it.`,
    };
  }
  if (!(args.recipientEmail === undefined ? invoice.customerEmail : args.recipientEmail)?.trim()) {
    return {
      reason: "no_customer_email",
      message: `There is no billing email on this customer, so a reminder for invoice ${num} has nowhere to go. Add a billing email to the customer first.`,
    };
  }
  if (invoice.qbVoidDetectedAt) {
    return {
      reason: "qb_voided",
      message: `QuickBooks shows invoice ${num} as voided while it is still open here. Settle which one is right before chasing the customer for it.`,
    };
  }
  // Named alternative #1 — the row's call to action here is *send*, not remind.
  if (!invoice.sentAt) {
    return {
      reason: "never_sent",
      message: `Invoice ${num} has never been sent to the customer. Send the invoice first — chasing payment for an invoice they never received is worse than useless.`,
      action: { kind: "send_invoice", label: "Send the invoice" },
    };
  }
  // Named alternative #2 — reachable in real life: an invoice posted on paper
  // and manually marked sent has `sentAt` and no PDF record at all.
  if (!hasStoredPdf) {
    return {
      reason: "no_pdf",
      message: `Invoice ${num} has no saved PDF, so a reminder would arrive with nothing attached. Generate or send the invoice PDF first, then send the reminder.`,
      action: { kind: "generate_pdf", label: "Generate the PDF first" },
    };
  }
  return null;
}

// ── Throttle ────────────────────────────────────────────────────────────────

/** Used when a company has no configured window. One reminder a week. */
export const DEFAULT_REMINDER_THROTTLE_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ThrottleState {
  windowDays: number;
  lastSentAt: Date | null;
  /** When the next reminder becomes allowed. Null when one is allowed now. */
  nextAllowedAt: Date | null;
  throttled: boolean;
}

/**
 * Same shape as the missing-photos notification throttle: read the last send,
 * compare against a window, and report the timestamp rather than swallowing
 * the request.
 */
export function evaluateThrottle(
  lastSentAt: Date | null,
  windowDays: number,
  now: Date,
): ThrottleState {
  const days = Number.isFinite(windowDays) && windowDays > 0
    ? windowDays
    : DEFAULT_REMINDER_THROTTLE_DAYS;
  if (!lastSentAt) {
    return { windowDays: days, lastSentAt: null, nextAllowedAt: null, throttled: false };
  }
  const nextAllowedAt = new Date(lastSentAt.getTime() + days * MS_PER_DAY);
  const throttled = now.getTime() < nextAllowedAt.getTime();
  return {
    windowDays: days,
    lastSentAt,
    nextAllowedAt: throttled ? nextAllowedAt : null,
    throttled,
  };
}

function formatWhen(d: Date): string {
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

export function throttleMessage(invoiceNumber: string, state: ThrottleState): string {
  const last = state.lastSentAt ? formatWhen(state.lastSentAt) : "recently";
  const next = state.nextAllowedAt ? formatWhen(state.nextAllowedAt) : "shortly";
  return (
    `A reminder for invoice #${invoiceNumber} already went out on ${last}. ` +
    `This company allows one reminder every ${state.windowDays} days, so the next one can be sent on ${next}.`
  );
}

// ── Wire shapes ─────────────────────────────────────────────────────────────

export interface ReminderHistoryRow {
  id: number;
  sentAt: string;
  sentByUserId: number | null;
  sentByName: string | null;
  recipientEmail: string;
  sequenceNumber: number | null;
  templateKey: string;
  templateLabel: string;
  balanceAtSend: string;
  daysOverdueAtSend: number;
  deliveryStatus: string;
  deliveryError: string | null;
}

function toHistoryRow(r: any): ReminderHistoryRow {
  return {
    id: r.id,
    sentAt: new Date(r.sentAt).toISOString(),
    sentByUserId: r.sentByUserId ?? null,
    sentByName: r.sentByName ?? null,
    // Every value below is read straight off the row. Recomputing any of them
    // from today's invoice would rewrite what the customer was told.
    recipientEmail: r.recipientEmail,
    sequenceNumber: r.sequenceNumber ?? null,
    templateKey: r.templateKey,
    templateLabel:
      REMINDER_TEMPLATE_LABELS[r.templateKey as ReminderTemplateKey] ?? r.templateKey,
    balanceAtSend: String(r.balanceAtSend),
    daysOverdueAtSend: Number(r.daysOverdueAtSend),
    deliveryStatus: r.deliveryStatus,
    deliveryError: r.deliveryError ?? null,
  };
}

// ── Template choice ─────────────────────────────────────────────────────────

/**
 * Task #1888 — what tone the caller asked for.
 *
 * A concrete key is the sender saying "this tone, for all of them".
 * `"suggested"` is the sender saying "the tone this module already suggests
 * for each invoice's age" — still an explicit choice, made once, and resolved
 * through {@link suggestTemplateKey}. There is no implicit default: an absent
 * or unrecognised value is refused by the endpoints, exactly as the single
 * send has always refused one.
 */
export type ReminderTemplateChoice = ReminderTemplateKey | "suggested";

export function isReminderTemplateChoice(v: unknown): v is ReminderTemplateChoice {
  return v === "suggested" || isReminderTemplateKey(v);
}

/** The tone one invoice actually gets, given the caller's choice. */
export function resolveTemplateChoice(
  choice: ReminderTemplateChoice,
  bucket: AgingBucketKey,
): ReminderTemplateKey {
  return choice === "suggested" ? suggestTemplateKey(bucket) : choice;
}

// ── Dependencies ────────────────────────────────────────────────────────────

/** The mailer seam. Production is `EmailService.sendInvoiceDetailPdf`. */
export type ReminderMailer = (
  customerEmail: string,
  customerName: string,
  invoiceNumber: string,
  pdfBuffer: Buffer,
  overrides: {
    subject: string;
    html: string;
    text: string;
    sender: CompanySender;
    filename?: string;
    categories?: string[];
    cc?: string[];
    bcc?: string[];
  },
) => Promise<{ success: boolean; error?: string }>;

export interface RegisterInvoiceReminderRoutesDeps extends ReminderCoreDeps {
  requireAuthentication: RequestHandler;
  /** CAN_SEND_INVOICE_EMAIL — the same capability the PDF-send route uses. */
  requireInvoiceSend: RequestHandler;
  /**
   * Task #1921 — CAN_VIEW_REMINDER_HISTORY, a read-only gate for the GET.
   * Optional so existing callers keep their behaviour: absent, the GET falls
   * back to the send guard, exactly as before.
   */
  requireReminderHistoryRead?: RequestHandler;
  /**
   * An already-built core. Lets the batch endpoints and these endpoints share
   * one instance so there is literally one send path in the process.
   */
  _core?: ReminderCore;
}

const defaultMailer: ReminderMailer = (to, name, number, pdfBuffer, overrides) =>
  EmailService.sendInvoiceDetailPdf(to, name, number, pdfBuffer, overrides);

// ── The shared core ─────────────────────────────────────────────────────────
//
// Task #1888 — everything below the HTTP layer lives here rather than inside
// the route closures, because the batch endpoints have to run EXACTLY this
// send. A batch that re-implemented eligibility, the throttle or the recording
// would be a second refusal matrix free to drift from this one, and the first
// symptom of that drift would be mail in a customer's inbox.
//
// The single-send endpoints below are now thin: they translate one core
// outcome into one HTTP status. The batch endpoints call the same two methods
// per invoice.

export interface ReminderCoreDeps {
  /** Test seams. Production passes none of these. */
  _readSentCopy?: (key: string) => Promise<Buffer | null>;
  _resolveSender?: typeof resolveCompanySender;
  _storageApi?: any;
  _mailer?: ReminderMailer;
  _loadPaymentTerms?: (customerId: number) => Promise<string | null>;
  _now?: () => Date;
}

/** One invoice, resolved: the row, its PDF, its age, and its first refusal. */
export interface ReminderContext {
  invoice: Invoice;
  customer: Customer | undefined;
  pdf: InvoicePdf | undefined;
  recipientEmail: string | null;
  now: Date;
  effectiveDueDate: Date;
  daysOverdue: number;
  agingBucket: AgingBucketKey;
  balanceDue: number;
  refusal: ReminderRefusal | null;
}

interface ReminderOverrides {
  to?: string;
  cc?: string[];
  bcc?: string[];
  subject?: string;
  note?: string;
  reviewed?: BuiltDraft;
}

/** Why a preview or a batch send passed an invoice over. */
export type ReminderSkipReason = ReminderRefusalReason | "throttled";

/**
 * What one invoice would do if the send were confirmed right now.
 *
 * `not_found` carries nothing but the id on purpose: an invoice the caller
 * cannot see must not have its customer, address or balance echoed back.
 */
export type ReminderPreviewRow =
  | { invoiceId: number; outcome: "not_found" }
  | {
      invoiceId: number;
      invoiceNumber: string;
      customerName: string;
      outcome: "skip";
      reason: ReminderSkipReason;
      message: string;
      /** Set only for `throttled` — when this invoice becomes eligible. */
      nextAllowedAt: string | null;
    }
  | {
      invoiceId: number;
      invoiceNumber: string;
      customerName: string;
      outcome: "send";
      recipientEmail: string;
      templateKey: ReminderTemplateKey;
      templateLabel: string;
      balanceDue: string;
      daysOverdue: number;
    };

/** What one invoice actually did. */
export type ReminderSendOutcome =
  | { invoiceId: number; outcome: "not_found" }
  | {
      invoiceId: number;
      invoiceNumber: string;
      customerName: string;
      outcome: "skipped";
      reason: ReminderSkipReason;
      message: string;
      refusal: ReminderRefusal | null;
      throttle: ThrottleState | null;
    }
  | {
      invoiceId: number;
      invoiceNumber: string;
      customerName: string;
      outcome: "failed";
      recipientEmail: string;
      templateKey: ReminderTemplateKey;
      templateLabel: string;
      message: string;
      error: string;
      reminder: ReminderHistoryRow;
    }
  | {
      invoiceId: number;
      invoiceNumber: string;
      customerName: string;
      outcome: "sent";
      recipientEmail: string;
      templateKey: ReminderTemplateKey;
      templateLabel: string;
      message: string;
      reminder: ReminderHistoryRow;
    };

export interface ReminderCore {
  /** Company scope for every fetch. super_admin sees every company. */
  callerCompanyId(req: any): number | null;
  resolveContext(req: any, invoiceId: number): Promise<ReminderContext | null>;
  throttleFor(
    invoiceId: number,
    companyId: number | null,
    now: Date,
  ): Promise<ThrottleState>;
  history(req: any, invoiceId: number): Promise<any[]>;
  companyFor(ctx: ReminderContext): Promise<Company | undefined>;
  senderFor(ctx: ReminderContext): Promise<CompanySender>;
  versionStamp(req: any, ctx: ReminderContext): Promise<string>;
  hasSavedCopy(ctx: ReminderContext): Promise<boolean>;
  renderOne(ctx: ReminderContext, templateKey: ReminderTemplateKey, company: Company | undefined, note?: string): Promise<RenderedReminder>;
  /** Dry run. Reads only — it must never reach the mailer. */
  previewOne(
    req: any,
    invoiceId: number,
    choice: ReminderTemplateChoice,
  ): Promise<ReminderPreviewRow>;
  /** The one send path. Re-checks everything the preview checked. */
  sendOne(
    req: any,
    invoiceId: number,
    choice: ReminderTemplateChoice,
    overrides?: ReminderOverrides,
  ): Promise<ReminderSendOutcome>;
}

export function createReminderCore(deps: ReminderCoreDeps = {}): ReminderCore {
  const storage = deps._storageApi ?? storageModule;
  const mailer = deps._mailer ?? defaultMailer;
  const nowFn = deps._now ?? (() => new Date());

  function callerCompanyId(req: any): number | null {
    return req.authenticatedUserRole === "super_admin"
      ? null
      : (req.authenticatedUserCompanyId ?? null);
  }

  /**
   * Everything the endpoints need about one invoice, resolved once.
   * Returns null when the invoice is not visible to this caller — the caller
   * then 404s (or skips it) WITHOUT touching the mailer.
   */
  async function resolveContext(
    req: any,
    invoiceId: number,
  ): Promise<ReminderContext | null> {
    const companyId = callerCompanyId(req);
    if (companyId == null && req.authenticatedUserRole !== "super_admin") return null;
    const invoice: Invoice | undefined = await storage.getInvoiceById(invoiceId, companyId);
    if (!invoice) return null;
    const [pdf, customer]: [InvoicePdf | undefined, Customer | undefined] = await Promise.all([
      storage.getLatestInvoiceSentCopy(invoiceId, invoice.companyId),
      storage.getCustomerById(invoice.customerId),
    ]);
    const ownedCustomer = customer?.companyId === invoice.companyId ? customer : undefined;
    const recipientEmail = ownedCustomer?.email?.trim() || invoice.customerEmail?.trim() || null;
    const paymentTerms = deps._loadPaymentTerms
      ? await deps._loadPaymentTerms(invoice.customerId)
      : ownedCustomer?.paymentTerms ?? null;
    const now = nowFn();
    const effectiveDueDate = computeEffectiveDueDate(
      invoice.dueDate,
      invoice.createdAt,
      paymentTerms,
    );
    const rawDays = daysOverdueOf(effectiveDueDate, now);
    // Floored, exactly as the A/R list floors it, so the number in the email
    // and the number in the Days overdue column are the same number.
    const days = Number.isFinite(rawDays) ? Math.floor(rawDays) : 0;
    const bucket: AgingBucketKey = classifyAgingBucket(rawDays);
    return {
      invoice,
      customer: ownedCustomer,
      pdf,
      recipientEmail,
      now,
      effectiveDueDate,
      daysOverdue: days,
      agingBucket: bucket,
      balanceDue: resolveBalanceDue(invoice),
      refusal: evaluateReminderEligibility({ invoice, hasStoredPdf: !!pdf, recipientEmail }),
    };
  }

  async function throttleFor(
    invoiceId: number,
    companyId: number | null,
    now: Date,
  ): Promise<ThrottleState> {
    const last = await storage.getLastDeliveredInvoiceReminder(invoiceId, companyId);
    let windowDays = DEFAULT_REMINDER_THROTTLE_DAYS;
    if (companyId != null) {
      try {
        const company = await storage.getCompanyProfile(companyId);
        const configured = (company as any)?.invoiceReminderThrottleDays;
        if (typeof configured === "number" && configured > 0) windowDays = configured;
      } catch {
        // A missing company profile must not open the throttle — fall through
        // to the default window rather than allowing an unlimited send rate.
      }
    }
    return evaluateThrottle(last ? new Date(last.sentAt) : null, windowDays, now);
  }

  async function history(req: any, invoiceId: number): Promise<any[]> {
    return (await storage.getInvoiceReminders(invoiceId, callerCompanyId(req))) ?? [];
  }

  function companyFor(ctx: ReminderContext): Promise<Company | undefined> {
    return storage.getCompanyProfile(ctx.invoice.companyId);
  }

  function senderFor(ctx: ReminderContext): Promise<CompanySender> {
    return (deps._resolveSender ?? resolveCompanySender)(ctx.invoice.companyId);
  }

  async function versionStamp(req: any, ctx: ReminderContext): Promise<string> {
    const [latest] = await history(req, ctx.invoice.id);
    return `${ctx.invoice.updatedAt.toISOString()}|${ctx.pdf?.id ?? 0}|${latest?.id ?? 0}`;
  }

  async function hasSavedCopy(ctx: ReminderContext): Promise<boolean> {
    if (!ctx.pdf) return false;
    return Boolean(deps._readSentCopy
      ? await deps._readSentCopy(ctx.pdf.pdfUrl)
      : await new ObjectStorageService().searchPublicObject(ctx.pdf.pdfUrl));
  }

  async function renderOne(ctx: ReminderContext, templateKey: ReminderTemplateKey, company: Company | undefined, note?: string): Promise<RenderedReminder> {
    if (!company) throw new Error("Cannot render a reminder without its company.");
    if (!ctx.pdf) throw new Error("Cannot render a reminder without its saved invoice copy.");
    const wording = await getEmailWording(ctx.invoice.companyId, REMINDER_EMAIL_KEY[templateKey]);
    return renderReminderEmail({
      templateKey,
      wording,
      company,
      customerName: ctx.customer?.irrigoName ?? ctx.customer?.name ?? ctx.invoice.customerName,
      invoiceNumber: ctx.invoice.invoiceNumber,
      billingMonth: invoiceBillingPeriod(ctx.invoice),
      billingPeriodRange: billingDateRange(ctx.invoice),
      effectiveDueDate: ctx.effectiveDueDate,
      daysOverdue: ctx.daysOverdue,
      balanceDue: ctx.balanceDue,
      note: note ?? "",
      attachmentFilename: ctx.pdf.filename,
    });
  }

  async function previewOne(
    req: any,
    invoiceId: number,
    choice: ReminderTemplateChoice,
  ): Promise<ReminderPreviewRow> {
    const ctx = await resolveContext(req, invoiceId);
    if (!ctx) return { invoiceId, outcome: "not_found" };
    const head = {
      invoiceId,
      invoiceNumber: ctx.invoice.invoiceNumber,
      customerName: ctx.invoice.customerName,
    };
    if (ctx.refusal) {
      return {
        ...head,
        outcome: "skip",
        reason: ctx.refusal.reason,
        message: ctx.refusal.message,
        nextAllowedAt: null,
      };
    }
    const throttle = await throttleFor(invoiceId, ctx.invoice.companyId ?? null, ctx.now);
    if (throttle.throttled) {
      return {
        ...head,
        outcome: "skip",
        reason: "throttled",
        message: throttleMessage(ctx.invoice.invoiceNumber, throttle),
        nextAllowedAt: throttle.nextAllowedAt?.toISOString() ?? null,
      };
    }
    const templateKey = resolveTemplateChoice(choice, ctx.agingBucket);
    return {
      ...head,
      outcome: "send",
      recipientEmail: ctx.recipientEmail!,
      templateKey,
      templateLabel: REMINDER_TEMPLATE_LABELS[templateKey],
      balanceDue: ctx.balanceDue.toFixed(2),
      daysOverdue: ctx.daysOverdue,
    };
  }

  async function sendOne(
    req: any,
    invoiceId: number,
    choice: ReminderTemplateChoice,
    overrides?: ReminderOverrides,
  ): Promise<ReminderSendOutcome> {
    // Company-scoped resolution first, before anything reads a template or
    // touches the mailer. Another company's invoice never gets this far.
    const ctx = await resolveContext(req, invoiceId);
    if (!ctx) return { invoiceId, outcome: "not_found" };
    const head = {
      invoiceId,
      invoiceNumber: ctx.invoice.invoiceNumber,
      customerName: ctx.invoice.customerName,
    };

    // Re-checked here, at send time — a preview is a photograph of a moment
    // that has already passed by the time anyone clicks confirm.
    if (ctx.refusal) {
      return {
        ...head,
        outcome: "skipped",
        reason: ctx.refusal.reason,
        message: ctx.refusal.message,
        refusal: ctx.refusal,
        throttle: null,
      };
    }

    const throttle = await throttleFor(invoiceId, ctx.invoice.companyId ?? null, ctx.now);
    if (throttle.throttled) {
      return {
        ...head,
        outcome: "skipped",
        reason: "throttled",
        message: throttleMessage(ctx.invoice.invoiceNumber, throttle),
        refusal: null,
        throttle,
      };
    }

    const templateKey = resolveTemplateChoice(choice, ctx.agingBucket);
    const reviewed = overrides?.reviewed;
    const rendered = await renderOne(ctx, templateKey, await companyFor(ctx), overrides?.note);
    const changed = () => new OutgoingEmailError(409, "This reminder changed after you reviewed it. Review it again before sending.");
    if (reviewed && (reviewed.html !== rendered.html || reviewed.text !== rendered.text)) throw changed();
    const buf = await (deps._readSentCopy ?? readInvoiceSentCopy)(ctx.pdf!.pdfUrl);
    if (!buf) {
      const refusal = evaluateReminderEligibility({ invoice: ctx.invoice, hasStoredPdf: false, recipientEmail: ctx.recipientEmail })!;
      return { ...head, outcome: "skipped", reason: refusal.reason, message: refusal.message, refusal, throttle: null };
    }
    if (reviewed) {
      // Reading the saved file can take time. Check the current data before
      // delivering, and use the exact sender and body from the verified draft.
      const current = await resolveContext(req, invoiceId);
      if (!current) return { invoiceId, outcome: "not_found" };
      const currentStamp = await versionStamp(req, current);
      if (current.refusal || current.pdf?.id !== ctx.pdf!.id || currentStamp !== reviewed.versionStamp
        || resolveTemplateChoice(choice, current.agingBucket) !== templateKey
        || current.daysOverdue !== ctx.daysOverdue || current.balanceDue !== ctx.balanceDue
        || current.effectiveDueDate.getTime() !== ctx.effectiveDueDate.getTime()) {
        throw changed();
      }
    }
    const recipientEmail = overrides?.to ?? ctx.recipientEmail!;
    const sendResult = await mailer(
      recipientEmail,
      ctx.invoice.customerName,
      ctx.invoice.invoiceNumber,
      // Non-null by construction: the no_pdf refusal above returned early.
      buf,
      {
        subject: overrides?.subject ?? rendered.subject,
        html: reviewed?.html ?? rendered.html,
        text: reviewed?.text ?? rendered.text,
        sender: reviewed?.sender ?? await senderFor(ctx),
        filename: ctx.pdf!.filename,
        categories: ["invoice-payment-reminder"],
        cc: overrides?.cc,
        bcc: overrides?.bcc,
      },
    );

    const existing = await history(req, invoiceId);
    const deliveredCount = existing.filter((r: any) => r.deliveryStatus === "sent").length;

    // Who sent it, captured by name as well as id: the history has to stay
    // readable after a user is deactivated or renamed.
    const sentByUserId: number | null =
      typeof req.authenticatedUserId === "number" ? req.authenticatedUserId : null;
    let sentByName: string | null = null;
    if (sentByUserId != null) {
      try {
        sentByName = (await storage.getUser(sentByUserId))?.name ?? null;
      } catch {
        sentByName = null;
      }
    }

    const base = {
      companyId: ctx.invoice.companyId,
      invoiceId,
      sentByUserId,
      sentByName,
      sentAt: ctx.now,
      recipientEmail,
      templateKey,
      // Captured, not looked up. This is what makes the history readable
      // after the balance moves and after the customer's email changes.
      balanceAtSend: ctx.balanceDue.toFixed(2),
      daysOverdueAtSend: ctx.daysOverdue,
    };

    if (!sendResult.success) {
      // Recorded as failed, with the reason, and WITHOUT a sequence number —
      // a bounce is not a reminder the customer received, so the next
      // successful send is still reminder number one.
      const failed = await storage.createInvoiceReminder({
        ...base,
        sequenceNumber: null,
        deliveryStatus: "failed",
        deliveryError: sendResult.error ?? "Send failed",
      });
      return {
        ...head,
        outcome: "failed",
        recipientEmail,
        templateKey,
        templateLabel: REMINDER_TEMPLATE_LABELS[templateKey],
        message: `The reminder for invoice #${ctx.invoice.invoiceNumber} could not be delivered to ${recipientEmail}. It has been recorded as a failed attempt and does not count as a reminder.`,
        error: sendResult.error ?? "Send failed",
        reminder: toHistoryRow(failed),
      };
    }

    const saved = await storage.createInvoiceReminder({
      ...base,
      sequenceNumber: deliveredCount + 1,
      deliveryStatus: "sent",
      deliveryError: null,
    });

    return {
      ...head,
      outcome: "sent",
      recipientEmail,
      templateKey,
      templateLabel: REMINDER_TEMPLATE_LABELS[templateKey],
      message: `Reminder sent to ${recipientEmail}.`,
      reminder: toHistoryRow(saved),
    };
  }

  return {
    callerCompanyId,
    resolveContext,
    throttleFor,
    history,
    companyFor,
    senderFor,
    versionStamp,
    hasSavedCopy,
    renderOne,
    previewOne,
    sendOne,
  };
}

// ── Registration ────────────────────────────────────────────────────────────

export function registerInvoiceReminderRoutes(
  app: Express,
  deps: RegisterInvoiceReminderRoutesDeps,
): void {
  const core = deps._core ?? createReminderCore(deps);

  function parseId(req: any, res: any): number | null {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ message: "Invalid invoice ID" });
      return null;
    }
    return id;
  }

  // ── History + send-ability ────────────────────────────────────────────────

  app.get(
    "/api/invoices/:id/reminders",
    deps.requireAuthentication,
    // Task #1921 — history is a read. A role with invoice-read but no send
    // authority (irrigation_manager) may see what already went out.
    deps.requireReminderHistoryRead ?? deps.requireInvoiceSend,
    async (req: any, res) => {
      try {
        const id = parseId(req, res);
        if (id == null) return;
        const ctx = await core.resolveContext(req, id);
        if (!ctx) {
          res.status(404).json({ message: "Invoice not found" });
          return;
        }
        const rows = await core.history(req, id);
        const throttle = await core.throttleFor(id, ctx.invoice.companyId ?? null, ctx.now);
        res.json({
          reminders: rows.map(toHistoryRow),
          canSend: !ctx.refusal && !throttle.throttled,
          refusal: ctx.refusal ?? null,
          throttle: {
            windowDays: throttle.windowDays,
            lastSentAt: throttle.lastSentAt ? throttle.lastSentAt.toISOString() : null,
            nextAllowedAt: throttle.nextAllowedAt
              ? throttle.nextAllowedAt.toISOString()
              : null,
            throttled: throttle.throttled,
            message: throttle.throttled
              ? throttleMessage(ctx.invoice.invoiceNumber, throttle)
              : null,
          },
          // A suggestion, nothing more. The sender picks the tone.
          suggestedTemplateKey: suggestTemplateKey(ctx.agingBucket),
          templates: REMINDER_TEMPLATE_KEYS.map((key) => ({
            key,
            label: REMINDER_TEMPLATE_LABELS[key],
          })),
          balanceDue: ctx.balanceDue.toFixed(2),
          daysOverdue: ctx.daysOverdue,
          agingBucket: ctx.agingBucket,
          effectiveDueDate: ctx.effectiveDueDate.toISOString(),
          recipientEmail: ctx.recipientEmail,
        });
      } catch (error) {
        console.error("Error loading invoice reminders:", error);
        res.status(500).json({ message: "Failed to load reminder history" });
      }
    },
  );

  // ── Bulk send-ability, read-only ──────────────────────────────────────────
  //
  // Task #1942 — the A/R list renders one named primary action per row ("Send",
  // "Remind", "In 3 days"), and that label MUST come from the refusal matrix
  // above rather than being re-derived client-side; a second copy of these
  // rules in the browser is exactly how a dead button that says the wrong
  // thing gets shipped.
  //
  // The single GET answers for one invoice, which would be 50 requests on a
  // page load. The batch *preview* endpoint answers for many, but it mints the
  // #1888 confirmation token as it goes, and a token minted by simply painting
  // a table would hollow out the "a human read this list" interlock.
  //
  // So: a third door that is a pure read. Same core, same `resolveContext`,
  // same `throttleFor` — no second matrix — and no token, no mailer, no writes.
  // Gated as a read, like the history GET.
  //
  // It resolves one context per id (an N+1 against the invoice and PDF tables).
  // That is acceptable at a 100-id cap and one call per rendered page; if the
  // page size ever grows, bulk-load the contexts rather than raising the cap.
  const MAX_ELIGIBILITY_IDS = 100;

  app.get(
    "/api/invoices/reminder-eligibility",
    deps.requireAuthentication,
    deps.requireReminderHistoryRead ?? deps.requireInvoiceSend,
    async (req: any, res) => {
      try {
        const raw = req.query?.ids;
        const text = Array.isArray(raw) ? raw.join(",") : typeof raw === "string" ? raw : "";
        const ids = [
          ...new Set(
            text
              .split(",")
              .map((part: string) => parseInt(part.trim(), 10))
              .filter((n: number) => Number.isFinite(n) && n > 0),
          ),
        ];

        if (ids.length === 0) {
          res.json({ rows: [], notFound: [] });
          return;
        }
        if (ids.length > MAX_ELIGIBILITY_IDS) {
          res.status(400).json({
            message: `Too many invoices requested at once (max ${MAX_ELIGIBILITY_IDS}).`,
          });
          return;
        }

        const rows: any[] = [];
        const notFound: number[] = [];
        for (const id of ids) {
          const ctx = await core.resolveContext(req, id);
          // Invisible to this caller: reported as not-found and nothing else.
          // No customer, no balance, no refusal message echoed back.
          if (!ctx) {
            notFound.push(id);
            continue;
          }
          const throttle = await core.throttleFor(
            id,
            ctx.invoice.companyId ?? null,
            ctx.now,
          );
          rows.push({
            invoiceId: id,
            canSend: !ctx.refusal && !throttle.throttled,
            refusal: ctx.refusal ?? null,
            throttle: {
              windowDays: throttle.windowDays,
              lastSentAt: throttle.lastSentAt ? throttle.lastSentAt.toISOString() : null,
              nextAllowedAt: throttle.nextAllowedAt
                ? throttle.nextAllowedAt.toISOString()
                : null,
              throttled: throttle.throttled,
              message: throttle.throttled
                ? throttleMessage(ctx.invoice.invoiceNumber, throttle)
                : null,
            },
          });
        }

        res.json({ rows, notFound });
      } catch (error) {
        console.error("Error evaluating reminder eligibility:", error);
        res.status(500).json({ message: "Failed to evaluate reminder eligibility" });
      }
    },
  );

}
