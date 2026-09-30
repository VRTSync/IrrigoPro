import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateActionBoardPlan, type PlanBoardRow } from "./action-board-plan.js";

const date = new Date(2025, 8, 3);
const clear = (overrides: Partial<PlanBoardRow>): PlanBoardRow => ({
  lane: "clear_to_send", customerName: "Huntington Trails", headroom: 6000, ...overrides,
});
const plan = (rows: PlanBoardRow[], width = 38) => generateActionBoardPlan(rows, date, width);
const closing = "Work orders are in the app under each\nproperty.";

describe("Action Board message golden outputs", () => {
  it("only work orders: ceiling is headroom, not the orders' dollar totals", () => {
    assert.equal(plan([clear({ openWorkOrders: [{ workOrderNumber: "WO-1042" }, { workOrderNumber: "WO-1051" }] })]),
      `Wed Sep 3\n\nHuntington Trails\n  DNE $6,000\n  2 work orders - WO-1042, WO-1051\n\n${closing}`);
  });
  it("only a due wet check with last date", () => {
    assert.equal(plan([clear({ customerName: "Copper Ridge HOA", headroom: 2400, wetCheckDue: true,
      newestWetCheck: { startedAt: "2025-07-24T12:00:00Z" } })]),
    `Wed Sep 3\n\nCopper Ridge HOA\n  DNE $2,400\n  Wet check due - last was 24 Jul\n\n${closing}`);
  });
  it("both work and wet check without a previous check", () => {
    assert.equal(plan([clear({ customerName: "Ashford Park", headroom: 2000,
      openWorkOrders: [{ workOrderNumber: "WO-1048" }], wetCheckDue: true })]),
    `Wed Sep 3\n\nAshford Park\n  DNE $2,000\n  1 work order - WO-1048\n  Wet check due\n\n${closing}`);
  });
  it("pre-approved work over budget and a due inspection carries full crew instruction", () => {
    assert.equal(plan([clear({ customerName: "Sunrise Estates HOA", headroom: -1240,
      openWorkOrders: [{ workOrderNumber: "WO-2001", preApproved: true }, { workOrderNumber: "WO-2002", preApproved: true }],
      wetCheckDue: true, inspectionOnly: true })]),
    `Wed Sep 3\n\nSunrise Estates HOA\n  2 work orders - WO-2001, WO-2002\n  Pre-approved, outside the budget. Go\n  ahead.\n  Wet check also due - INSPECTION\n  ONLY. Document, do not repair. It\n  comes back as an estimate.\n\n${closing}`);
  });
  it("holds unaffordable or unknown unapproved orders even when another order is approved", () => {
    const approved = { number: "WO-1", estimatedTotal: 500, preApproved: true };
    const held = { number: "WO-2", estimatedTotal: 250 };
    const base = clear({ customerName: "Mixed Approval", headroom: 200,
      openWorkOrders: [approved, held] });
    const expected = `Wed Sep 3\n\nMixed Approval\n  1 work order - WO-1\n  Pre-approved, outside the budget. Go\n  ahead.\n\n${closing}`;
    assert.equal(plan([base]), expected);
    assert.equal(plan([{ ...base, openWorkOrders: [approved, { number: "WO-2" }] }]), expected);
  });
  it("includes unapproved orders only when their combined estimates fit the board's ceiling", () => {
    const row = clear({ customerName: "Mixed Approval", headroom: 200,
      openWorkOrders: [
        { number: "WO-1", estimatedTotal: 500, preApproved: true },
        { number: "WO-2", estimatedTotal: 150 },
      ] });
    assert.equal(plan([row]), `Wed Sep 3\n\nMixed Approval\n  DNE $200\n  2 work orders - WO-1, WO-2\n\n${closing}`);
  });
  it("does not hide a due service wet check just because a work order is held", () => {
    assert.equal(plan([clear({ lane: "over_budget_nothing_approved", customerName: "Due Service", headroom: 200,
      openWorkOrders: [{ number: "WO-9", estimatedTotal: 300 }], wetCheckDue: true,
      inspectionOnly: false })]),
    `Wed Sep 3\n\nDue Service\n  DNE $200\n  Wet check due\n\n${closing}`);
  });
  it("over-budget wet check is an inspection, while unapproved work orders remain held", () => {
    assert.equal(plan([clear({ lane: "over_budget_nothing_approved", customerName: "Inspection Site",
      headroom: -300, openWorkOrders: [{ workOrderNumber: "WO-9" }],
      wetCheckDue: true, inspectionOnly: true })]),
    `Wed Sep 3\n\nInspection Site\n  Wet check also due - INSPECTION\n  ONLY. Document, do not repair. It\n  comes back as an estimate.\n\n${closing}`);
  });
  it("nothing pending produces no clear block", () => {
    assert.equal(plan([clear({ lane: "nothing_pending", openWorkOrders: [], wetCheckDue: false })]),
      `Wed Sep 3\n\nNo work to send today.\n\n${closing}`);
  });
  it("an empty board says so instead of showing only a date", () => {
    assert.equal(plan([]), `Wed Sep 3\n\nNo work to send today.\n\n${closing}`);
  });
  it("blocked properties contain names only; amounts, counts and reasons cannot leak", () => {
    const text = plan([
      clear({ openWorkOrders: [{ number: "WO-1" }] }),
      clear({ lane: "over_budget_nothing_approved", customerName: "Desert Springs CC",
        headroom: -4000, openWorkOrders: [{ number: "WO-4" }] }),
      clear({ lane: "over_budget_nothing_approved", customerName: "Stonebridge Villas",
        headroom: -800, openWorkOrders: [{ number: "WO-5" }] }),
    ]);
    const section = text.split("Not clear to work\n")[1]!.split("\n\n")[0];
    assert.equal(section, "  Desert Springs CC\n  Stonebridge Villas");
    assert.doesNotMatch(section, /\$|\d|WO-|reason|budget/i);
  });
  it("width only changes wrapping, not content; long names are not truncated", () => {
    const row = clear({ customerName: "Huntington Trails With A Very Long Property Name",
      openWorkOrders: [{ number: "WO-1042" }], wetCheckDue: true });
    const desktop = plan([row]);
    const phone = plan([row], 26);
    const unwrapped = (s: string) => s.replace(/\n/g, " ").replace(/ +/g, " ").trim();
    assert.equal(unwrapped(desktop), unwrapped(phone));
    assert.ok(phone.split("\n").every((line) => line.length <= 26));
    assert.match(phone, /It comes back|Wet check due/);
  });
});