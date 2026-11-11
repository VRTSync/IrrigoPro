import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareMarkupKeys } from "./prepare-markup-keys.mjs";

test("prepares tenant identity constraints using existing indexes without dropping FKs", async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: sql.includes("pg_constraint") ? [] : [{ relation: params?.[0] }] };
    },
  };
  await prepareMarkupKeys(client);
  assert.equal(calls[0].sql, "BEGIN");
  assert.equal(calls.at(-1).sql, "COMMIT");
  assert.deepEqual(calls.filter(c => c.sql.includes("AS relation")).map(c => c.params[0]), [
    "public.customers", "public.material_markup_schedules",
  ]);
  const ddl = calls.filter(c => c.sql.startsWith("CREATE"));
  assert.equal(ddl.length, 2);
  for (const call of ddl) {
    assert.match(call.sql, /CREATE UNIQUE INDEX IF NOT EXISTS/);
    assert.match(call.sql, /\("company_id", "id"\)$/);
  }
  const constraints = calls.filter(c => c.sql.startsWith("ALTER"));
  assert.equal(constraints.length, 2);
  for (const call of constraints) assert.match(call.sql, /UNIQUE USING INDEX/);
  assert.equal(calls.some(c => /DROP/.test(c.sql)), false);
});

test("repeat runs skip both already-attached unique constraints", async () => {
  const calls = [];
  await prepareMarkupKeys({
    async query(sql) {
      calls.push(sql);
      return { rows: [{ relation: "exists" }] };
    },
  });
  assert.equal(calls.some(sql => /^(CREATE|ALTER)/.test(sql)), false);
  assert.equal(calls.at(-1), "COMMIT");
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
      return { rows: sql.includes("pg_constraint") ? [] : [{ relation: "customers" }] };
    },
  }), failure);
  assert.equal(calls.at(-1), "ROLLBACK");
  assert.equal(calls.includes("COMMIT"), false);
});

test("rolls back if attaching an existing index fails", async () => {
  const calls = [];
  const failure = new Error("constraint attach failed");
  await assert.rejects(prepareMarkupKeys({
    async query(sql) {
      calls.push(sql);
      if (sql.startsWith("ALTER")) throw failure;
      return { rows: sql.includes("pg_constraint") ? [] : [{ relation: "exists" }] };
    },
  }), failure);
  assert.equal(calls.at(-1), "ROLLBACK");
  assert.equal(calls.includes("COMMIT"), false);
});
