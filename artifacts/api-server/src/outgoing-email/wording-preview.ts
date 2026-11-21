import type { Company } from "@workspace/db";
import { renderReminderEmail } from "../invoice-reminder-templates";
import { senderFromCompany } from "../lib/company-sender";
import { getCurrentInvoiceGuide } from "../lib/platform-documents";
import { buildApprovalConfirmationEmail, buildEstimateApprovalEmail, ESTIMATE_PREVIEW_LINK } from "./estimate-email";
import { buildInvoiceEmail, INVOICE_GUIDE_ATTACHMENT_TITLE } from "./invoice-email";
import { buildIrrigationProfileReportEmail, buildWetCheckReportEmail } from "./report-email";
import type { EmailKey, Wording } from "./wording";

export async function renderWordingPreview(
  key: EmailKey, wording: Wording, company: Company,
): Promise<{ subject: string; html: string; text: string }> {
  const customerName = "Sample Customer";
  const note = "";
  const invoiceNumber = "IR-1001";
  const billingMonth = "October 2026";
  const billingPeriodRange = "Oct 1 – Oct 31, 2026";
  const effectiveDueDate = new Date("2026-11-30T19:00:00Z");
  const attachmentFilename = "Sample Customer - Irrigation Billing Detail - (10-1-26_10-31-26).pdf";
  const estimateNumber = "1001";
  const projectName = "Zone 4 repairs";
  const propertyAddress = "123 Sample Ave";
  const inspectionDate = new Date("2026-10-15T19:00:00Z");
  const common = { company, customerName, note, wording };
  switch (key) {
    case "invoice": {
      const guide = company.attachInvoiceGuide ? await getCurrentInvoiceGuide() : undefined;
      return buildInvoiceEmail({
        ...common, invoiceNumber, billingMonth, billingPeriodRange, dueDateLabel: "Nov 30, 2026", balanceDue: "$1,250.00",
        attachments: [
          { title: "Billing detail report", filename: attachmentFilename },
          ...(guide ? [{ title: INVOICE_GUIDE_ATTACHMENT_TITLE, filename: guide.filename }] : []),
        ],
      });
    }
    case "estimate":
      return buildEstimateApprovalEmail({
        sender: senderFromCompany(company), companyId: company.id, companyProfile: company,
        customerName, customerLabel: customerName, customerEmail: "sample@example.invalid",
        estimateId: 1001, estimateNumber, projectName, projectAddress: propertyAddress, estimateDate: "Oct 15, 2026",
        approvalToken: "", note, totalAmount: "$315.00", partsSubtotal: 255, laborSubtotal: 60,
        totalLaborHours: 1.5, laborRate: 40, attachmentFilename: "Estimate-1001.pdf",
        items: [
          { description: "Replace rotor head", partName: "Rotor head", quantity: 3, partPrice: 35, partsCost: 105, laborHours: 0.75, laborCost: 30, lineTotal: 135 },
          { description: "Repair lateral line", partName: "Lateral line", quantity: 1, partPrice: 150, partsCost: 150, laborHours: 0.75, laborCost: 30, lineTotal: 180 },
        ],
      }, { approveUrl: ESTIMATE_PREVIEW_LINK, rejectUrl: ESTIMATE_PREVIEW_LINK, viewUrl: ESTIMATE_PREVIEW_LINK }, wording);
    case "estimate_approved":
    case "estimate_declined":
      return buildApprovalConfirmationEmail({
        ...common, estimateNumber, projectName, approved: key === "estimate_approved", totalAmount: 315, decidedAt: inspectionDate,
      });
    case "reminder_friendly":
    case "reminder_past_due":
    case "reminder_final":
      return renderReminderEmail({
        ...common, invoiceNumber, billingMonth, billingPeriodRange, effectiveDueDate, daysOverdue: 12, balanceDue: 1250,
        attachmentFilename, templateKey: key === "reminder_final" ? "final_notice" : key === "reminder_past_due" ? "firm" : "friendly",
      });
    case "wet_check_report":
    case "irrigation_profile_report": {
      const report = key === "wet_check_report"
        ? await buildWetCheckReportEmail({ ...common, propertyAddress, inspectionDate })
        : await buildIrrigationProfileReportEmail({ ...common, propertyAddress, controllerCount: 2, reportDate: inspectionDate });
      const { subject, html, text } = report;
      return { subject, html, text };
    }
  }
}
