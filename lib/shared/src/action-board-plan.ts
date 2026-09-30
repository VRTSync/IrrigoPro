/** The dispatch message is shared by web and native clients. No UI or storage dependencies. */
export interface PlanWorkOrder {
  number?: string | null;
  workOrderNumber?: string | null;
  preApproved?: boolean;
  estimatedTotal?: number | string | null;
}

export interface PlanBoardRow {
  customerName: string;
  lane: string;
  headroom?: number | null;
  doNotExceed?: number | null;
  openWorkOrders?: PlanWorkOrder[];
  workOrders?: PlanWorkOrder[];
  preApproved?: boolean;
  wetCheckDue?: boolean;
  inspectionOnly?: boolean;
  wetCheck?: { due?: boolean; inspectionOnly?: boolean; startedAt?: string | null } | null;
  newestWetCheck?: { startedAt?: string | null } | null;
}

function wrap(text: string, width: number, indent = ""): string {
  const limit = Math.max(1, width - indent.length);
  const lines: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/)) {
    if (!word) continue;
    if (line && line.length + 1 + word.length > limit) {
      lines.push(indent + line);
      line = "";
    }
    // A single long property name or identifier must not overflow the message.
    let rest = word;
    while (rest.length > limit) {
      if (line) {
        lines.push(indent + line);
        line = "";
      }
      lines.push(indent + rest.slice(0, limit));
      rest = rest.slice(limit);
    }
    if (rest) line = line ? `${line} ${rest}` : rest;
  }
  if (line) lines.push(indent + line);
  return lines.join("\n");
}

function lastCheckLabel(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: "UTC" }).formatToParts(date);
  return ` - last was ${parts.find((p) => p.type === "day")?.value} ${parts.find((p) => p.type === "month")?.value}`;
}

/**
 * Format the board's already-decided dispatch rows, never its underlying budget math.
 * Width changes only wrapping; instructions and the closing line are identical on every screen.
 */
export function generateActionBoardPlan(rows: readonly PlanBoardRow[], date: Date, width = 38): string {
  if (!Number.isInteger(width) || width < 18) throw new RangeError("Plan width must be at least 18 characters");
  const parts = new Intl.DateTimeFormat("en-US", {
    weekday: "short", month: "short", day: "numeric",
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const heading = `${part("weekday")} ${part("month")} ${part("day")}`;
  const blocks: string[] = [];
  const blocked: string[] = [];

  // Keep the clear lane's sequence intact; due visits from held-work lanes
  // follow it. A held work order must not suppress a due wet check.
  const dispatchRows = [
    ...rows.filter((row) => row.lane === "clear_to_send"),
    ...rows.filter((row) => row.lane !== "clear_to_send" && row.lane !== "nothing_pending" &&
      (row.wetCheckDue ?? row.wetCheck?.due ?? false)),
  ];
  for (const row of rows) {
    if ((row.lane === "over_budget_nothing_approved" || row.lane === "over_budget") &&
      !(row.wetCheckDue ?? row.wetCheck?.due ?? false)) {
      blocked.push(wrap(row.customerName, width - 2, "  "));
    }
  }
  for (const row of dispatchRows) {
    const due = row.wetCheckDue ?? row.wetCheck?.due ?? false;
    // This marker is supplied by the board's resolver; do not re-test a threshold here.
    const inspection = row.inspectionOnly ?? row.wetCheck?.inspectionOnly ?? false;
    const inspectOnly = due && inspection;
    const orders = row.openWorkOrders ?? row.workOrders ?? [];
    const ceiling = row.doNotExceed ?? row.headroom;
    const approved = orders.filter((o) => o.preApproved);
    const unapproved = orders.filter((o) => !o.preApproved);
    // A clear lane may mean *one* order was approved, not that the rest fit.
    // Compare the already-normalized estimates with the row's DNE value;
    // unknown estimates cannot authorize discretionary work.
    const unapprovedFits = ceiling != null && ceiling > 0 &&
      unapproved.every((o) => o.estimatedTotal != null && Number.isFinite(Number(o.estimatedTotal))) &&
      unapproved.reduce((sum, o) => sum + Number(o.estimatedTotal), 0) <= ceiling;
    const sendOrders = row.lane !== "clear_to_send" ? [] :
      approved.length ? (unapprovedFits ? orders : approved) : orders;
    const onlyApproved = sendOrders.length > 0 && sendOrders.every((o) => o.preApproved);
    const lines = [wrap(row.customerName, width)];
    if (ceiling != null && ceiling > 0 && ((sendOrders.length > 0 && !onlyApproved) || (due && !inspectOnly))) {
      lines.push(wrap(`DNE ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(ceiling)}`, width, "  "));
    }
    if (sendOrders.length) {
      const numbers = sendOrders.map((order) => order.workOrderNumber ?? order.number).filter((number): number is string => !!number);
      const label = `${sendOrders.length} work order${sendOrders.length === 1 ? "" : "s"}`;
      lines.push(wrap(`${label}${numbers.length ? ` - ${numbers.join(", ")}` : ""}`, width, "  "));
      if (onlyApproved) lines.push(wrap("Pre-approved, outside the budget. Go ahead.", width, "  "));
    }
    if (due) {
      lines.push(wrap(
        inspectOnly
          ? "Wet check also due - INSPECTION ONLY. Document, do not repair. It comes back as an estimate."
          : `Wet check due${lastCheckLabel(row.newestWetCheck?.startedAt ?? row.wetCheck?.startedAt)}`,
        width, "  ",
      ));
    }
    if (lines.length === 1) lines.push("  No work scheduled.");
    blocks.push(lines.join("\n"));
  }

  if (blocked.length) blocks.push(["Not clear to work", ...blocked].join("\n"));
  if (!blocks.length) blocks.push("No work to send today.");
  blocks.push(wrap("Work orders are in the app under each property.", width));
  return [heading, ...blocks].join("\n\n");
}