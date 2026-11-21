import type { Company } from "@workspace/db";
import { formatPhone, renderEmailLayout, type EmailLayoutInput } from "./layout";
import { fillWording, getEmailWording, type Wording } from "./wording";

export const INVOICE_GUIDE_ATTACHMENT_TITLE = "Guide: how to read your invoice";

export async function buildInvoiceEmail(args: {
  company: Company;
  customerName: string;
  invoiceNumber: string;
  billingMonth: string;
  billingPeriodRange: string;
  dueDateLabel: string | null;
  balanceDue: string;
  note: string;
  attachments: EmailLayoutInput["attachments"];
  wording?: Wording;
  subject?: string;
}) {
  const { company, customerName, invoiceNumber, billingMonth, dueDateLabel, balanceDue, note, attachments } = args;
  const values = {
    customerName, invoiceNumber, billingMonth, balanceDue, dueDate: dueDateLabel ?? "",
    companyName: company.name, companyPhone: formatPhone(company.phone), companyEmail: company.email?.trim() ?? "",
  };
  const wording = args.wording ?? await getEmailWording(company.id, "invoice");
  const subject = args.subject || fillWording(wording.subject, values);
  return {
    subject,
    ...renderEmailLayout({
      company, subject, docType: "Invoice", docNumber: invoiceNumber, stripe: "green",
      wording: {
        eyebrow: fillWording(wording.eyebrow, values),
        headline: fillWording(wording.headline, values),
        intro: fillWording(wording.intro, values),
        closing: fillWording(wording.closing, values),
      },
      customerName, note,
      facts: [
        { label: "Invoice", value: invoiceNumber },
        { label: "Billing period", value: args.billingPeriodRange },
        ...(dueDateLabel ? [{ label: "Due", value: dueDateLabel }] : []),
      ],
      total: { label: "Amount due", value: balanceDue },
      attachments,
    }),
  };
}
