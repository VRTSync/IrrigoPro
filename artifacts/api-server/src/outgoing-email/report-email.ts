import type { Company } from "@workspace/db";
import { formatPhone, renderEmailLayout, type EmailLayoutInput } from "./layout";
import { fillWording, getEmailWording, type EmailKey } from "./wording";

type ReportEmailInput = {
  company: Company;
  customerName: string;
  propertyAddress: string | null;
  note: string;
};
type ReportEmail = { subject: string; html: string; text: string; filename: string };

const reportDate = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", year: "numeric", timeZone: "America/Denver",
});

async function buildReportEmail(
  { company, customerName, propertyAddress, note }: ReportEmailInput,
  report: {
    key: EmailKey;
    docType: string;
    docNumber: string;
    attachmentTitle: string;
    filenameSuffix: string;
    facts: EmailLayoutInput["facts"];
  },
): Promise<ReportEmail> {
  const address = propertyAddress?.trim() ?? "";
  const property = address || customerName;
  const filename = `${property.replace(/[/\\:*?"<>|]/g, " ").replace(/\s+/g, " ").trim()} - ${report.filenameSuffix}.pdf`;
  const wording = await getEmailWording(company.id, report.key);
  const values = {
    customerName, property, propertyAddress: address,
    companyName: company.name,
    companyPhone: formatPhone(company.phone),
    companyEmail: company.email?.trim() ?? "",
  };
  const subject = fillWording(wording.subject, values);
  return {
    subject, filename,
    ...renderEmailLayout({
      company, customerName, note, subject, stripe: "green",
      docType: report.docType, docNumber: report.docNumber,
      wording: {
        eyebrow: fillWording(wording.eyebrow, values),
        headline: fillWording(wording.headline, values),
        intro: fillWording(wording.intro, values),
        closing: fillWording(wording.closing, values),
      },
      facts: [{ label: "Property", value: property }, ...report.facts],
      attachments: [{ title: report.attachmentTitle, filename }],
    }),
  };
}

export async function buildWetCheckReportEmail(
  args: ReportEmailInput & { inspectionDate: Date | null },
): Promise<ReportEmail> {
  const inspectionDate = args.inspectionDate ? reportDate.format(args.inspectionDate) : "";
  return buildReportEmail(args, {
    key: "wet_check_report", docType: "Inspection", docNumber: inspectionDate,
    attachmentTitle: "Inspection report", filenameSuffix: "Inspection Report",
    facts: inspectionDate ? [{ label: "Inspection date", value: inspectionDate }] : [],
  });
}

export async function buildIrrigationProfileReportEmail(
  args: ReportEmailInput & { controllerCount: number },
): Promise<ReportEmail> {
  return buildReportEmail(args, {
    key: "irrigation_profile_report", docType: "System profile", docNumber: reportDate.format(new Date()),
    attachmentTitle: "System profile", filenameSuffix: "Irrigation Profile",
    facts: [{ label: "Controllers", value: String(args.controllerCount) }],
  });
}
