import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareMarkupKeys } from "./prepare-markup-keys.mjs";

test("prepares both tenant identity indexes transactionally and idempotently", async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ relation: params?.[0] }] };
    },
  };
  await prepareMarkupKeys(client);
  assert.equal(calls[0].sql, "BEGIN");
  assert.equal(calls.at(-1).sql, "COMMIT");
  assert.deepEqual(calls.filter(c => c.params).map(c => c.params[0]), [
    "public.customers", "public.material_markup_schedules",
  ]);
  const ddl = calls.filter(c => c.sql.startsWith("CREATE"));
  assert.equal(ddl.length, 2);
  for (const call of ddl) {
    assert.match(call.sql, /CREATE UNIQUE INDEX IF NOT EXISTS/);
    assert.match(call.sql, /\("company_id", "id"\)$/);
  }
});

test("leaves absent tables to the schema push", async () => {
  const calls = [];
  await prepareMarkupKeys({
    async query(sql) {
      calls.push(sql);
      return { rows: [{ relation: null }] };
    },
  });
  assert.equal(calls.some(sql => sql.startsWith("CREATE")), false);
  assert.equal(calls.at(-1), "COMMIT");
});

test("rolls back and surfaces prerequisite failures", async () => {
  const calls = [];
  const failure = new Error("index creation failed");
  await assert.rejects(prepareMarkupKeys({
    async query(sql) {
      calls.push(sql);
      if (sql.startsWith("CREATE")) throw failure;
      return { rows: [{ relation: "customers" }] };
    },
  }), failure);
  assert.equal(calls.at(-1), "ROLLBACK");
  assert.equal(calls.includes("COMMIT"), false);
});
