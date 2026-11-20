import type { Company, Estimate } from "@workspace/db";
import type { EstimateEmailData } from "../email-service";
import { storage } from "../storage";
import { renderEstimateDetail } from "./estimate-detail";
import { formatPhone, renderEmailLayout, type EmailLayoutInput } from "./layout";
import { fillWording, getEmailWording, type Wording } from "./wording";

export type EstimateApprovalLinks = { approveUrl: string; rejectUrl: string; viewUrl: string };
export const ESTIMATE_PREVIEW_LINK = "about:blank#link-created-when-sent";

type EmailCompany = EmailLayoutInput["company"];

function emailCompany(company: Company | null | undefined): EmailCompany {
  return company ?? { name: "IrrigoPro", logo: null, phone: null, email: null, website: null, address: null };
}

function fillEstimateWording(
  wording: Wording, company: EmailCompany, customerName: string, rawNumber: string, projectName: string,
) {
  const estimateNumber = String(rawNumber).replace(/^EST-?/i, "");
  const values = {
    customerName, estimateNumber, projectName,
    companyName: company.name, companyPhone: formatPhone(company.phone), companyEmail: company.email?.trim() ?? "",
  };
  return {
    docNumber: `#${estimateNumber}`,
    subject: fillWording(wording.subject, values),
    wording: {
      eyebrow: fillWording(wording.eyebrow, values),
      headline: fillWording(wording.headline, values),
      intro: fillWording(wording.intro, values),
      closing: fillWording(wording.closing, values),
    },
  };
}

export async function buildEstimateApprovalEmail(
  data: EstimateEmailData, { approveUrl, rejectUrl, viewUrl }: EstimateApprovalLinks,
): Promise<{ subject: string; html: string; text: string }> {
  const company = emailCompany(data.companyProfile === undefined ? await storage.getCompanyProfile(data.companyId) : data.companyProfile);
  const copy = fillEstimateWording(await getEmailWording(data.companyId, "estimate"), company, data.customerLabel, data.estimateNumber, data.projectName);
  const subject = data.subject || copy.subject;
  const lat = data.workLocationLat?.trim();
  const lng = data.workLocationLng?.trim();
  const facts: EmailLayoutInput["facts"] = [
    { label: "Project", value: data.projectName },
    { label: "Location", value: data.projectAddress ?? "" },
    ...(lat && lng ? [{
      label: "Pinned spot",
      value: data.workLocationAddress?.trim() || "View on map",
      href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lat)},${encodeURIComponent(lng)}`,
    }] : []),
    { label: "Branch", value: data.branchName ?? "" },
    { label: "Controller / zone", value: [
      data.controllerLetter ? `Controller ${data.controllerLetter}` : "",
      data.zoneNumber ? `Zone ${data.zoneNumber}` : "",
    ].filter(Boolean).join(" · ") },
    { label: "Estimate date", value: data.estimateDate },
  ];
  const detail = renderEstimateDetail(data);
  return {
    subject,
    ...renderEmailLayout({
      ...copy, subject, company, docType: "Estimate", stripe: "green", customerName: data.customerLabel,
      facts: facts.filter(({ value }) => value.trim()), note: data.note ?? "",
      total: { label: "Estimate total", value: data.totalAmount },
      detailHtml: detail.html, detailText: detail.text,
      actions: {
        primary: { label: "Approve estimate", href: approveUrl },
        secondary: { label: "Decline", href: rejectUrl },
        link: { label: "View the full estimate online", href: viewUrl },
      },
      actionsNote: approveUrl === ESTIMATE_PREVIEW_LINK ? "(links are created when sent)" : undefined,
      attachments: data.attachmentFilename ? [{ title: "Estimate", filename: data.attachmentFilename }] : [],
    }),
  };
}

const decisionDate = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", year: "numeric", timeZone: "America/Denver",
});
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export async function buildEstimateConfirmationEmail(
  { estimate, approved, decidedAt }: { estimate: Estimate; approved: boolean; decidedAt: Date },
  companyProfile: Company | undefined,
  customerName: string,
): Promise<{ subject: string; html: string; text: string }> {
  const company = emailCompany(companyProfile);
  const wording = await getEmailWording(estimate.companyId, approved ? "estimate_approved" : "estimate_declined");
  const copy = fillEstimateWording(wording, company, customerName, estimate.estimateNumber, estimate.projectName);
  return {
    subject: copy.subject,
    ...renderEmailLayout({
      ...copy, company, docType: "Estimate", stripe: approved ? "green" : "slate", customerName, note: "",
      facts: [
        { label: "Estimate", value: copy.docNumber },
        ...(estimate.projectName.trim() ? [{ label: "Project", value: estimate.projectName }] : []),
        { label: approved ? "Approved on" : "Declined on", value: decisionDate.format(decidedAt) },
      ],
      total: approved ? { label: "Approved total", value: currency.format(Number(estimate.totalAmount)) } : undefined,
      attachments: [],
    }),
  };
}
