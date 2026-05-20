/**
 * WC Billing Slice 3 — Zone-grouped view assembler
 *
 * Provides:
 *   • TypeScript interfaces for the WetCheckBillingView payload
 *   • buildWetCheckBillingView — pure function, no I/O
 *
 * Both the in-app modal (Slice 5) and the PDF template (Slice 7)
 * consume the same shape so this is the single source of truth.
 */

import type {
  BillingSheet,
  Customer,
  WetCheck,
  WetCheckFinding,
  WetCheckZoneRecord,
  IssueTypeConfig,
} from "@workspace/db";

// ─── Public interfaces ───────────────────────────────────────────────────────

/** One finding's combined parts + labor cost on the billing view. */
export interface WcvLineItem {
  findingId: number;
  issueType: string;
  /** Human-readable label sourced from issueTypeConfigs; title-cased fallback. */
  issueDisplayLabel: string;
  partName: string | null;
  quantity: number;
  /** Part unit price (2dp decimal string). */
  unitPrice: string;
  /** quantity × unitPrice (2dp). */
  partsTotal: string;
  /** Per-finding labor hours (2dp). */
  laborHours: string;
  /** laborHours × laborRate (2dp). */
  laborTotal: string;
  /** partsTotal + laborTotal (2dp). */
  lineTotal: string;
  /** True when the finding is a labor-only repair (no part required). */
  noPartNeeded: boolean;
  notes: string | null;
}

/** All findings for a single controller zone. */
export interface WcvZone {
  controllerLetter: string;
  zoneNumber: number;
  /** Formatted label, e.g. "A-1". */
  zoneLabel: string;
  /**
   * Authoritative per-zone repair labor hours from the `repair_labor_hours`
   * column on wet_check_zone_records (Task #753, Slice 4 Option B).
   * The billing sheet total is driven by this value, not per-finding sums.
   */
  repairLaborHours: string;
  lineItems: WcvLineItem[];
  zonePartsSubtotal: string;
  zoneLaborSubtotal: string;
  zoneTotal: string;
}

/** Snapshot of the wet check inspection that produced these findings. */
export interface WcvInspection {
  wetCheckId: number;
  technicianName: string;
  /** ISO date string (wet check startedAt). */
  inspectionDate: string;
  propertyAddress: string | null;
  weather: string | null;
  notes: string | null;
}

/** Full zone-grouped billing view for a billing sheet backed by a wet check. */
export interface WetCheckBillingView {
  billingSheetId: number;
  billingNumber: string;
  customerId: number;
  customerName: string;
  /** ISO date string (billing sheet workDate). */
  workDate: string;
  /**
   * Effective labor rate used throughout this view.
   * Precedence: bs.appliedLaborRate ?? bs.laborRate ?? customer.laborRate
   */
  laborRate: string;
  inspection: WcvInspection;
  /** Zones sorted by controllerLetter ASC then zoneNumber ASC. */
  zones: WcvZone[];
  /** e.g. "3 repairs across 2 zones" */
  repairsSummary: string;
  partsSubtotal: string;
  laborSubtotal: string;
  grandTotal: string;
}

// ─── Assembler input ─────────────────────────────────────────────────────────

export interface BuildWetCheckBillingViewInput {
  billingSheet: BillingSheet;
  customer: Customer;
  /**
   * Findings that have billingSheetId === billingSheet.id.
   * Caller is responsible for pre-filtering.
   */
  findings: WetCheckFinding[];
  /** All zone records whose ids appear in findings.zoneRecordId. */
  zoneRecords: WetCheckZoneRecord[];
  wetCheck: WetCheck;
  /** issueTypeConfigs for the billing sheet's company (active + inactive). */
  issueTypeConfigs: IssueTypeConfig[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toNum(s: string | null | undefined): number {
  const n = parseFloat(s ?? "0");
  return isNaN(n) ? 0 : n;
}

function fmt(n: number): string {
  return n.toFixed(2);
}

/**
 * Title-case an issueType key as a display-label fallback.
 * "head_replacement" → "Head Replacement"
 */
function titleCase(issueType: string): string {
  return issueType
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Pure assembler ──────────────────────────────────────────────────────────

export function buildWetCheckBillingView(
  input: BuildWetCheckBillingViewInput,
): WetCheckBillingView {
  const { billingSheet: bs, customer, findings, zoneRecords, wetCheck, issueTypeConfigs } = input;

  // ── Labor rate precedence ────────────────────────────────────────────────
  // Nullish precedence: appliedLaborRate ?? laborRate ?? customer.laborRate.
  // An explicit "0.00" on the billing sheet is preserved — do NOT use ||
  // (which would treat zero as falsy and silently skip to the next rate).
  const effectiveRateStr = bs.appliedLaborRate ?? bs.laborRate ?? customer.laborRate;
  const laborRate = fmt(toNum(effectiveRateStr));
  const laborRateNum = toNum(laborRate);

  // ── issueType → displayLabel lookup ─────────────────────────────────────
  const labelMap = new Map<string, string>();
  for (const cfg of issueTypeConfigs) {
    labelMap.set(cfg.issueType, cfg.displayLabel);
  }

  // ── zoneRecordId → zone record lookup ───────────────────────────────────
  const zoneMap = new Map<number, WetCheckZoneRecord>();
  for (const zr of zoneRecords) {
    zoneMap.set(zr.id, zr);
  }

  // ── Group findings by zoneRecordId ───────────────────────────────────────
  const grouped = new Map<number, WetCheckFinding[]>();
  for (const f of findings) {
    const bucket = grouped.get(f.zoneRecordId) ?? [];
    bucket.push(f);
    grouped.set(f.zoneRecordId, bucket);
  }

  // ── Build zones ──────────────────────────────────────────────────────────
  const zones: WcvZone[] = [];

  for (const [zoneRecordId, zonefindings] of grouped) {
    const zr = zoneMap.get(zoneRecordId);
    if (!zr) continue;

    // Sort findings by id for deterministic output
    const sorted = [...zonefindings].sort((a, b) => a.id - b.id);

    // Task #753, Slice 4 — zone-level repair labor comes from the dedicated
    // column, NOT from summing per-finding laborHours. This eliminates
    // double-counting (the column is the single source of truth for billing).
    const repairLaborHoursNum = toNum(zr.repairLaborHours);
    const zoneLabor = repairLaborHoursNum * laborRateNum;

    let zoneParts = 0;

    const lineItems: WcvLineItem[] = sorted.map((f) => {
      const issueDisplayLabel = labelMap.get(f.issueType) ?? titleCase(f.issueType);
      const unitPrice = toNum(f.partPrice);
      const qty = f.quantity ?? 0;
      const partsTotal = f.noPartNeeded ? 0 : unitPrice * qty;
      // Per-finding laborHours are shown for display purposes on line items but
      // do NOT contribute to zone or sheet totals — repairLaborHours drives
      // billing math at the zone level (Slice 4 Option B).
      const laborHoursNum = toNum(f.laborHours);
      const laborTotal = laborHoursNum * laborRateNum;
      const lineTotal = partsTotal + laborTotal;

      zoneParts += partsTotal;

      return {
        findingId: f.id,
        issueType: f.issueType,
        issueDisplayLabel,
        partName: f.partName ?? null,
        quantity: qty,
        unitPrice: fmt(unitPrice),
        partsTotal: fmt(partsTotal),
        laborHours: fmt(laborHoursNum),
        laborTotal: fmt(laborTotal),
        lineTotal: fmt(lineTotal),
        noPartNeeded: f.noPartNeeded,
        notes: f.notes ?? null,
      };
    });

    zones.push({
      controllerLetter: zr.controllerLetter,
      zoneNumber: zr.zoneNumber,
      zoneLabel: `${zr.controllerLetter}-${zr.zoneNumber}`,
      repairLaborHours: fmt(repairLaborHoursNum),
      lineItems,
      zonePartsSubtotal: fmt(zoneParts),
      zoneLaborSubtotal: fmt(zoneLabor),
      zoneTotal: fmt(zoneParts + zoneLabor),
    });
  }

  // ── Sort zones: controllerLetter ASC, zoneNumber ASC ───────────────────
  zones.sort((a, b) => {
    if (a.controllerLetter < b.controllerLetter) return -1;
    if (a.controllerLetter > b.controllerLetter) return 1;
    return a.zoneNumber - b.zoneNumber;
  });

  // ── Totals ───────────────────────────────────────────────────────────────
  let partsSubtotal = 0;
  let laborSubtotal = 0;
  for (const z of zones) {
    partsSubtotal += toNum(z.zonePartsSubtotal);
    laborSubtotal += toNum(z.zoneLaborSubtotal);
  }
  const grandTotal = partsSubtotal + laborSubtotal;

  // ── Summary ───────────────────────────────────────────────────────────────
  const repairCount = findings.length;
  const zoneCount = zones.length;
  const repairsSummary =
    `${repairCount} ${repairCount === 1 ? "repair" : "repairs"} ` +
    `across ${zoneCount} ${zoneCount === 1 ? "zone" : "zones"}`;

  // ── Inspection ───────────────────────────────────────────────────────────
  const inspection: WcvInspection = {
    wetCheckId: wetCheck.id,
    technicianName: wetCheck.technicianName,
    inspectionDate: wetCheck.startedAt.toISOString(),
    propertyAddress: wetCheck.propertyAddress ?? null,
    weather: wetCheck.weather ?? null,
    notes: wetCheck.notes ?? null,
  };

  return {
    billingSheetId: bs.id,
    billingNumber: bs.billingNumber,
    customerId: customer.id,
    customerName: customer.name,
    workDate: bs.workDate.toISOString(),
    laborRate,
    inspection,
    zones,
    repairsSummary,
    partsSubtotal: fmt(partsSubtotal),
    laborSubtotal: fmt(laborSubtotal),
    grandTotal: fmt(grandTotal),
  };
}
