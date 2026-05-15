// Task #639 — legacy estimate transition endpoints retired.
//
// These three legacy POST routes used to coexist with their canonical
// replacements (`PATCH /approve`, `PATCH /reject`, and the trio of
// `/submit-for-review`, `/send-approval-email`, `/resend`). They are
// kept mounted only so any straggling integration sees a discoverable
// 410 Gone with a redirect message rather than a silent 404. The
// canonical handlers live in `routes.ts` and `estimate-routes.ts`.
//
// Extracted into its own module so the contract is testable without
// pulling in the 16k-line `registerRoutes` (which has top-level DB
// timers and a self-running data-fix IIFE).

import type { Express, RequestHandler } from "express";

export const LEGACY_APPROVE_GONE_MESSAGE =
  "Use PATCH /api/estimates/:id/approve";
export const LEGACY_REJECT_GONE_MESSAGE =
  "Use PATCH /api/estimates/:id/reject";
export const LEGACY_TRANSITION_GONE_MESSAGE =
  "Use POST /api/estimates/:id/submit-for-review, /send-approval-email, or /resend";

export function registerLegacyEstimateGoneRoutes(app: Express): void {
  const gone =
    (message: string): RequestHandler =>
    (_req, res) => {
      res.status(410).json({ message });
    };
  app.post("/api/estimates/:id/approve", gone(LEGACY_APPROVE_GONE_MESSAGE));
  app.post("/api/estimates/:id/reject", gone(LEGACY_REJECT_GONE_MESSAGE));
  app.post("/api/estimates/:id/transition", gone(LEGACY_TRANSITION_GONE_MESSAGE));
}
