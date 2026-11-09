import { and, eq } from "drizzle-orm";
import { customers, irrigationControllers, irrigationSiteDocumentation } from "@workspace/db";
import { db } from "../db";

/** Preserve saved relative order, omit inactive/deleted IDs, append new IDs by letter/id. */
export function orderedDocumentationControllers<T extends { id: number; letter: string | null }>(
  controllers: T[], saved: readonly number[] = [],
): T[] {
  const ranks = new Map(saved.map((id, i) => [id, i]));
  return [...controllers].sort((a, b) => {
    const ar = ranks.get(a.id), br = ranks.get(b.id);
    if (ar !== undefined || br !== undefined) return (ar ?? Infinity) - (br ?? Infinity);
    return (a.letter ?? "").localeCompare(b.letter ?? "") || a.id - b.id;
  });
}

export class ControllerOrderConflict extends Error {
  constructor() { super("The controller list or its order changed. Cancel and reorder the refreshed list."); }
}

export async function saveDocumentationControllerOrder(
  companyId: number, customerId: number, branchName: string,
  controllerIds: number[], previousControllerIds: number[],
) {
  return db.transaction(async tx => {
    // Same lock order as Finish: serialize writers even before the site row exists.
    // The parent lock also conflicts with a concurrent controller insert's FK lock.
    const [customer] = await tx.select({ id: customers.id }).from(customers).where(and(
      eq(customers.id, customerId), eq(customers.companyId, companyId),
    )).for("update");
    if (!customer) return null;
    const active = await tx.select({ id: irrigationControllers.id, letter: irrigationControllers.letter })
      .from(irrigationControllers).where(and(
        eq(irrigationControllers.companyId, companyId), eq(irrigationControllers.customerId, customerId),
        eq(irrigationControllers.branchName, branchName), eq(irrigationControllers.isActive, true),
      )).orderBy(irrigationControllers.letter, irrigationControllers.id).for("update");
    const [record] = await tx.select().from(irrigationSiteDocumentation).where(and(
      eq(irrigationSiteDocumentation.companyId, companyId),
      eq(irrigationSiteDocumentation.customerId, customerId),
      eq(irrigationSiteDocumentation.branchName, branchName),
    )).for("update");
    const currentIds = orderedDocumentationControllers(active, record?.controllerOrder).map(c => c.id);
    const same = (a: number[], b: number[]) => a.length === b.length && a.every((id, i) => id === b[i]);
    const currentSet = new Set(currentIds);
    // A retry after an interrupted response is harmless when the desired order is already saved.
    if (same(controllerIds, currentIds)) return { controllerIds };
    if (!same(previousControllerIds, currentIds) || controllerIds.length !== currentIds.length ||
      new Set(controllerIds).size !== controllerIds.length || controllerIds.some(id => !currentSet.has(id))) {
      throw new ControllerOrderConflict();
    }
    // No content/history/verification writes.
    if (!same(controllerIds, currentIds)) {
      await tx.insert(irrigationSiteDocumentation).values({ companyId, customerId, branchName, controllerOrder: controllerIds })
        .onConflictDoUpdate({
          target: [irrigationSiteDocumentation.companyId, irrigationSiteDocumentation.customerId, irrigationSiteDocumentation.branchName],
          set: { controllerOrder: controllerIds },
        });
    }
    return { controllerIds };
  });
}
