import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import {
  budgetStatus,
  canViewActionBoard,
  createCopyPlanPressHandler,
  formatDoNotExceed,
  formatWetCheck,
  groupActionBoardRows,
  planTextForBoard,
  resolveBoardViewState,
  type ActionBoardRow,
} from "./action-board";

const row = (lane: ActionBoardRow["lane"], id: number): ActionBoardRow => ({
  customerId: id,
  customerName: `Property ${id}`,
  allocation: 6_000,
  headroom: 3_000,
  totalSpend: 3_000,
  softThresholdPercent: 75,
  hardThresholdPercent: 100,
  openWorkOrders: [{ id: 1042, number: "WO-1042" }],
  wetCheck: null,
  wetCheckDue: true,
  inspectionOnly: false,
  lane,
});

describe("action board logic", () => {
  it("groups every lane from one fixture", () => {
    const grouped = groupActionBoardRows([
      row("clear_to_send", 1),
      row("over_budget_nothing_approved", 2),
      row("nothing_pending", 3),
    ]);
    assert.deepEqual(Object.values(grouped).map((items) => items[0]?.customerId), [1, 2, 3]);
  });

  it("formats DNE and wet-check text", () => {
    assert.equal(formatDoNotExceed(6000), "DNE $6,000");
    assert.equal(formatWetCheck(row("clear_to_send", 1)), "Wet check due");
  });

  it("uses the shared budget classifier", () => {
    assert.equal(budgetStatus(row("clear_to_send", 1)), "healthy");
  });

  it("names the no-allocation and offline cold-start states", () => {
    assert.equal(
      resolveBoardViewState({ data: { rows: [], excludedWithoutBudgetGoal: 1, year: 2026, month: 9, rollup: { seasonPaceTarget: 0, seasonPaceSpend: 0 } }, online: true, isError: false }),
      "no-allocations",
    );
    assert.equal(
      resolveBoardViewState({ data: undefined, online: false, isError: true }),
      "offline-no-cache",
    );
  });

  it("refuses field technicians", () => {
    assert.equal(canViewActionBoard("field_tech"), false);
    assert.equal(canViewActionBoard("irrigation_manager"), true);
  });

  it("shows an honest error when an online request fails", () => {
    assert.equal(
      resolveBoardViewState({ data: undefined, online: true, isError: true }),
      "error",
    );
  });
  it("uses the shared generator for the editable plan's initial text", () => {
    const text = planTextForBoard({
      year: 2026,
      month: 9,
      excludedWithoutBudgetGoal: 0,
      rollup: { seasonPaceTarget: 0, seasonPaceSpend: 0 },
      rows: [row("clear_to_send", 1)],
    });
    assert.match(text, /Property 1\n  DNE \$3,000/);
    assert.match(text, /1 work order - WO-1042/);
    assert.match(text, /Wet check due/);
  });
  it("copies the edited plan only when the press handler is invoked", async () => {
    const writes: string[] = [];
    let message = "";
    const onPress = createCopyPlanPressHandler(
      "edited on the phone",
      async (text) => { writes.push(text); },
      () => { message = "Copied"; },
      () => { message = "Failed"; },
    );
    assert.deepEqual(writes, []);
    await onPress();
    assert.deepEqual(writes, ["edited on the phone"]);
    assert.equal(message, "Copied");
  });
  it("reports a clipboard write that returns false", async () => {
    let message = "";
    const onPress = createCopyPlanPressHandler(
      "text", async () => false,
      () => { message = "Copied"; },
      () => { message = "Failed"; },
    );
    await onPress();
    assert.equal(message, "Failed");
  });
});

describe("schedule route regression", () => {
  it("replaces only the schedule stub", async () => {
    const schedule = await readFile(new URL("../app/schedule.tsx", import.meta.url), "utf8");
    const assign = await readFile(
      new URL("../app/work-order/assign.tsx", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(schedule, /Coming soon/);
    assert.match(assign, /Coming soon/);
  });
});