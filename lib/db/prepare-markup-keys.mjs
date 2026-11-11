import pg from "pg";
import { pathToFileURL } from "node:url";

// Development post-merge prerequisite only. Drizzle may add foreign keys
// before their referenced unique keys on tables that already exist.
// Use real UNIQUE constraints: Drizzle's introspector hides standalone indexes
// referenced by foreign keys, causing repeated CREATE INDEX on the next push.
export async function prepareMarkupKeys(client) {
  const keys = [
    ["customers", "customers_company_identity"],
    ["material_markup_schedules", "markup_schedule_company_identity"],
  ];
  await client.query("BEGIN");
  try {
    for (const [table, index] of keys) {
      const result = await client.query(
        "SELECT to_regclass($1) AS relation",
        [`public.${table}`],
      );
      // On a fresh database the normal schema push owns table creation.
      if (!result.rows[0].relation) continue;
      const constraint = await client.query(
        `SELECT 1 FROM pg_constraint
         WHERE conrelid = to_regclass($1) AND conname = $2 AND contype = 'u'`,
        [`public.${table}`, index],
      );
      if (constraint.rows.length) continue;
      // Identifiers come exclusively from the fixed list above.
      await client.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS "${index}" ON public."${table}" ("company_id", "id")`,
      );
      // Reuse the existing index without dropping/rebuilding it or its FKs.
      await client.query(
        `ALTER TABLE public."${table}" ADD CONSTRAINT "${index}" UNIQUE USING INDEX "${index}"`,
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await prepareMarkupKeys(client);
    console.log("Material markup foreign-key prerequisites prepared.");
  } finally {
    await client.end();
  }
}
