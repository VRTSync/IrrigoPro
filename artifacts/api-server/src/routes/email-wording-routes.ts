import type { Express, Request, RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { companies, companyEmailWording, users } from "@workspace/db/schema";
import {
  ListCompanyEmailWordingParams, ListCompanyEmailWordingResponse,
  PreviewCompanyEmailWordingResponse, SaveCompanyEmailWordingBody, SaveCompanyEmailWordingResponse,
} from "@workspace/api-zod";
import { db } from "../db";
import { storage } from "../storage";
import {
  defaultEmailWording, EMAIL_LABELS, isEmailKey, PLACEHOLDERS, validateWording, wordingFields,
  type EmailKey, type Wording,
} from "../outgoing-email/wording";
import { emailWordingScope } from "../outgoing-email/wording-store";
import { renderWordingPreview } from "../outgoing-email/wording-preview";
import { recordAuditEvent } from "./audit-log";

const path = "/api/company/:companyId/email-wording";
type Row = typeof companyEmailWording.$inferSelect;

function entry(key: EmailKey, row?: Row, name?: string | null) {
  const defaults = defaultEmailWording(key);
  return {
    key, label: EMAIL_LABELS[key], placeholders: [...PLACEHOLDERS[key]], defaults,
    wording: row ? wordingFields(row) : defaults, isCustom: !!row,
    updatedAt: row?.updatedAt.toISOString() ?? null, updatedBy: name ?? null,
  };
}

export function registerEmailWordingRoutes(app: Express, { requireAuthentication }: { requireAuthentication: RequestHandler }) {
  const authorize: RequestHandler = (req, res, next) => {
    const parsed = ListCompanyEmailWordingParams.safeParse(req.params);
    if (!parsed.success || !Number.isSafeInteger(parsed.data.companyId) || parsed.data.companyId > 2147483647) {
      res.status(404).json({ message: "Company not found." }); return;
    }
    const { companyId } = parsed.data;
    const role = req.authenticatedUserRole;
    if (req.authenticatedUserId == null ||
        (role !== "super_admin" && (role !== "company_admin" || req.authenticatedUserCompanyId !== companyId))) {
      res.status(403).json({ message: "Access denied. Company admins can only manage their own company's email wording." }); return;
    }
    if (req.params.key !== undefined && !isEmailKey(req.params.key)) {
      res.status(404).json({ message: "Email template not found." }); return;
    }
    res.locals.companyId = companyId;
    res.set("Cache-Control", "no-store");
    next();
  };

  app.get(path, requireAuthentication, authorize, async (req, res) => {
    const companyId: number = res.locals.companyId;
    if (!(await storage.getCompanyProfile(companyId))) {
      res.status(404).json({ message: "Company not found." }); return;
    }
    const rows = await db.select({ row: companyEmailWording, name: users.name })
      .from(companyEmailWording).leftJoin(users, eq(users.id, companyEmailWording.updatedByUserId))
      .where(eq(companyEmailWording.companyId, companyId));
    const byKey = new Map(rows.map(found => [found.row.emailKey, found]));
    res.json(ListCompanyEmailWordingResponse.parse(Object.keys(EMAIL_LABELS).filter(isEmailKey).map(key => {
      const found = byKey.get(key);
      return entry(key, found?.row, found?.name);
    })));
  });

  async function write(req: Request, companyId: number, key: EmailKey, wording: Wording | null) {
    return db.transaction(async tx => {
      // Serialize updates (including the first insert) so the audit's before value
      // is the one this request actually replaced.
      const [company] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).for("update");
      if (!company) return undefined;
      const scope = emailWordingScope(companyId, key);
      const [before] = await tx.select().from(companyEmailWording).where(scope);
      let saved: Row | undefined;
      let name: string | undefined;
      if (wording) {
        const values = { ...wording, updatedByUserId: req.authenticatedUserId!, updatedAt: new Date() };
        [saved] = await tx.insert(companyEmailWording).values({ companyId, emailKey: key, ...values })
          .onConflictDoUpdate({ target: [companyEmailWording.companyId, companyEmailWording.emailKey], set: values })
          .returning();
        const [actor] = await tx.select({ name: users.name }).from(users).where(eq(users.id, values.updatedByUserId));
        name = actor?.name;
      } else {
        await tx.delete(companyEmailWording).where(scope);
      }
      await recordAuditEvent(req, {
        actorUserId: req.authenticatedUserId, actorRole: req.authenticatedUserRole,
        actorCompanyId: req.authenticatedUserCompanyId,
        action: wording ? "email_wording.updated" : "email_wording.reset",
        targetType: "company", targetId: String(companyId),
        details: { key, before: before ? wordingFields(before) : defaultEmailWording(key), after: wording ?? defaultEmailWording(key) },
      }, { tx, strict: true });
      return entry(key, saved, name);
    });
  }

  app.put(`${path}/:key`, requireAuthentication, authorize, async (req, res) => {
    const companyId: number = res.locals.companyId;
    const key = req.params.key as EmailKey;
    const fieldErrors = validateWording(key, req.body);
    if (Object.values(fieldErrors).some(Boolean)) {
      res.status(422).json({ message: "Fix the highlighted fields.", fieldErrors }); return;
    }
    const input = SaveCompanyEmailWordingBody.parse(req.body);
    const saved = await write(req, companyId, key, {
      subject: input.subject.trim(), eyebrow: input.eyebrow.trim(), headline: input.headline.trim(),
      intro: input.intro.trim(), closing: input.closing.trim(),
    });
    if (!saved) { res.status(404).json({ message: "Company not found." }); return; }
    res.json(SaveCompanyEmailWordingResponse.parse(saved));
  });

  app.delete(`${path}/:key`, requireAuthentication, authorize, async (req, res) => {
    if (!(await write(req, res.locals.companyId, req.params.key as EmailKey, null))) {
      res.status(404).json({ message: "Company not found." }); return;
    }
    res.status(204).end();
  });

  app.post(`${path}/:key/preview`, requireAuthentication, authorize, async (req, res) => {
    const company = await storage.getCompanyProfile(res.locals.companyId);
    if (!company) { res.status(404).json({ message: "Company not found." }); return; }
    const key = req.params.key as EmailKey;
    const fieldErrors = validateWording(key, req.body);
    if (Object.values(fieldErrors).some(Boolean)) {
      res.json(PreviewCompanyEmailWordingResponse.parse({ fieldErrors })); return;
    }
    const preview = await renderWordingPreview(key, SaveCompanyEmailWordingBody.parse(req.body), company);
    res.json(PreviewCompanyEmailWordingResponse.parse({ ...preview, fieldErrors: null }));
  });
}
