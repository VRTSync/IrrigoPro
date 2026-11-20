import {
  db, pool, companies, customers, emailBatches, emailBatchItems, invoices, invoicePdfs,
} from "@workspace/db";
import { and, asc, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";

export type InvoiceBatch = typeof emailBatches.$inferSelect;
export type InvoiceBatchItem = typeof emailBatchItems.$inferSelect;
type NewItem = Omit<typeof emailBatchItems.$inferInsert, "batchId" | "companyId">;
export type BatchLease = { assertHeld(): void; release(): Promise<void> };

export const INTERRUPTED_SEND = "The server restarted while this was sending. Check whether the customer received it before resending.";
const LOCK_NAMESPACE = 1942192;
const scope = (companyId: number) => and(eq(emailBatches.companyId, companyId), eq(emailBatches.kind, "invoice"));
const batchScope = (companyId: number, id: number) => and(scope(companyId), eq(emailBatches.id, id));
const itemsScope = (companyId: number, id: number) =>
  and(eq(emailBatchItems.companyId, companyId), eq(emailBatchItems.batchId, id));

export function summarizeBatch(batch: InvoiceBatch, items: Pick<InvoiceBatchItem, "status">[]) {
  const counts = { queued: 0, sending: 0, sent: 0, skipped: 0, failed: 0 };
  for (const { status } of items) counts[status]++;
  return { id: batch.id, companyId: batch.companyId, status: batch.status, total: items.length, ...counts };
}

export const invoiceBatchStore = {
  async tryLease(companyId: number): Promise<BatchLease | null> {
    // A session lock lives from creation/resume through the last result. A
    // second process starting up must not recover another live worker's mail.
    const client = await pool.connect();
    let lost: Error | undefined;
    const onError = (err: Error) => { lost = err; };
    client.on("error", onError);
    try {
      const result = await client.query<{ held: boolean }>(
        "select pg_try_advisory_lock($1::int, $2::int) as held", [LOCK_NAMESPACE, companyId],
      );
      if (result.rows[0].held) {
        return {
          assertHeld() { if (lost) throw lost; },
          async release() {
            try {
              if (!lost) {
                await client.query("select pg_advisory_unlock($1::int, $2::int)", [LOCK_NAMESPACE, companyId]);
              }
            } catch (err) {
              lost = err as Error;
            } finally {
              client.off("error", onError);
              client.release(lost);
            }
          },
        };
      }
    } catch (err) {
      client.off("error", onError);
      client.release(err as Error);
      throw err;
    }
    client.off("error", onError);
    client.release(lost);
    return null;
  },

  async company(companyId: number) {
    const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
    return company;
  },

  async selected(companyId: number, ids: number[]) {
    const latest = db.select({ sentAt: invoicePdfs.sentAt, createdAt: invoicePdfs.createdAt })
      .from(invoicePdfs)
      .where(and(eq(invoicePdfs.companyId, companyId), eq(invoicePdfs.invoiceId, invoices.id), eq(invoicePdfs.status, "sent")))
      .orderBy(sql`${invoicePdfs.sentAt} desc nulls last`, desc(invoicePdfs.id)).limit(1).as("latest_invoice_batch_copy");
    return db.select({
      invoice: invoices, customer: customers, latest: { sentAt: latest.sentAt, createdAt: latest.createdAt },
    })
      .from(invoices)
      .innerJoin(customers, and(eq(customers.id, invoices.customerId), eq(customers.companyId, companyId)))
      .leftJoinLateral(latest, sql`true`)
      .where(and(eq(invoices.companyId, companyId), inArray(invoices.id, ids)));
  },

  async wasConfirmed(companyId: number, confirmationDigest: string) {
    const [row] = await db.select({ id: emailBatches.id }).from(emailBatches)
      .where(and(scope(companyId), eq(emailBatches.confirmationDigest, confirmationDigest)));
    return !!row;
  },

  async create(companyId: number, userId: number, note: string, confirmationDigest: string, items: NewItem[]) {
    return db.transaction(async (tx) => {
      const [batch] = await tx.insert(emailBatches).values({
        companyId, kind: "invoice", status: "running", note, confirmationDigest, createdByUserId: userId,
      }).returning();
      await tx.insert(emailBatchItems).values(items.map((item) => ({ ...item, companyId, batchId: batch.id })));
      return batch;
    });
  },

  async find(companyId: number, id: number) {
    const [batch] = await db.select().from(emailBatches).where(batchScope(companyId, id));
    return batch;
  },

  async running(companyId: number) {
    const [batch] = await db.select().from(emailBatches)
      .where(and(scope(companyId), eq(emailBatches.status, "running"))).limit(1);
    return batch;
  },

  async active(companyId: number) {
    const [batch] = await db.select().from(emailBatches)
      .where(and(scope(companyId), inArray(emailBatches.status, ["running", "interrupted"])))
      .orderBy(sql`(${emailBatches.status} = 'running') desc`, desc(emailBatches.id)).limit(1);
    return batch;
  },

  async progress(batch: InvoiceBatch) {
    const { reviewedDraft: _, ...visible } = getTableColumns(emailBatchItems);
    const items = await db.select({
      ...visible, invoiceNumber: invoices.invoiceNumber,
      customerLabel: sql<string>`coalesce(${customers.irrigoName}, ${customers.name}, ${invoices.customerName})`,
    }).from(emailBatchItems)
      .innerJoin(invoices, and(eq(invoices.id, emailBatchItems.invoiceId), eq(invoices.companyId, batch.companyId)))
      .leftJoin(customers, and(eq(customers.id, invoices.customerId), eq(customers.companyId, batch.companyId)))
      .where(itemsScope(batch.companyId, batch.id)).orderBy(asc(emailBatchItems.position));
    return { ...batch, ...summarizeBatch(batch, items), items };
  },

  async queued(batch: InvoiceBatch) {
    return db.select().from(emailBatchItems)
      .where(and(itemsScope(batch.companyId, batch.id), eq(emailBatchItems.status, "queued")))
      .orderBy(asc(emailBatchItems.position));
  },

  async markItem(item: InvoiceBatchItem, from: InvoiceBatchItem["status"], update: {
    status: InvoiceBatchItem["status"]; message?: string; sentAt?: Date;
  }) {
    const [row] = await db.update(emailBatchItems).set(update)
      .where(and(itemsScope(item.companyId, item.batchId), eq(emailBatchItems.id, item.id), eq(emailBatchItems.status, from)))
      .returning({ id: emailBatchItems.id });
    return !!row;
  },

  async setBatchStatus(batch: InvoiceBatch, status: "running" | "completed") {
    const [row] = await db.update(emailBatches).set({ status, completedAt: status === "completed" ? new Date() : null })
      .where(and(batchScope(batch.companyId, batch.id), eq(emailBatches.status, batch.status))).returning();
    return row;
  },

  async recover(companyId: number) {
    await db.transaction(async (tx) => {
      const result = await tx.execute<{ held: boolean }>(sql`select pg_try_advisory_xact_lock(${LOCK_NAMESPACE}::int, ${companyId}::int) as held`);
      if (!result.rows[0]?.held) return;
      const interrupted = await tx.update(emailBatches).set({ status: "interrupted" })
        .where(and(scope(companyId), eq(emailBatches.status, "running"))).returning({ id: emailBatches.id });
      if (!interrupted.length) return;
      await tx.update(emailBatchItems).set({ status: "failed", message: INTERRUPTED_SEND })
        .where(and(eq(emailBatchItems.companyId, companyId), inArray(emailBatchItems.batchId, interrupted.map(({ id }) => id)),
          eq(emailBatchItems.status, "sending")));
    });
  },

  async companiesWithRunningBatches() {
    // Startup has no caller; enumerate tenants, then recover one tenant at a time.
    return db.selectDistinct({ companyId: emailBatches.companyId }).from(emailBatches)
      .where(and(eq(emailBatches.kind, "invoice"), eq(emailBatches.status, "running")));
  },
};
