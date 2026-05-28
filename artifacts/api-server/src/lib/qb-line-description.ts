/**
 * qb-line-description.ts
 *
 * Pure helpers that build the QuickBooks `Description` field for each
 * line type on a monthly invoice.  Billing numbers already carry their
 * own prefix (e.g. WO-2026-0042, BS-2026-0020, WC-2026-1042) so no
 * outer prefix is added here.
 */

export interface WoLineDescriptionParams {
  workOrderNumber: string;
  projectName?: string | null;
  totalHours?: string | number | null;
  appliedLaborRate: number;
  partsAmount: number;
}

export interface BsLineDescriptionParams {
  billingNumber: string;
  totalHours?: string | null;
  laborRate?: string | null;
  partsSubtotal?: string | null;
}

export interface WcbLineDescriptionParams {
  billingNumber: string;
  totalHours?: string | null;
  appliedLaborRate?: string | null;
  laborRate?: string | null;
  partsSubtotal?: string | null;
}

export function buildWoLineDescription(p: WoLineDescriptionParams): string {
  return `${p.workOrderNumber} - ${p.projectName ?? ""} (${p.totalHours ?? 0}h labor @ $${p.appliedLaborRate.toFixed(2)}/h, $${p.partsAmount.toFixed(2)} parts)`;
}

export function buildBsLineDescription(p: BsLineDescriptionParams): string {
  const hours = parseFloat(p.totalHours || "0");
  const rate = parseFloat(p.laborRate || "0");
  const parts = parseFloat(p.partsSubtotal || "0");
  return `${p.billingNumber} - ${hours}h labor @ $${rate.toFixed(2)}/h, $${parts.toFixed(2)} parts`;
}

export function buildWcbLineDescription(p: WcbLineDescriptionParams): string {
  const hours = parseFloat(p.totalHours || "0");
  const rate = parseFloat(p.appliedLaborRate || p.laborRate || "0");
  const parts = parseFloat(p.partsSubtotal || "0");
  return `${p.billingNumber} - ${hours}h labor @ $${rate.toFixed(2)}/h, $${parts.toFixed(2)} parts`;
}
