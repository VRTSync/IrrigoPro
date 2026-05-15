// Task #643 — one-shot data migration that renames any users.role rows
// still using the retired `manager` alias to the canonical
// `irrigation_manager`. Idempotent: running twice is a no-op once the
// first run has flipped every row.
//
// Usage:
//   node --import tsx/esm artifacts/api-server/src/scripts/rename-manager-role.ts [--dry-run]

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const before = await db.execute(
    sql`SELECT id, username, role FROM users WHERE role = 'manager'`,
  );
  const rows = before.rows as Array<{ id: number; username: string; role: string }>;
  if (rows.length === 0) {
    console.log("[rename-manager-role] No users with role='manager' — nothing to do.");
    return;
  }
  console.log(
    `[rename-manager-role] Found ${rows.length} user(s) with the retired role:`,
  );
  for (const r of rows) {
    console.log(`  - id=${r.id} username=${r.username}`);
  }
  if (dryRun) {
    console.log("[rename-manager-role] --dry-run set; no rows updated.");
    return;
  }
  const updated = await db.execute(
    sql`UPDATE users SET role = 'irrigation_manager', updated_at = NOW() WHERE role = 'manager' RETURNING id`,
  );
  console.log(
    `[rename-manager-role] Updated ${updated.rows.length} user(s) to role='irrigation_manager'.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[rename-manager-role] failed:", err);
    process.exit(1);
  });
