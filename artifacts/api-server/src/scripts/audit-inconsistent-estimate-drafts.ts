// Task #606 — read-only audit for estimates that may have been left in a
// half-submitted state by the previous PUT-then-/transition wizard flow.
//
// The bug: the wizard saved content with PUT /api/estimates/:id and then
// transitioned the status with a separate POST /api/estimates/:id/transition.
// If the second call failed (network blip, 5xx) the estimate kept its new
// content but its internalStatus stayed 'draft'. From the manager's point
// of view it was a fresh draft; from the user's point of view they had
// clicked "Submit for review" and seen a success-ish toast.
//
// This script is READ-ONLY. It prints a CSV-ish list of suspect drafts so
// you can decide per-row whether to flip them to pending_approval. It does
// NOT mutate anything.
//
// Heuristics (each is conservative — false negatives over false positives):
//   • internalStatus = 'draft'
//   • updated_at significantly after created_at (default: > 5 minutes)
//   • the estimate has at least one line item and a non-zero totalAmount,
//     i.e. the user actually filled it in before the failed submit
//
// Run:
//   node --import tsx/esm \
//     artifacts/api-server/src/scripts/audit-inconsistent-estimate-drafts.ts \
//     [--gap-minutes=5] [--limit=500]

import { db } from "../db";
import { estimates, estimateItems } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";

function parseArg(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!raw) return fallback;
  const n = Number(raw.split("=")[1]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function main(): Promise<void> {
  const gapMinutes = parseArg("gap-minutes", 5);
  const limit = parseArg("limit", 500);

  const rows = await db
    .select({
      id: estimates.id,
      estimateNumber: estimates.estimateNumber,
      companyId: estimates.companyId,
      customerId: estimates.customerId,
      totalAmount: estimates.totalAmount,
      createdAt: estimates.createdAt,
      updatedAt: estimates.updatedAt,
      gapSeconds: sql<number>`extract(epoch from (${estimates.updatedAt} - ${estimates.createdAt}))`,
    })
    .from(estimates)
    .where(
      and(
        eq(estimates.internalStatus, "draft"),
        sql`${estimates.updatedAt} > ${estimates.createdAt} + (${gapMinutes} * interval '1 minute')`,
      ),
    )
    .orderBy(sql`${estimates.updatedAt} desc`)
    .limit(limit);

  // Filter further on item presence — drafts with zero items are
  // genuine "I started a draft" rows, not half-submitted ones.
  const suspects: typeof rows = [];
  for (const r of rows) {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(estimateItems)
      .where(eq(estimateItems.estimateId, r.id));
    if (n > 0) suspects.push(r);
  }

  console.log(
    `id,estimateNumber,companyId,customerId,totalAmount,createdAt,updatedAt,gapSeconds`,
  );
  for (const r of suspects) {
    console.log(
      [
        r.id,
        r.estimateNumber ?? "",
        r.companyId ?? "",
        r.customerId ?? "",
        r.totalAmount ?? "",
        r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
        r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
        Math.round(Number(r.gapSeconds)),
      ].join(","),
    );
  }
  console.error(
    `[audit] ${suspects.length} suspect draft(s) found (gap > ${gapMinutes}m, at least 1 item).`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
