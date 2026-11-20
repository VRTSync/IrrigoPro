import type { Express, RequestHandler } from "express";
import { z } from "zod/v4";
import { storage } from "../storage";
import { recheckCompanyDomain, senderFromCompany } from "../lib/company-sender";
import { recordAuditEvent } from "./audit-log";

const settingsSchema = z.object({
  fromName: z.string().trim().max(100),
  fromLocalPart: z.union([z.literal(""), z.string().regex(/^[a-z0-9._%+-]{1,64}$/i)]),
  replyTo: z.union([z.literal(""), z.email()]),
  attachInvoiceGuide: z.boolean().optional(),
}).strict();
const domainSchema = z.object({
  domain: z.string().trim().toLowerCase().regex(/^(?=.{3,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/).nullable(),
}).strict();

export const companySenderProtectedKeys = [
  "id", "createdAt", "updatedAt", "customerRecordsLocked", "customerRecordsSystemName",
  "emailSendingDomain", "emailDomainVerifiedAt", "emailDomainCheckedAt", "emailDomainCheckError",
  "emailFromName", "emailFromAddress", "emailReplyTo", "attachInvoiceGuide",
];

/** Shared with the legacy company endpoint so its real handler is directly testable. */
export const updateCompanyHandler: RequestHandler = async (req, res) => {
  const companyId = Number(req.params.id);
  const role = req.authenticatedUserRole;
  if (role !== "super_admin" && role !== "company_admin") {
    res.status(403).json({ message: "Access denied." }); return;
  }
  if (role === "company_admin" && req.authenticatedUserCompanyId !== companyId) {
    res.status(404).json({ message: "Company not found" }); return;
  }
  try {
    const values = { ...req.body };
    for (const key of companySenderProtectedKeys) delete values[key];
    const company = await storage.updateCompany(companyId, values);
    if (!company) { res.status(404).json({ message: "Company not found" }); return; }
    res.json(company);
  } catch (err) {
    req.log.error({ err }, "company update failed");
    res.status(500).json({ message: "Failed to update company" });
  }
};

export function registerCompanyEmailSenderRoutes(
  app: Express,
  deps: {
    requireAuthentication: RequestHandler;
    recheck?: typeof recheckCompanyDomain;
    audit?: typeof recordAuditEvent;
  },
): void {
  const recheck = deps.recheck ?? recheckCompanyDomain;
  const audit = deps.audit ?? recordAuditEvent;
  async function read(companyId: number) {
    const company = await storage.getCompanyProfile(companyId);
    if (!company) return undefined;
    return {
      sendingDomain: company.emailSendingDomain,
      domainVerifiedAt: company.emailDomainVerifiedAt,
      domainCheckedAt: company.emailDomainCheckedAt,
      domainCheckError: company.emailDomainCheckError,
      fromName: company.emailFromName,
      fromAddress: company.emailFromAddress,
      replyTo: company.emailReplyTo,
      attachInvoiceGuide: company.attachInvoiceGuide,
      effective: senderFromCompany(company),
    };
  }
  app.get("/api/company/email-sender", deps.requireAuthentication, async (req, res) => {
    const companyId = req.authenticatedUserRole === "super_admin"
      ? Number(req.query.companyId) : req.authenticatedUserCompanyId;
    if (!companyId || !Number.isInteger(companyId)) {
      res.status(400).json({ message: "A company is required." }); return;
    }
    try {
      const data = await read(companyId);
      if (!data) { res.status(404).json({ message: "Company not found" }); return; }
      res.json(data);
    } catch (err) {
      req.log.error({ err }, "email sender read failed");
      res.status(500).json({ message: "Failed to fetch outgoing email settings" });
    }
  });

  const write = (kind: "settings" | "check" | "domain"): RequestHandler => async (req, res) => {
    const companyId = Number(req.params.companyId);
    const superAdmin = req.authenticatedUserRole === "super_admin";
    const ownAdmin = req.authenticatedUserRole === "company_admin" && req.authenticatedUserCompanyId === companyId;
    if (!(kind === "domain" ? superAdmin : kind === "check" ? superAdmin || ownAdmin : ownAdmin)) {
      res.status(403).json({ message: "Access denied. Company admins can only manage their own company settings." }); return;
    }
    try {
      const company = await storage.getCompanyProfile(companyId);
      if (!company) { res.status(404).json({ message: "Company not found" }); return; }
      if (kind === "settings") {
        const input = settingsSchema.parse(req.body);
        if (input.fromLocalPart && !company.emailSendingDomain) {
          res.status(409).json({ message: "No sending domain is assigned to this company yet." }); return;
        }
        await storage.updateCompany(companyId, {
          emailFromName: input.fromName || null,
          emailFromAddress: input.fromLocalPart ? `${input.fromLocalPart}@${company.emailSendingDomain}`.toLowerCase() : null,
          emailReplyTo: input.replyTo || null,
          ...(input.attachInvoiceGuide === undefined ? {} : { attachInvoiceGuide: input.attachInvoiceGuide }),
        });
      } else if (kind === "domain") {
        const { domain } = domainSchema.parse(req.body);
        await storage.updateCompany(companyId, {
          emailSendingDomain: domain,
          // Invalidate before the remote check: never send using stale authentication.
          emailDomainVerifiedAt: null,
          emailDomainCheckedAt: null,
          emailDomainCheckError: null,
          ...(company.emailFromAddress?.split("@")[1]?.toLowerCase() !== domain ? { emailFromAddress: null } : {}),
        });
      }
      await recheck(companyId);
      await audit(req, {
        actorUserId: req.authenticatedUserId, actorRole: req.authenticatedUserRole,
        actorCompanyId: req.authenticatedUserCompanyId,
        action: `company.email_sender_${kind}`, targetType: "company", targetId: String(companyId),
        summary: kind === "check" ? "Outgoing email domain checked" : "Outgoing email settings updated",
        details: { kind },
      });
      res.json(await read(companyId));
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid outgoing email settings" }); return;
      }
      if ((err as { code?: string })?.code === "23505" || (err as { cause?: { code?: string } })?.cause?.code === "23505") {
        res.status(409).json({ message: "That domain is already assigned to another company." }); return;
      }
      req.log.error({ err }, "email sender write failed");
      res.status(500).json({ message: "Failed to update outgoing email settings" });
    }
  };
  app.put("/api/company/:companyId/email-sender", deps.requireAuthentication, write("settings"));
  app.post("/api/company/:companyId/email-sender/check", deps.requireAuthentication, write("check"));
  app.put("/api/admin/companies/:companyId/email-sending-domain", deps.requireAuthentication, write("domain"));
}
