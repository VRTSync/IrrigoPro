/**
 * Canonical job-type color palette — single source of truth for the entire repo.
 *
 * These hexes are intentionally NOT derived from per-company brand colors so
 * that every company's billing PDF matches the shared customer guide
 * "Understanding Your Invoice," and so the web app UI uses the same visual
 * language as the printed document.
 *
 * Consumers:
 *   - artifacts/api-server/src/pdf-helpers.ts  (billing PDF CSS)
 *   - artifacts/irrigopro/tailwind.config.ts   (web app Tailwind theme — jobtype-*)
 *
 * If you need to change a color, update it here and in tailwind.config.ts
 * (Tailwind config cannot import TS consts at build time, so the values are
 * mirrored there by hand).
 */
export const JOB_TYPE_COLORS = {
  workOrder:    '#1E5A99',
  billingSheet: '#B06820',
  wetCheck:     '#5E8C2A',
  estimate:     '#475569',
} as const;

export type JobTypeKey = keyof typeof JOB_TYPE_COLORS;
