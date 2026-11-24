import { describe, expect, it } from "vitest";
import { navForRole } from "@/components/layout/nav-config";
import { notificationTarget } from "./notification-system";

const estimate = { type: "estimate_pending_approval", relatedEntityType: "estimate", relatedEntityId: 42 };
const workOrder = { type: "work_order_assigned", relatedEntityType: "work_order", relatedEntityId: 43 };
const billingSheet = { type: "billing_sheet_submitted", relatedEntityType: "billing_sheet", relatedEntityId: 44 };
const partsPending = { type: "part_pending_approval" };
const manualPart = { type: "manual_part_pending_review" };

describe("office notification targets", () => {
  it.each([
    ["company_admin", "/estimates/command-center"],
    ["irrigation_manager", "/estimates"],
    ["billing_manager", "/estimates/pending-approval"],
  ])("uses the Estimates page for %s", (role, href) => {
    const sections = navForRole(role);
    expect(notificationTarget(estimate, sections)).toBe(href);
    expect(notificationTarget(workOrder, sections)).toBe("/work-orders");
    expect(notificationTarget(billingSheet, sections)).toBe("/billing-sheets");
  });

  it.each([
    ["company_admin", "/parts-pending-approval"],
    ["irrigation_manager", null],
    ["billing_manager", "/parts-pending-approval"],
  ])("checks parts-review access for %s even without an entity ID", (role, href) => {
    const sections = navForRole(role);
    expect(notificationTarget(partsPending, sections)).toBe(href);
    expect(notificationTarget(manualPart, sections)).toBe(href);
  });

  it("does not send bookkeepers to pages absent from their navigation", () => {
    const sections = navForRole("bookkeeper");
    for (const notification of [estimate, workOrder, billingSheet, partsPending, manualPart]) {
      expect(notificationTarget(notification, sections)).toBeNull();
    }
  });

  it("does not link an entity notification without an entity ID", () => {
    expect(notificationTarget({ ...estimate, relatedEntityId: null }, navForRole("company_admin"))).toBeNull();
  });

  it("does not use field-tech fallback paths for an empty office nav", () => {
    expect(notificationTarget(workOrder, [])).toBeNull();
  });
});

it("keeps the field-tech paths when no navigation sections are passed", () => {
  expect(notificationTarget(workOrder, undefined)).toBe("/work-orders");
  expect(notificationTarget(estimate, undefined)).toBe("/estimates");
  expect(notificationTarget(billingSheet, undefined)).toBe("/billing-sheets");
  expect(notificationTarget(partsPending, undefined)).toBe("/parts-pending-approval");
  expect(notificationTarget(manualPart, undefined)).toBe("/parts-pending-approval");
});
