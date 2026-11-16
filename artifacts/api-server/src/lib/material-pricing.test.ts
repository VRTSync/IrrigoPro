import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MARKUP_TIERS } from "@workspace/shared";
import { priceDocumentLines, materialUnitPrice } from "./material-pricing";
import type { Part } from "@workspace/db";

const part = { id: 10, companyId: 1, name: "Valve", price: "50.00", cost: "180.00", category: "Valve" } as Part;
const store = { async getPart(id: number) { return id === 10 ? part : undefined; } };
const schedule = async () => ({ schedule: { id: 1, minimumMarkupDollars: "2.00" } as any, tiers: DEFAULT_MARKUP_TIERS });
test("same document keeps stored line price after rate change and prices new lines currently", async () => {
  let resolutions = 0;
  const result = await priceDocumentLines([
    { id: 71, partId: 10, quantity: 3, unitPrice: "0.01" },
    { partId: 10, quantity: 2, unitPrice: "0.01", existing: true },
    { partId: null, quantity: 2, unitPrice: "8" },
  ], 1, 99, [{ id: 71, partId: 10, unitPrice: "42.75" }], store, "unitPrice", false,
  async () => { resolutions++; return schedule(); });
  assert.equal(resolutions, 1);
  assert.equal(result[0].unitPrice, "42.75");
  assert.equal((result[0] as any).totalPrice, "128.25");
  assert.equal(result[1].unitPrice, "252.00");
  assert.equal(result[2].unitPrice, "8.00");
});
test("estimate partPrice uses stored sourceItemId and rejects tampered new catalog prices", async () => {
  const existing = await priceDocumentLines([{ sourceItemId: 1, partId: 10, quantity: 5, partPrice: ".01" }], 1, null,
    [{ id: 1, partId: 10, partPrice: "7" }], store, "partPrice", true, schedule);
  assert.equal(existing[0].partPrice, "7.00");
  assert.equal((existing[0] as any).totalPrice, "35.00");
  await assert.rejects(priceDocumentLines([{ partId: 10, quantity: 1, partPrice: ".01" }], 1, null, [], store, "partPrice", true, schedule), /changed/);
  await assert.rejects(priceDocumentLines([{ id: 1, partId: 11, quantity: 1 }], 1, null, [{ id: 1, partId: 10, unitPrice: "7" }], store, "unitPrice", false, schedule), /new line/);
  await assert.rejects(priceDocumentLines([{ id: 1, partId: 10 }, { id: 1, partId: 10 }], 1, null, [{ id: 1, partId: 10, unitPrice: "7" }], store, "unitPrice", false, schedule), /more than once/);
});
test("manual, excluded, zero/no cost and absent schedules retain manual catalog prices", async () => {
  const manualOrder = await priceDocumentLines([{ partId: null, quantity: 2, partPrice: "12.50" }], 1, null, [], store, "unitPrice", false, async () => null);
  assert.equal((manualOrder[0] as any).unitPrice, "12.50");
  for (const category of ["Rental", "Service", "Labor"])
    assert.equal(materialUnitPrice({ ...part, category }, await schedule()), 50);
  for (const cost of [null, "", "0"])
    assert.equal(materialUnitPrice({ ...part, cost }, await schedule()), 50);
  assert.equal(materialUnitPrice(part, null), 50);
  const result = await priceDocumentLines([{ partId: 10, quantity: 1, unitPrice: ".01" }], 1, null, [], store, "unitPrice", false, async () => null);
  assert.equal(result[0].unitPrice, "50.00");
});
test("document pricing honors a customer's full schedule including its minimum", async () => {
  const custom = async (_companyId: number, customerId?: number | null) => {
    assert.equal(customerId, 99);
    return { ...await schedule(), schedule: { id: 2, minimumMarkupDollars: "6.50" } as any };
  };
  const cheap = { async getPart() { return { ...part, cost: ".25" }; } };
  const result = await priceDocumentLines([
    { id: 71, partId: 10, quantity: 3, unitPrice: ".01" },
    { partId: 10, quantity: 2, unitPrice: "6.75" },
  ], 1, 99, [{ id: 71, partId: 10, unitPrice: "4.00" }], cheap, "unitPrice", true, custom);
  assert.equal(result[0].unitPrice, "4.00");
  assert.equal(result[1].unitPrice, "6.75");
  assert.equal((result[1] as any).totalPrice, "13.50");
});
test("foreign parts and unscoped requests fail, schedule failures never degrade to manual", async () => {
  await assert.rejects(priceDocumentLines([{ partId: 10 }], 2, null, [], store, "unitPrice", false, schedule), /not found/);
  await assert.rejects(priceDocumentLines([], 0, null, [], store), /company/);
  await assert.rejects(priceDocumentLines([{ partId: 10 }], 1, null, [], store, "unitPrice", false, async () => { throw new Error("offline"); }), /offline/);
});
