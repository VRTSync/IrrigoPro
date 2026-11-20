export type EmailKey =
  | "invoice" | "estimate" | "reminder_friendly" | "reminder_past_due" | "reminder_final"
  | "estimate_approved" | "estimate_declined" | "wet_check_report" | "irrigation_profile_report";
export const WORDING_FIELDS = ["subject", "eyebrow", "headline", "intro", "closing"] as const;
export type WordingField = typeof WORDING_FIELDS[number];
export type Wording = Record<WordingField, string>;

export const EMAIL_LABELS: Record<EmailKey, string> = {
  invoice: "Invoice",
  estimate: "Estimate",
  reminder_friendly: "Reminder: friendly",
  reminder_past_due: "Reminder: past due",
  reminder_final: "Reminder: final notice",
  estimate_approved: "Estimate approved",
  estimate_declined: "Estimate declined",
  wet_check_report: "Inspection report",
  irrigation_profile_report: "System profile report",
};

const common = ["customerName", "companyName", "companyPhone", "companyEmail"] as const;
const invoice = [...common, "invoiceNumber", "billingMonth", "balanceDue", "dueDate"] as const;
const reminder = [...invoice, "pastDueText"] as const;
const estimate = [...common, "estimateNumber", "projectName"] as const;
const report = [...common, "property", "propertyAddress"] as const;

export const PLACEHOLDERS: Record<EmailKey, readonly string[]> = {
  invoice,
  estimate,
  reminder_friendly: reminder,
  reminder_past_due: reminder,
  reminder_final: reminder,
  estimate_approved: estimate,
  estimate_declined: estimate,
  wet_check_report: report,
  irrigation_profile_report: report,
};

export const DEFAULT_WORDING: Record<EmailKey, Wording> = {
  invoice: {
    subject: "Irrigation Invoice {invoiceNumber} – {customerName} – {billingMonth}",
    eyebrow: "{billingMonth} · Irrigation",
    headline: "Your {billingMonth} invoice is ready",
    intro: "Your invoice for irrigation work in {billingMonth} is attached. The detail report lists every work order, with parts and labor.",
    closing: "Questions about this invoice? Reply to this email or call us at {companyPhone}.",
  },
  estimate: {
    subject: "Irrigation Estimate #{estimateNumber} – {customerName}",
    eyebrow: "Approval needed",
    headline: "Your irrigation estimate is ready",
    intro: "We've priced the work below. Approve the estimate and we'll schedule it. This approval link stays open for 30 days.",
    closing: "Questions about this estimate? Reply to this email or call us at {companyPhone}.",
  },
  reminder_friendly: {
    subject: "Reminder: Invoice {invoiceNumber} – {customerName} – {billingMonth}",
    eyebrow: "Friendly reminder",
    headline: "A quick reminder about invoice {invoiceNumber}",
    intro: "Our records show invoice {invoiceNumber} is {pastDueText}. If payment is already on its way, thank you, and please disregard this note.",
    closing: "If anything on this invoice doesn't look right, reply to this email and we'll sort it out, or call us at {companyPhone}.",
  },
  reminder_past_due: {
    subject: "Past due: Invoice {invoiceNumber} – {customerName} – {billingMonth}",
    eyebrow: "Payment past due",
    headline: "Invoice {invoiceNumber} is past due",
    intro: "Invoice {invoiceNumber} is now {pastDueText} and remains unpaid. Please send payment, or reply with the date we can expect it.",
    closing: "If payment has already been sent, reply with the date and check or reference number so we can match it. Questions? Call us at {companyPhone}.",
  },
  reminder_final: {
    subject: "Final notice: Invoice {invoiceNumber} – {customerName} – {billingMonth}",
    eyebrow: "Final notice",
    headline: "Final notice for invoice {invoiceNumber}",
    intro: "Invoice {invoiceNumber} is {pastDueText} and still unpaid after our earlier reminders. This is our final notice before we take further steps to collect this balance.",
    closing: "Please reply today with payment or the date payment will be made. Questions? Call us at {companyPhone}.",
  },
  estimate_approved: {
    subject: "Estimate #{estimateNumber} approved – {customerName}",
    eyebrow: "Estimate approved",
    headline: "Thank you, your estimate is approved",
    intro: "We've recorded your approval of estimate #{estimateNumber}. We'll schedule the work and contact you with a date.",
    closing: "Questions? Reply to this email or call us at {companyPhone}.",
  },
  estimate_declined: {
    subject: "Estimate #{estimateNumber} declined – {customerName}",
    eyebrow: "Estimate declined",
    headline: "We've recorded your decision",
    intro: "You declined estimate #{estimateNumber}, so no work will be scheduled. If you'd like a different scope or price, reply to this email and we'll prepare a revised estimate.",
    closing: "Questions? Reply to this email or call us at {companyPhone}.",
  },
  wet_check_report: {
    subject: "Irrigation Inspection Results – {property}",
    eyebrow: "Inspection results",
    headline: "Your irrigation inspection results",
    intro: "We've completed an irrigation inspection at {property}. Your full system condition report is attached, zone by zone.",
    closing: "Questions? Reply to this email or call us at {companyPhone}.",
  },
  irrigation_profile_report: {
    subject: "Irrigation System Profile – {property}",
    eyebrow: "System profile",
    headline: "Your irrigation system profile",
    intro: "Your irrigation system profile for {property} is attached. It lists each controller, program and zone on your system.",
    closing: "Questions? Reply to this email or call us at {companyPhone}.",
  },
};

export function fillWording(template: string, values: Record<string, string>): string {
  const sentences: string[] = [];
  for (const sentence of template.trim().split(/(?<=[.?!])\s+/)) {
    let missingValue = false;
    const filled = sentence.replace(/\{([a-zA-Z]+)\}/g, (_, name: string) => {
      if (!Object.hasOwn(values, name)) throw new Error(`Unknown email placeholder: ${name}`);
      const value = values[name];
      if (value === "") missingValue = true;
      return value;
    });
    if (!missingValue) sentences.push(filled);
  }
  return sentences.join(" ");
}

export async function getEmailWording(_companyId: number, key: EmailKey): Promise<Wording> {
  return DEFAULT_WORDING[key];
}
