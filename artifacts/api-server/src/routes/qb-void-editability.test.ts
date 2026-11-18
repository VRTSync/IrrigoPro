import assert from "node:assert/strict";
import { it, mock } from "node:test";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { withVoidFixture } from "../lib/void-release.fixtures";
import { syncPaymentStatusForCompany } from "./qb-payment-sync";
import { createUnlinkVoidedRanchMigration } from "../lib/migrations/unlink-voided-ranch-invoices";

it("normal storage price edits reject billed status even without a link, then work after automatic release or Ranch repair", async () => {
  await withVoidFixture(async q => {
    // Exercise the actual storage guards and real updates, using the isolated
    // connection instead of the global connection pool.
    const spy = mock.method(db, "transaction", (fn: any) => q.transaction(fn));
    const edits = [
      () => storage.recomputeBillingSheetTotalsForRateMode(92, "normal", 1),
      () => storage.recomputeWorkOrderTotalsForRateMode(92, "normal", 1),
      () => storage.recomputeWcbTotalsForLaborRate(92, 45, 1),
    ];
    try {
      for (const table of ["billing_sheets", "work_orders", "wet_check_billings"])
        await q.execute(sql`update ${sql.identifier(table)} set invoice_id=null where id=92`);
      for (const edit of edits) await assert.rejects(edit, /locked/);
      for (const table of ["billing_sheets", "work_orders", "wet_check_billings"])
        await q.execute(sql`update ${sql.identifier(table)} set invoice_id=21 where id=92`);
      await syncPaymentStatusForCompany("1", {
        _db: q, apiBase: "https://fixture.invalid",
        getQbIntegration: async () => ({ realmId: "fixture", accessToken: "fixture" }),
        makeRequest: async () => ({
          ok: true, status: 200,
          json: async () => ({ QueryResponse: { Invoice: [{ Id: "QB21", TotalAmt: 0, Balance: 0, PrivateNote: "Voided" }] } }),
        }) as any,
      });
      for (const edit of edits) await edit();
      // Restore just this named sheet to the original stuck state; migration
      // must remove exactly the same actual edit guard.
      await q.execute(sql`update billing_sheets set invoice_id=21, billed_at=now(), status='billed' where id=92`);
      const result = await createUnlinkVoidedRanchMigration(q).run(() => {}, { acknowledged: true });
      assert.ok(result.every(r => r.status !== "failed"), JSON.stringify(result));
      await edits[0]();
    } finally { spy.mock.restore(); }
  });
});
