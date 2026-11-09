import type { Express, RequestHandler } from "express";
import type { z } from "zod";
import { and, eq, inArray, or } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  ConfirmDocumentationNoBackflowBody, VerifyDocumentationSiteBody,
  GetDocumentationSitesResponse, GetDocumentationSiteResponse,
  FieldVerifyControllerResponse, FieldVerifyBackflowResponse,
  ConfirmDocumentationNoBackflowResponse, VerifyDocumentationSiteResponse,
} from "@workspace/api-zod";
import {
  customers, irrigationControllers, irrigationBackflows, irrigationSiteDocumentation,
  type Customer,
} from "@workspace/db";
import {
  hasCapability, CAN_DOCUMENT_IRRIGATION_SYSTEM, controllerDocumentationGaps,
  backflowDocumentationGaps, isFieldVerified, siteDocumentationStatus,
} from "@workspace/shared";
import { db } from "../db";
import { storage } from "../storage";
import { parseId, getCallerCompanyId, badId, notFound } from "./irrigation-profile-routes";
import { DocumentationError } from "../lib/documentation-error";
import { readSiteRecord, saveSiteDocumentation, siteBlock } from "../lib/site-documentation";
export { DocumentationError } from "../lib/documentation-error";

const customerColumns = {
  id: customers.id, companyId: customers.companyId, name: customers.name, irrigoName: customers.irrigoName,
  address: customers.address, serviceStreet: customers.serviceStreet, serviceCity: customers.serviceCity,
  serviceState: customers.serviceState, serviceZip: customers.serviceZip, branches: customers.branches,
};
type DocCustomer = Pick<Customer, keyof typeof customerColumns>;
const displayName = (c: DocCustomer) => c.irrigoName?.trim() || c.name;
function serviceAddress(c: DocCustomer) {
  if (!c.serviceStreet?.trim()) return c.address || null;
  const tail = [c.serviceCity, c.serviceState, c.serviceZip].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  return [c.serviceStreet.trim().replace(/\s+/g, " "), tail].filter(Boolean).join(", ");
}
function resolveBranch(c: DocCustomer, raw: unknown): string {
  const branches = c.branches ?? [];
  if (branches.length) {
    if (raw == null || raw === "") throw new DocumentationError("Pick a location");
    if (typeof raw !== "string" || !branches.includes(raw)) throw new DocumentationError("Unknown location");
    return raw;
  }
  if (raw != null && raw !== "") throw new DocumentationError("Unknown location");
  return "";
}
const siteBody = VerifyDocumentationSiteBody;
const confirmationBody = ConfirmDocumentationNoBackflowBody;

export function registerSystemDocumentationRoutes(app: Express, deps: { requireAuthentication: RequestHandler }): void {
  // Capability first, company second, scoped lookup third, then record/body validation.
  const boundary = (handler: (req: any, res: any, companyId: number | null) => Promise<unknown>) =>
    async (req: any, res: any) => {
      const role = req.authenticatedUserRole;
      if (!hasCapability(role, CAN_DOCUMENT_IRRIGATION_SYSTEM)) return res.status(403).json({ message: "Forbidden" });
      const rawCompany = req.authenticatedUserCompanyId;
      const companyId = role === "super_admin" ? null : getCallerCompanyId(req);
      if (role !== "super_admin" && (
        !["number", "string"].includes(typeof rawCompany) || !Number.isInteger(companyId) || companyId! <= 0
      )) return res.status(401).json({ message: "Authentication required" });
      try {
        await handler(req, res, companyId);
      } catch (error) {
        if (error instanceof DocumentationError) {
          return res.status(400).json({
            message: error.message,
            ...(error.gaps ? { gaps: error.gaps } : {}),
            ...(error.reasons ? { reasons: error.reasons } : {}),
          });
        }
        req.log?.error?.({ err: error }, "system documentation failed");
        res.status(500).json({ message: "Could not save — please retry" });
      }
    };
  const customerFor = async (req: any, res: any, companyId: number | null) => {
    const id = parseId(req.params.customerId);
    if (!id) { badId(res, "customer"); return null; }
    const [customer] = await db.select(customerColumns).from(customers).where(and(
      eq(customers.id, id), companyId === null ? undefined : eq(customers.companyId, companyId),
    ));
    if (!customer) { notFound(res, "Customer"); return null; }
    return customer;
  };
  const actorFor = async (req: any) => {
    const user = await storage.getUser(req.authenticatedUserId);
    if (!user) throw new Error("Authenticated actor not found");
    return { id: user.id, name: user.name };
  };

  app.get("/api/system-documentation/sites", deps.requireAuthentication, boundary(async (_req, res, companyId) => {
    const rows = await db.select(customerColumns).from(customers).where(and(
      eq(customers.hiddenFromBilling, false), companyId === null ? undefined : eq(customers.companyId, companyId),
    ));
    if (!rows.length) return res.json(GetDocumentationSitesResponse.parse({ customers: [] }));
    const ids = rows.map(c => c.id);
    const ownerScope = (table: { companyId: AnyPgColumn; customerId: AnyPgColumn }) =>
      companyId === null
        ? or(...rows.map(c => and(eq(table.customerId, c.id), eq(table.companyId, c.companyId))))
        : eq(table.companyId, companyId);
    // Four scoped queries total, regardless of customer count.
    const controllerRows = await db.select({
      customerId: irrigationControllers.customerId, branchName: irrigationControllers.branchName,
      isActive: irrigationControllers.isActive, fieldVerifiedAt: irrigationControllers.fieldVerifiedAt,
      letterConfirmed: irrigationControllers.letterConfirmed,
      lastUpdatedAt: irrigationControllers.lastUpdatedAt,
    }).from(irrigationControllers).where(and(inArray(irrigationControllers.customerId, ids),
      eq(irrigationControllers.isActive, true), ownerScope(irrigationControllers)));
    const backflowRows = await db.select({
      customerId: irrigationBackflows.customerId, branchName: irrigationBackflows.branchName,
      isActive: irrigationBackflows.isActive, fieldVerifiedAt: irrigationBackflows.fieldVerifiedAt,
      lastUpdatedAt: irrigationBackflows.lastUpdatedAt,
    }).from(irrigationBackflows).where(and(inArray(irrigationBackflows.customerId, ids),
      eq(irrigationBackflows.isActive, true), ownerScope(irrigationBackflows)));
    const records = await db.select().from(irrigationSiteDocumentation).where(and(
      inArray(irrigationSiteDocumentation.customerId, ids),
      ownerScope(irrigationSiteDocumentation),
    ));
    const key = (c: { customerId: number; branchName: string }) => JSON.stringify([c.customerId, c.branchName]);
    function grouped<T extends { customerId: number; branchName: string }>(items: T[]) {
      const result = new Map<string, T[]>();
      for (const item of items) {
        const k = key(item);
        const group = result.get(k);
        if (group) group.push(item);
        else result.set(k, [item]);
      }
      return result;
    }
    const controllers = grouped(controllerRows), backflows = grouped(backflowRows);
    const docs = new Map(records.map(r => [key(r), r]));
    res.json(GetDocumentationSitesResponse.parse({ customers: rows.map(c => ({
      customerId: c.id, name: displayName(c), address: serviceAddress(c), branches: c.branches ?? [],
      sites: (c.branches?.length ? c.branches : [""]).map(branchName => {
        const k = key({ customerId: c.id, branchName });
        const cs = controllers.get(k) ?? [], bs = backflows.get(k) ?? [], record = docs.get(k) ?? null;
        const status = siteDocumentationStatus({ controllers: cs, backflows: bs, record });
        return { branchName, status, verifiedAt: status === "verified" ? record!.verifiedAt : null,
          controllerCount: cs.length, backflowCount: bs.length };
      }),
    })).sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())) }));
  }));

  app.get("/api/system-documentation/customers/:customerId/site", deps.requireAuthentication, boundary(async (req, res, companyId) => {
    const c = await customerFor(req, res, companyId);
    if (!c) return;
    const branchName = resolveBranch(c, req.query.branchName);
    const activeControllers = (await storage.listIrrigationControllers(c.companyId, c.id, branchName)).filter(c => c.isActive);
    const activeBackflows = (await storage.listBackflows(c.companyId, c.id, branchName)).filter(b => b.isActive);
    const controllers = [];
    for (const row of activeControllers) {
      const graph = await storage.getIrrigationController(c.companyId, row.id);
      if (!graph || !graph.isActive) continue;
      // Do not expose retired zones, tenancy, audit IDs, or future controller fields.
      const programs = graph.programs.filter(p => p.companyId === c.companyId);
      controllers.push({
        id: graph.id, letter: graph.letter, letterConfirmed: graph.letterConfirmed, name: graph.name, location: graph.location,
        brand: graph.brand, model: graph.model, totalZones: graph.totalZones, settingsPhotoUrl: graph.settingsPhotoUrl,
        notes: graph.notes, lastUpdatedAt: graph.lastUpdatedAt, fieldVerifiedAt: graph.fieldVerifiedAt,
        fieldVerifiedByName: graph.fieldVerifiedByName, programs,
        zones: [...graph.zones].sort((a, b) => a.zoneNumber - b.zoneNumber).map(z => ({
          id: z.id, zoneNumber: z.zoneNumber, name: z.name, zoneType: z.zoneType,
          zoneTypeConfirmed: z.zoneTypeConfirmed, programId: z.programId, runTimeMinutes: z.runTimeMinutes,
        })),
        gaps: controllerDocumentationGaps({ ...graph, programs }), verified: isFieldVerified(graph),
      });
    }
    const backflows = activeBackflows.map(b => {
      const { companyId: _company, customerId: _customer, vrtSyncId: _sync, ...projected } = b;
      return { ...projected, gaps: backflowDocumentationGaps(b), verified: isFieldVerified(b) };
    });
    const record = await readSiteRecord(c.companyId, c.id, branchName);
    res.json(GetDocumentationSiteResponse.parse({
      customer: { id: c.id, name: displayName(c), address: serviceAddress(c), branches: c.branches ?? [] },
      branchName, controllers: [...controllers].sort((a, b) => (a.letter ?? "").localeCompare(b.letter ?? "") || a.id - b.id), backflows,
      site: siteBlock(activeControllers, activeBackflows, record),
    }));
  }));

  for (const kind of ["controller", "backflow"] as const) {
    app.post(`/api/${kind === "controller" ? "irrigation-controllers" : "backflows"}/:id/field-verify`,
      deps.requireAuthentication, boundary(async (req, res, companyId) => {
        const id = parseId(req.params.id);
        if (!id) return badId(res, kind);
        // The locked storage lookup precedes inactive/completeness validation,
        // including for other-tenant records.
        const actor = await actorFor(req);
        const row = kind === "controller"
          ? await storage.fieldVerifyIrrigationController(companyId, id, actor)
          : await storage.fieldVerifyBackflow(companyId, id, actor);
        if (!row) return notFound(res, kind === "controller" ? "Controller" : "Backflow");
        const response = { ...row, gaps: [], verified: true };
        res.json(kind === "controller" ? FieldVerifyControllerResponse.parse(response) : FieldVerifyBackflowResponse.parse(response));
      }));
  }
  for (const action of ["no-backflow", "verify"] as const) {
    app.post(`/api/system-documentation/customers/:customerId/site/${action}`, deps.requireAuthentication,
      boundary(async (req, res, companyId) => {
        const c = await customerFor(req, res, companyId);
        if (!c) return;
        const parsed = (action === "no-backflow" ? confirmationBody : siteBody).safeParse(req.body ?? {});
        if (!parsed.success) return res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
        const branchName = resolveBranch(c, parsed.data.branchName);
        const result = await saveSiteDocumentation(c.companyId, c.id, branchName, await actorFor(req),
          action === "verify" ? { finish: true } : { confirmed: (parsed.data as z.infer<typeof confirmationBody>).confirmed });
        if (!result) return notFound(res, "Customer");
        res.json(action === "verify" ? VerifyDocumentationSiteResponse.parse(result) : ConfirmDocumentationNoBackflowResponse.parse(result));
      }));
  }
}
