// Zod schema and pure helpers for POST /api/wet-checks.
// Extracted from routes.ts so the branch gate and branchName normalisation
// can be locked in by tests without standing up the full registerRoutes()
// side effects (the same reason wet-check-finding-patch.ts was extracted).
//
// Task #1463 — branch-scoped deduplication regression guard.

import { z } from "zod/v4";

// ─── Body schema ─────────────────────────────────────────────────────────────

export const wetCheckCreateBody = z.object({
  customerId: z.coerce.number().int().positive(),
  weather: z.string().nullish(),
  notes: z.string().nullish(),
  clientId: z.string().uuid().nullish(),
  blankStart: z.boolean().optional(),
  mode: z.enum(["service", "inspection"]).optional(),
  // Task #315 — selected branch for multi-location customers. Optional;
  // single-location customers do not send this field. Empty-string is
  // normalised to null at the storage boundary.
  branchName: z.string().nullish(),
}).strict();

export type WetCheckCreateBody = z.infer<typeof wetCheckCreateBody>;

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Normalise branchName: trim whitespace, collapse empty string to null.
 * Consistent with the wet_check_billings / work_orders convention.
 */
export function normalizeBranchName(raw: string | null | undefined): string | null {
  return raw?.trim() || null;
}

/**
 * Gate: if the customer has branches, a branch must be selected.
 *
 * Returns the error message string when the gate fires, or `null` when the
 * request is allowed to proceed.  Pure function — no side effects.
 */
export function checkBranchGate(
  customerBranches: string[],
  branchName: string | null,
): string | null {
  if (customerBranches.length > 0 && !branchName) {
    return "Branch selection required for this customer — select a branch before starting a wet check.";
  }
  return null;
}
