// Shared isolated real-DB fixtures for the existing migration and field suites.
import * as s from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import type { DbExecutor } from "./ticket-controller-binding";

export async function createBindingFixture(q: DbExecutor) {
  const [company] = await q.insert(s.companies).values({ name: `Clock binding ${crypto.randomUUID()}` }).returning();
  const [customer] = await q.insert(s.customers).values({ companyId: company.id, name: "Binding customer", email: "binding@test.example" }).returning();
  const [user] = await q.insert(s.users).values({
    companyId: company.id, username: `binding-${crypto.randomUUID()}`, password: "unused", name: "Binding manager", role: "company_admin",
  }).returning();
  const controllers = await q.insert(s.irrigationControllers).values(["D", "E"].map(letter => ({
    companyId: company.id, customerId: customer.id, branchName: "", letter, name: `Clock ${letter}`,
  }))).returning();
  const sheet = async (patch: Partial<typeof s.billingSheets.$inferInsert> = {}) => {
    const [row] = await q.insert(s.billingSheets).values({
      companyId: company.id, customerId: customer.id, billingNumber: `BIND-${crypto.randomUUID()}`,
      customerName: customer.name, propertyAddress: "Test", technicianName: user.name,
      workDescription: "Binding fixture", workDate: new Date(), totalHours: "0", laborRate: "45",
      laborSubtotal: "0", partsSubtotal: "0", totalAmount: "0", controllerLetter: "D", zoneNumber: 5, ...patch,
    }).returning();
    return row;
  };
  const wetCheck = async (branchName: string | null = null) => {
    const [row] = await q.insert(s.wetChecks).values({
      companyId: company.id, customerId: customer.id, customerName: customer.name, technicianId: user.id,
      technicianName: user.name, numControllers: 2, branchName,
    }).returning();
    return row;
  };
  return { company, customer, user, controllers, sheet, wetCheck };
}

export async function cleanupBindingFixture(q: DbExecutor, companyId: number) {
  const orders = await q.select({ id: s.workOrders.id }).from(s.workOrders).where(eq(s.workOrders.companyId, companyId));
  const estimates = await q.select({ id: s.estimates.id }).from(s.estimates).where(eq(s.estimates.companyId, companyId));
  if (orders.length) {
    await q.delete(s.workOrderZonePhotos).where(inArray(s.workOrderZonePhotos.workOrderId, orders.map(row => row.id)));
    await q.delete(s.workOrderItems).where(inArray(s.workOrderItems.workOrderId, orders.map(row => row.id)));
  }
  if (estimates.length) await q.delete(s.estimateItems).where(inArray(s.estimateItems.estimateId, estimates.map(row => row.id)));
  await q.delete(s.billingSheets).where(eq(s.billingSheets.companyId, companyId));
  await q.delete(s.workOrders).where(eq(s.workOrders.companyId, companyId));
  await q.delete(s.estimates).where(eq(s.estimates.companyId, companyId));
  await q.delete(s.wetChecks).where(eq(s.wetChecks.companyId, companyId));
  const controllers = await q.select({ id: s.irrigationControllers.id }).from(s.irrigationControllers).where(eq(s.irrigationControllers.companyId, companyId));
  if (controllers.length) await q.delete(s.irrigationProfileHistory).where(inArray(s.irrigationProfileHistory.controllerId, controllers.map(row => row.id)));
  await q.delete(s.irrigationControllers).where(eq(s.irrigationControllers.companyId, companyId));
  await q.delete(s.users).where(eq(s.users.companyId, companyId));
  await q.delete(s.customers).where(eq(s.customers.companyId, companyId));
  await q.delete(s.companies).where(eq(s.companies.id, companyId));
}
