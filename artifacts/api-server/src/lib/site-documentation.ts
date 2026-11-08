import { and, eq } from "drizzle-orm";
import {
  customers, irrigationControllers, irrigationBackflows, irrigationSiteDocumentation,
  type IrrigationSiteDocumentation,
} from "@workspace/db";
import { isFieldVerified, siteDocumentationStatus } from "@workspace/shared";
import { db } from "../db";
import type { ZoneActor } from "./controller-zone-records";
import { DocumentationError } from "./documentation-error";

type Equipment = { isActive: boolean; fieldVerifiedAt: Date | null; lastUpdatedAt: Date | null };
export function siteBlock(controllers: Equipment[], backflows: Equipment[], record: IrrigationSiteDocumentation | null) {
  const status = siteDocumentationStatus({ controllers, backflows, record });
  return {
    status,
    verifiedAt: status === "verified" ? record!.verifiedAt : null,
    verifiedByName: status === "verified" ? record!.verifiedByName : null,
    noBackflowConfirmed: record?.noBackflowConfirmedAt != null,
  };
}

export async function readSiteRecord(companyId: number, customerId: number, branchName: string) {
  const [record] = await db.select().from(irrigationSiteDocumentation).where(and(
    eq(irrigationSiteDocumentation.companyId, companyId),
    eq(irrigationSiteDocumentation.customerId, customerId),
    eq(irrigationSiteDocumentation.branchName, branchName),
  ));
  return record ?? null;
}

// Serialize confirmation/Finish even before a documentation row exists. Equipment
// locks keep a concurrent item verification from changing the Finish inputs.
export async function saveSiteDocumentation(
  companyId: number, customerId: number, branchName: string, actor: ZoneActor,
  action: { confirmed: boolean } | { finish: true },
) {
  return db.transaction(async tx => {
    const [customer] = await tx.select({ id: customers.id }).from(customers).where(and(
      eq(customers.id, customerId), eq(customers.companyId, companyId),
    )).for("update");
    if (!customer) return null;
    const controllers = await tx.select().from(irrigationControllers).where(and(
      eq(irrigationControllers.companyId, companyId), eq(irrigationControllers.customerId, customerId),
      eq(irrigationControllers.branchName, branchName), eq(irrigationControllers.isActive, true),
    )).orderBy(irrigationControllers.letter, irrigationControllers.id).for("update");
    const backflows = await tx.select().from(irrigationBackflows).where(and(
      eq(irrigationBackflows.companyId, companyId), eq(irrigationBackflows.customerId, customerId),
      eq(irrigationBackflows.branchName, branchName), eq(irrigationBackflows.isActive, true),
    )).orderBy(irrigationBackflows.name, irrigationBackflows.id).for("update");
    const scope = and(
      eq(irrigationSiteDocumentation.companyId, companyId),
      eq(irrigationSiteDocumentation.customerId, customerId),
      eq(irrigationSiteDocumentation.branchName, branchName),
    );
    const [existing] = await tx.select().from(irrigationSiteDocumentation).where(scope).for("update");
    const now = new Date();
    const values: Partial<typeof irrigationSiteDocumentation.$inferInsert> = { updatedAt: now };
    if ("finish" in action) {
      const reasons: string[] = [];
      if (!controllers.length) reasons.push("Add at least one controller");
      for (const c of controllers) if (!isFieldVerified(c)) reasons.push(`Controller ${c.letter} is not verified`);
      for (const b of backflows) if (!isFieldVerified(b)) reasons.push(`${b.name} is not verified`);
      if (!backflows.length && !existing?.noBackflowConfirmedAt) reasons.push("Add a backflow or confirm there isn't one");
      if (reasons.length) throw new DocumentationError(reasons[0], undefined, reasons);
      Object.assign(values, { verifiedAt: now, verifiedByUserId: actor.id, verifiedByName: actor.name });
    } else {
      if (action.confirmed && backflows.length) throw new DocumentationError("This location has a backflow on file");
      const wasConfirmed = existing?.noBackflowConfirmedAt != null;
      // Repeating the same answer preserves both the confirmation audit and Finish.
      if (wasConfirmed === action.confirmed && existing) return siteBlock(controllers, backflows, existing);
      Object.assign(values, {
        noBackflowConfirmedAt: action.confirmed ? now : null,
        noBackflowConfirmedByUserId: action.confirmed ? actor.id : null,
        noBackflowConfirmedByName: action.confirmed ? actor.name : null,
        verifiedAt: null, verifiedByUserId: null, verifiedByName: null,
      });
    }
    const [record] = await tx.insert(irrigationSiteDocumentation).values({
      companyId, customerId, branchName, ...values,
    }).onConflictDoUpdate({
      target: [irrigationSiteDocumentation.companyId, irrigationSiteDocumentation.customerId, irrigationSiteDocumentation.branchName],
      set: values,
    }).returning();
    return siteBlock(controllers, backflows, record);
  });
}
