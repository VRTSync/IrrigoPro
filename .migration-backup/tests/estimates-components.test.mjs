/**
 * Tests for Task #374 — Slice 10c component-level rendering.
 *
 * Mounts the actual React components into a jsdom DOM and asserts:
 *   - BoardListToggle marks the selected tab with aria-selected="true"
 *     and the unselected one with aria-selected="false".
 *   - The Resend menu item rendered by the EstimateListRow's row
 *     actions menu is enabled only for expired estimates (and only
 *     when an onResendClick handler is wired) and otherwise carries
 *     the "Only available for expired estimates" tooltip.
 */

import { test, describe, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

let React;
let createRoot;
let act;
let BoardListToggle;
let EstimateListRow;

before(async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.navigator = dom.window.navigator;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Element = dom.window.Element;
  globalThis.Node = dom.window.Node;
  globalThis.Event = dom.window.Event;
  globalThis.CustomEvent = dom.window.CustomEvent;
  globalThis.MouseEvent = dom.window.MouseEvent;
  globalThis.PointerEvent = dom.window.PointerEvent ?? dom.window.MouseEvent;
  globalThis.KeyboardEvent = dom.window.KeyboardEvent;
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.MutationObserver = dom.window.MutationObserver;
  globalThis.ResizeObserver = dom.window.ResizeObserver ?? class {
    observe() {} unobserve() {} disconnect() {}
  };
  globalThis.DOMRect = dom.window.DOMRect ?? class {
    static fromRect() { return new this(); }
  };
  if (!dom.window.HTMLElement.prototype.hasPointerCapture) {
    dom.window.HTMLElement.prototype.hasPointerCapture = () => false;
    dom.window.HTMLElement.prototype.setPointerCapture = () => {};
    dom.window.HTMLElement.prototype.releasePointerCapture = () => {};
  }
  if (!dom.window.HTMLElement.prototype.scrollIntoView) {
    dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  }

  React = (await import("react")).default;
  globalThis.React = React;
  ({ createRoot } = await import("react-dom/client"));
  ({ act } = await import("react"));

  ({ BoardListToggle } = await import(
    "../client/src/components/estimates/board-list-toggle.tsx"
  ));
  ({ EstimateListRow } = await import(
    "../client/src/components/estimates/list/estimate-list-row.tsx"
  ));
});

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

async function render(node) {
  await act(async () => {
    root.render(node);
  });
}

const BASE_ESTIMATE = {
  id: 42,
  customerId: 1,
  customerName: "Acme Co",
  customerEmail: "a@b.test",
  customerPhone: "",
  projectName: "Sprinklers",
  projectAddress: "",
  locationNotes: "",
  accessInstructions: "",
  estimateNumber: "EST-1",
  status: "pending",
  internalStatus: "pending_approval",
  totalAmount: "100.00",
  partsSubtotal: "100.00",
  laborSubtotal: "0.00",
  laborRate: "75.00",
  estimateDate: "2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  photos: [],
  attachments: [],
  workLocationLat: null,
  workLocationLng: null,
  workLocationAddress: null,
  controllerLetter: null,
  zoneNumber: null,
  approvalToken: null,
  approvalSentAt: null,
  tokenExpiresAt: null,
  approvedAt: null,
  rejectedAt: null,
  createdBy: "",
  companyId: 99,
  customerSignature: null,
  rejectionReason: null,
  notes: null,
};

describe("BoardListToggle render (Slice 10c)", () => {
  test("value='board' marks the Board tab selected and List unselected", async () => {
    await render(React.createElement(BoardListToggle, { value: "board", onChange: () => {} }));
    const board = document.querySelector('[data-testid="view-toggle-board"]');
    const list = document.querySelector('[data-testid="view-toggle-list"]');
    assert.ok(board && list);
    assert.equal(board.getAttribute("aria-selected"), "true");
    assert.equal(list.getAttribute("aria-selected"), "false");
  });

  test("value='list' flips the selection", async () => {
    await render(React.createElement(BoardListToggle, { value: "list", onChange: () => {} }));
    const board = document.querySelector('[data-testid="view-toggle-board"]');
    const list = document.querySelector('[data-testid="view-toggle-list"]');
    assert.equal(list.getAttribute("aria-selected"), "true");
    assert.equal(board.getAttribute("aria-selected"), "false");
  });

  test("clicking a tab fires onChange with the new view", async () => {
    let last = null;
    await render(
      React.createElement(BoardListToggle, {
        value: "board",
        onChange: (next) => { last = next; },
      }),
    );
    const list = document.querySelector('[data-testid="view-toggle-list"]');
    await act(async () => { list.click(); });
    assert.equal(last, "list");
  });
});

async function renderRowAndOpenMenu(estimate, lifecycle, onResendClick) {
  await render(
    React.createElement(EstimateListRow, {
      estimate,
      lifecycle,
      onOpen: () => {},
      onEdit: () => {},
      onResendClick,
    }),
  );
  // Radix's DropdownMenuTrigger opens on pointerdown (mouse) or
  // Enter/Space/ArrowDown (keyboard) — plain .click() is ignored.
  const trigger = container.querySelector('[aria-haspopup="menu"]')
    ?? container.querySelector('button[aria-expanded]');
  assert.ok(trigger, "row must render a dropdown trigger button");
  await act(async () => {
    const PE = window.PointerEvent ?? window.MouseEvent;
    trigger.dispatchEvent(new PE("pointerdown", { bubbles: true, button: 0 }));
    trigger.dispatchEvent(new PE("pointerup", { bubbles: true, button: 0 }));
    trigger.dispatchEvent(new window.MouseEvent("click", { bubbles: true, button: 0 }));
  });
  // Radix portal renders to document.body.
  return document.querySelector(`[data-testid="list-row-resend-${estimate.id}"]`);
}

describe("EstimateListRow Resend menu item gating (real Radix render)", () => {
  test("expired with onResendClick → Resend is enabled", async () => {
    const item = await renderRowAndOpenMenu(
      { ...BASE_ESTIMATE, lifecycleStatus: "expired" },
      "expired",
      () => {},
    );
    assert.ok(item, "Resend menu item must mount when the menu opens");
    assert.equal(item.getAttribute("aria-disabled"), null,
      "expired Resend should not be aria-disabled");
    assert.equal(item.hasAttribute("data-disabled"), false,
      "expired Resend should not have data-disabled");
    assert.equal(item.getAttribute("title"), "Resend to customer");
  });

  test("expired without onResendClick → Resend is disabled (no handler wired)", async () => {
    const item = await renderRowAndOpenMenu(
      { ...BASE_ESTIMATE, lifecycleStatus: "expired" },
      "expired",
      undefined,
    );
    assert.ok(item, "Resend menu item must mount");
    const disabled =
      item.getAttribute("aria-disabled") === "true"
      || item.hasAttribute("data-disabled");
    assert.ok(disabled,
      "Resend should be disabled when no onResendClick handler is wired");
  });

  test("non-expired lifecycles → Resend is disabled with the gated tooltip", async () => {
    for (const lc of ["draft", "pending_review", "sent", "approved", "rejected"]) {
      // Re-render fresh for each lifecycle.
      await act(async () => { root.unmount(); });
      container.remove();
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);

      const item = await renderRowAndOpenMenu(
        { ...BASE_ESTIMATE, lifecycleStatus: lc },
        lc,
        () => {},
      );
      assert.ok(item, `Resend menu item must mount for ${lc}`);
      const disabled =
        item.getAttribute("aria-disabled") === "true"
        || item.hasAttribute("data-disabled");
      assert.ok(disabled, `Resend should be disabled for ${lc}`);
      assert.equal(item.getAttribute("title"),
        "Only available for expired estimates");
    }
  });
});
