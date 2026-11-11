import { and, eq, asc, sql } from "drizzle-orm";
import { companies, customers, materialMarkupSchedules as schedules, materialMarkupTiers as tiers, customerMarkupScheduleOverrides as overrides } from "@workspace/db";
import { validateMarkupTiers, type MarkupTier } from "@workspace/shared";
import { db } from "../db";

export type MarkupScheduleContext = NonNullable<Awaited<ReturnType<typeof getMarkupSchedule>>>;
export class MarkupNotFound extends Error { readonly status = 404; constructor() { super("Markup schedule or customer not found"); } }
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export async function lockMarkupCompany(tx: Tx, companyId: number) {
  const [company] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).for("update");
  if (!company) throw new MarkupNotFound();
}
export async function getMarkupSchedule(id: number, companyId: number) {
  const [schedule] = await db.select().from(schedules).where(and(eq(schedules.id, id), eq(schedules.companyId, companyId)));
  if (!schedule) return null;
  const rows = await db.select().from(tiers).where(eq(tiers.scheduleId, id)).orderBy(asc(tiers.tierOrder));
  return { schedule, tiers: rows.map(t => ({ tierOrder: t.tierOrder, minCost: Number(t.minCost), maxCost: t.maxCost === null ? null : Number(t.maxCost), markupPercent: Number(t.markupPercent) })) };
}
export async function getActiveMarkupSchedule(companyId: number) {
  const [schedule] = await db.select().from(schedules).where(and(eq(schedules.companyId, companyId), eq(schedules.isActive, true)));
  return schedule ? getMarkupSchedule(schedule.id, companyId) : null;
}
export async function getMarkupSchedules(companyId: number) {
  return db.select().from(schedules).where(eq(schedules.companyId, companyId)).orderBy(asc(schedules.id));
}
export async function insertSchedule(tx: Tx, data: { companyId: number; name: string; effectiveDate: string; tiers: MarkupTier[] }, active = false) {
  validateMarkupTiers(data.tiers);
  if (!data.name.trim() || data.name.length > 200) throw new Error("Schedule name is required (maximum 200 characters)");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.effectiveDate) || new Date(data.effectiveDate).toISOString().slice(0, 10) !== data.effectiveDate) throw new Error("Invalid effective date");
  const [schedule] = await tx.insert(schedules).values({ companyId: data.companyId, name: data.name.trim(), effectiveDate: data.effectiveDate, isActive: active }).returning();
  await tx.insert(tiers).values(data.tiers.map(t => ({ scheduleId: schedule.id, tierOrder: t.tierOrder, minCost: t.minCost.toFixed(2), maxCost: t.maxCost?.toFixed(2) ?? null, markupPercent: t.markupPercent.toFixed(2) })));
  return schedule;
}
export async function createMarkupSchedule(data: Parameters<typeof insertSchedule>[1]) {
  return db.transaction(async tx => { await lockMarkupCompany(tx, data.companyId); return insertSchedule(tx, data); });
}
export async function updateMarkupSchedule(id: number, companyId: number, data: { name?: string; tiers?: MarkupTier[] }) {
  return db.transaction(async tx => {
    await lockMarkupCompany(tx, companyId);
    const old = await getMarkupSchedule(id, companyId);
    if (!old) throw new MarkupNotFound();
    await tx.update(schedules).set({ isActive: false }).where(and(eq(schedules.companyId, companyId), eq(schedules.isActive, true)));
    // Historical tiers/name/date are immutable. Overrides deliberately remain pinned to their contracted version.
    return insertSchedule(tx, { companyId, name: data.name ?? old.schedule.name, effectiveDate: new Date().toISOString().slice(0, 10), tiers: data.tiers ?? old.tiers }, true);
  });
}
export async function activateMarkupSchedule(id: number, companyId: number) {
  await db.transaction(async tx => {
    await lockMarkupCompany(tx, companyId);
    const [target] = await tx.select().from(schedules).where(and(eq(schedules.id, id), eq(schedules.companyId, companyId)));
    if (!target) throw new MarkupNotFound();
    await tx.update(schedules).set({ isActive: false }).where(and(eq(schedules.companyId, companyId), eq(schedules.isActive, true)));
    await tx.update(schedules).set({ isActive: true }).where(and(eq(schedules.id, id), eq(schedules.companyId, companyId)));
  });
}
export async function deactivateMarkupSchedule(id: number, companyId: number) {
  await db.transaction(async tx => {
    await lockMarkupCompany(tx, companyId);
    const rows = await tx.update(schedules).set({ isActive: false }).where(and(eq(schedules.id, id), eq(schedules.companyId, companyId))).returning();
    if (!rows.length) throw new MarkupNotFound();
  });
}
async function requireCustomer(customerId: number, companyId: number) {
  const [customer] = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.id, customerId), eq(customers.companyId, companyId)));
  if (!customer) throw new MarkupNotFound();
}
export async function getCustomerMarkupOverride(customerId: number, companyId: number) {
  await requireCustomer(customerId, companyId);
  const [row] = await db.select().from(overrides).where(and(eq(overrides.companyId, companyId), eq(overrides.customerId, customerId)));
  return row ?? null;
}
export async function setCustomerMarkupOverride(customerId: number, companyId: number, scheduleId: number) {
  await requireCustomer(customerId, companyId);
  if (!await getMarkupSchedule(scheduleId, companyId)) throw new MarkupNotFound();
  const [row] = await db.insert(overrides).values({ customerId, companyId, scheduleId }).onConflictDoUpdate({
    target: [overrides.companyId, overrides.customerId], set: { scheduleId, updatedAt: new Date() },
  }).returning();
  return row;
}
export async function removeCustomerMarkupOverride(customerId: number, companyId: number) {
  await requireCustomer(customerId, companyId);
  await db.delete(overrides).where(and(eq(overrides.companyId, companyId), eq(overrides.customerId, customerId)));
}
