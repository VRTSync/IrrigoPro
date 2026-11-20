import type { Company } from "@workspace/db";
import type { AgingBucketKey } from "@workspace/shared";
import { invoiceCurrency, invoiceShortDate } from "./outgoing-email/invoice-email-format";
import { formatPhone, renderEmailLayout, type Stripe } from "./outgoing-email/layout";
import { fillWording, type EmailKey, type Wording } from "./outgoing-email/wording";

export const REMINDER_TEMPLATE_KEYS = ["friendly", "firm", "final_notice"] as const;
export type ReminderTemplateKey = (typeof REMINDER_TEMPLATE_KEYS)[number];

export function isReminderTemplateKey(v: unknown): v is ReminderTemplateKey {
  return typeof v === "string" && (REMINDER_TEMPLATE_KEYS as readonly string[]).includes(v);
}

/** What the bookkeeper sees in the tone picker and in the reminder history. */
export const REMINDER_TEMPLATE_LABELS: Record<ReminderTemplateKey, string> = {
  friendly: "Friendly reminder",
  firm: "Firm reminder",
  final_notice: "Final notice",
};

/**
 * The tone the UI pre-selects, keyed off the shared bucket helper.
 *
 * `current` and `days30` → friendly, `days60` → firm, `days90` (60+) → final
 * notice. The boundaries are the frozen ones from the aging module; this
 * function reads a bucket and never re-derives one.
 */
export function suggestTemplateKey(bucket: AgingBucketKey): ReminderTemplateKey {
  switch (bucket) {
    case "days90":
      return "final_notice";
    case "days60":
      return "firm";
    default:
      return "friendly";
  }
}

export const REMINDER_EMAIL_KEY: Record<ReminderTemplateKey, EmailKey> = {
  friendly: "reminder_friendly",
  firm: "reminder_past_due",
  final_notice: "reminder_final",
};
export const REMINDER_STRIPE: Record<ReminderTemplateKey, Stripe> = {
  friendly: "green",
  firm: "amber",
  final_notice: "red",
};

export interface ReminderTemplateInput {
  templateKey: ReminderTemplateKey;
  wording: Wording;
  company: Company;
  customerName: string;
  invoiceNumber: string;
  billingMonth: string;
  billingPeriodRange: string;
  effectiveDueDate: Date;
  daysOverdue: number;
  balanceDue: number;
  note: string;
  attachmentFilename: string;
}

export interface RenderedReminder {
  subject: string;
  html: string;
  text: string;
}

export function pastDueText(days: number): string {
  if (days < 0) return `due in ${-days} day${days === -1 ? "" : "s"}`;
  if (days === 0) return "due today";
  return `${days} day${days === 1 ? "" : "s"} past due`;
}

/** The due date, balance and age are resolved by the same helpers as A/R. */
export function renderReminderEmail(input: ReminderTemplateInput): RenderedReminder {
  const { company, customerName, invoiceNumber, billingMonth, wording } = input;
  const values = {
    customerName, invoiceNumber, billingMonth,
    companyName: company.name,
    companyPhone: formatPhone(company.phone),
    companyEmail: company.email?.trim() ?? "",
    balanceDue: invoiceCurrency.format(input.balanceDue),
    dueDate: invoiceShortDate.format(input.effectiveDueDate),
    pastDueText: pastDueText(input.daysOverdue),
  };
  const subject = fillWording(wording.subject, values);
  return {
    subject,
    ...renderEmailLayout({
      company, subject, docType: "Invoice", docNumber: invoiceNumber, stripe: REMINDER_STRIPE[input.templateKey],
      wording: {
        eyebrow: fillWording(wording.eyebrow, values),
        headline: fillWording(wording.headline, values),
        intro: fillWording(wording.intro, values),
        closing: fillWording(wording.closing, values),
      },
      customerName, note: input.note,
      facts: [
        { label: "Invoice", value: invoiceNumber },
        { label: "Billing period", value: input.billingPeriodRange },
        { label: "Due date", value: values.dueDate },
        { label: "Status", value: values.pastDueText },
      ],
      total: { label: "Balance due", value: values.balanceDue },
      attachments: [{ title: `Copy of invoice ${invoiceNumber}`, filename: input.attachmentFilename }],
    }),
  };
}
