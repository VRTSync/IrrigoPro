import { test, describe } from "node:test";
import assert from "node:assert/strict";

const { EmailService } = await import("../server/email-service.ts");

const baseData = {
  estimateId: 1,
  estimateNumber: "EST-0001",
  customerName: "Jane Doe",
  customerEmail: "jane@example.com",
  projectName: "Backyard Drip System",
  projectAddress: "123 Garden Ln",
  totalAmount: "$1,234.56",
  approvalToken: "tok_render_test",
  estimateDate: "5/4/2026",
  createdBy: "Alice Tech",
  companyId: 99,
};

const items = [
  {
    description: "Replace 3 broken sprinkler heads in front yard",
    partName: "Hunter PGP Head",
    quantity: 3,
    partPrice: 12.5,
    laborHours: 0.5,
    partsCost: 37.5,
    laborCost: 75.0,
    lineTotal: 112.5,
  },
  {
    description: "Install new master valve",
    partName: "Rainbird PESB Valve",
    quantity: 1,
    partPrice: 45.0,
    laborHours: 1.0,
    partsCost: 45.0,
    laborCost: 50.0,
    lineTotal: 95.0,
  },
];

const companyInfo = {
  name: "Test Irrigation Co",
  logo: null,
  email: "info@testirrigation.com",
  phone: "555-0100",
  website: "https://testirrigation.com",
};

describe("EmailService — flat-items rendering (no zones)", () => {
  test("HTML contains every line-item description and renders no zone headings", () => {
    const html = EmailService.generateEstimateEmailHTML(
      { ...baseData, items },
      "https://x/approve",
      "https://x/reject",
      "https://x/view",
      companyInfo,
    );

    for (const item of items) {
      assert.ok(html.includes(item.description), `HTML missing description: ${item.description}`);
    }
    assert.ok(html.includes("Line Items"), "HTML should have Line Items heading");
    assert.ok(!/\bZone\b/i.test(html), "HTML must not mention Zones anywhere");
    assert.ok(!html.includes("zoneId"), "HTML must not leak zoneId");
  });

  test("Plain-text body contains every description and no zone tokens", () => {
    const text = EmailService.generateEstimateEmailText(
      { ...baseData, items },
      "https://x/approve",
      "https://x/reject",
      companyInfo,
    );

    for (const item of items) {
      assert.ok(text.includes(item.description), `text missing description: ${item.description}`);
    }
    assert.ok(text.includes("LINE ITEMS"));
    assert.ok(!/\bzone\b/i.test(text), "text must not mention zones");
  });

  test("Falls back to partName when description is empty", () => {
    const itemNoDesc = [{ ...items[0], description: "" }];
    const html = EmailService.generateEstimateEmailHTML(
      { ...baseData, items: itemNoDesc },
      "https://x/a",
      "https://x/r",
      "https://x/v",
      companyInfo,
    );
    assert.ok(html.includes("Hunter PGP Head"), "should fall back to partName when description blank");
  });

  test("Empty items array renders no Line Items section", () => {
    const html = EmailService.generateEstimateEmailHTML(
      { ...baseData, items: [] },
      "https://x/a",
      "https://x/r",
      "https://x/v",
      companyInfo,
    );
    assert.ok(!html.includes("Line Items"), "no Line Items heading when items empty");
  });
});
