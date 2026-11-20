import { createHash } from "node:crypto";
import type { Company } from "@workspace/db";
import { buildIrrigationProfileReportEmail, buildWetCheckReportEmail, EmailService } from "../email-service";
import { senderFromCompany } from "../lib/company-sender";
import { requireIrrigationProfileReportSend, requireWetCheckReportSend } from "../routes/report-email-guards";
import { storage } from "../storage";
import { OutgoingEmailError, type BuiltDraft, type DraftInput, type OutgoingEmailHandler } from "./types";

type Controller = Awaited<ReturnType<typeof storage.listIrrigationControllers>>[number];
type Customer = NonNullable<Awaited<ReturnType<typeof storage.getCustomer>>>;
type WetCheck = NonNullable<Awaited<ReturnType<typeof storage.getWetCheck>>>;
type WetCheckEntity = { wc: WetCheck; customer: Customer | undefined; company: Company | undefined };
type ProfileEntity = { customer: Customer; company: Company | undefined; controllers: Controller[] };

interface ReportDeps {
  storage: Pick<typeof storage, "getWetCheck" | "getCustomer" | "getCompanyProfile" | "listIrrigationControllers" | "getIrrigationController">;
  renderWetCheck: typeof import("../wet-check-report-pdf").renderWetCheckReportPdf;
  renderProfile: typeof import("../irrigation-profile-pdf").renderIrrigationProfilePdf;
  sendWetCheck: typeof EmailService.sendWetCheckReport;
  sendProfile: typeof EmailService.sendIrrigationProfileReport;
}

const defaults: ReportDeps = {
  storage,
  renderWetCheck: async (...args) => (await import("../wet-check-report-pdf")).renderWetCheckReportPdf(...args),
  renderProfile: async (...args) => (await import("../irrigation-profile-pdf")).renderIrrigationProfilePdf(...args),
  sendWetCheck: args => EmailService.sendWetCheckReport(args),
  sendProfile: args => EmailService.sendIrrigationProfileReport(args),
};

const stamp = (data: unknown) => createHash("sha256").update(JSON.stringify(data)).digest("base64url");
const companyPdfFields = (company?: Company) => [company?.name, company?.logo, company?.address, company?.phone, company?.email];
const controllerVersions = (controllers: Controller[]) => controllers.map(c => [c.id, c.updatedAt.toISOString()]);
const noRecipient = "No email address on file for this customer. Enter an email in To.";
const changed = "This report changed after you reviewed it. Review it again before sending.";

function companyEmailFields(company?: Company) {
  return { companyName: company?.name ?? "IrrigoPro", companyEmail: company?.email ?? null, companyPhone: company?.phone ?? null };
}

function draftFor(input: DraftInput, company: Company | undefined, email: string | null | undefined,
  body: { subject: string; html: string; text: string; filename: string }, viewUrl: string, versionStamp: string, attachmentStamp: string): BuiltDraft {
  const to = input.to || email?.trim() || "";
  return {
    sender: senderFromCompany(company), to, cc: input.cc ?? [], bcc: input.bcc ?? [], subject: input.subject || body.subject,
    note: input.note ?? "", html: body.html, text: body.text, attachments: [{ filename: body.filename, viewUrl }],
    warnings: to ? [] : [noRecipient], versionStamp, attachmentStamp, options: {}, variant: null,
  };
}

function wetEmailFields({ wc, company }: WetCheckEntity, note?: string) {
  return {
    customerName: wc.customerName ?? "", propertyAddress: wc.propertyAddress ?? null,
    technicianName: wc.technicianName ?? null,
    inspectionDate: wc.startedAt
      ? new Date(wc.startedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "—",
    ...companyEmailFields(company), note,
  };
}

function profileEmailFields({ customer, company }: ProfileEntity, note?: string) {
  return { customerName: customer.name, propertyAddress: customer.address, ...companyEmailFields(company), note };
}

function delivery(draft: BuiltDraft, pdfBuffer: Buffer) {
  return {
    sender: draft.sender, to: draft.to, cc: draft.cc, bcc: draft.bcc, pdfBuffer,
    reviewed: { subject: draft.subject, html: draft.html, text: draft.text, filename: draft.attachments[0].filename },
  };
}

export function createReportEmailHandlers(deps: ReportDeps = defaults) {
  const wetCheck: OutgoingEmailHandler<WetCheckEntity> = {
    kind: "wet_check_report",
    capabilities: [requireWetCheckReportSend],
    async load(req, id) {
      const scope = req.authenticatedUserRole === "super_admin" ? null : req.authenticatedUserCompanyId;
      if (scope == null && req.authenticatedUserRole !== "super_admin") return null;
      const wc = await deps.storage.getWetCheck(id, scope ?? null);
      if (!wc) return null;
      const [customer, company] = await Promise.all([
        deps.storage.getCustomer(wc.customerId), deps.storage.getCompanyProfile(wc.companyId),
      ]);
      return { wc, customer: customer?.companyId === wc.companyId ? customer : undefined, company };
    },
    async draft(entity, input) {
      const { wc, customer, company } = entity;
      return draftFor(input, company, customer?.email, buildWetCheckReportEmail(wetEmailFields(entity, input.note)),
        `/api/wet-checks/${wc.id}/report-pdf`, wc.updatedAt.toISOString(),
        stamp([wc, companyPdfFields(company)]));
    },
    async send(entity, draft) {
      const { wc, company } = entity;
      const pdf = await deps.renderWetCheck(wc, { company: company ?? null });
      await deps.sendWetCheck({ ...wetEmailFields(entity, draft.note), ...delivery(draft, pdf), wetCheckId: wc.id });
      return { sentTo: draft.to, sentAt: new Date() };
    },
  };

  const profile: OutgoingEmailHandler<ProfileEntity> = {
    kind: "irrigation_profile_report",
    capabilities: [requireIrrigationProfileReportSend],
    async load(req, id) {
      const customer = await deps.storage.getCustomer(id);
      if (!customer?.companyId || (req.authenticatedUserRole !== "super_admin" && customer.companyId !== req.authenticatedUserCompanyId)) return null;
      const [company, controllers] = await Promise.all([
        deps.storage.getCompanyProfile(customer.companyId), deps.storage.listIrrigationControllers(customer.companyId, id),
      ]);
      return { customer, company, controllers };
    },
    async draft(entity, input) {
      const { customer, company, controllers } = entity;
      const versions = controllerVersions(controllers);
      const latest = controllers.reduce<string>((max, c) => {
        const updatedAt = c.updatedAt.toISOString();
        return updatedAt > max ? updatedAt : max;
      }, "");
      return draftFor(input, company, customer.email, buildIrrigationProfileReportEmail(profileEmailFields(entity, input.note)),
        `/api/customers/${customer.id}/irrigation-profile/report-pdf`, latest || "none",
        stamp([versions, customer.name, customer.address, companyPdfFields(company)]));
    },
    async send(entity, draft) {
      const { customer, company, controllers } = entity;
      const detailed = await Promise.all(controllers.map(c => deps.storage.getIrrigationController(customer.companyId, c.id)));
      const valid = detailed.filter((c): c is NonNullable<typeof c> => c !== null);
      // The detail reads run after the review check; make sure they represent
      // the controllers (including their programs and zones) that were reviewed.
      const expected = stamp(controllerVersions(controllers));
      if (stamp(controllerVersions(valid)) !== expected) throw new OutgoingEmailError(409, changed);
      const current = await deps.storage.listIrrigationControllers(customer.companyId, customer.id);
      if (stamp(controllerVersions(current)) !== expected) throw new OutgoingEmailError(409, changed);
      const pdf = await deps.renderProfile(customer.name, valid, { company: company ?? null, propertyAddress: customer.address });
      await deps.sendProfile({ ...profileEmailFields(entity, draft.note), ...delivery(draft, pdf), customerId: customer.id });
      return { sentTo: draft.to, sentAt: new Date() };
    },
  };
  return [wetCheck, profile] as const;
}
