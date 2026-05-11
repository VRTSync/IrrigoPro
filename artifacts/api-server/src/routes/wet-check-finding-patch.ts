// Pure builder + zod schema for PATCH /api/wet-checks/findings/:id.
// Extracted from routes.ts so the body→patch translation can be locked in
// by tests without standing up the full registerRoutes() side effects.
//
// Task #468 — when a tech edits a finding that's already been marked
// `repaired_in_field` / `completed_in_field`, omitting `repairedInField`
// from the PATCH body must NOT touch resolution / techDisposition /
// resolutionDecidedAt / resolutionDecidedBy. The shape of the returned
// patch object enforces this: only fields the caller explicitly sent
// appear on the patch.

import { z } from "zod/v4";
import type { InsertWetCheckFinding } from "@workspace/db";

export const findingPatchBody = z.object({
  issueType: z.string().min(1).optional(),
  severity: z.string().nullish(),
  partId: z.coerce.number().int().nullish(),
  partName: z.string().nullish(),
  partPrice: z.union([z.string(), z.number()]).nullish(),
  quantity: z.coerce.number().int().min(1).optional(),
  laborHours: z.union([z.string(), z.number()]).optional(),
  notes: z.string().nullish(),
  repairedInField: z.boolean().optional(),
  // Task #428 — tech intent, persisted independently of `resolution`.
  techDisposition: z.enum(["needs_review", "completed_in_field"]).optional(),
  // Task #464 — labor-only Mark Complete confirmation. Server clears it
  // automatically whenever a partId is assigned (see updateWetCheckFinding).
  noPartNeeded: z.boolean().optional(),
}).partial();

export type FindingPatchBody = z.infer<typeof findingPatchBody>;

export function buildFindingPatchFromBody(
  body: FindingPatchBody,
  userId: number | null,
): Partial<InsertWetCheckFinding> {
  const patch: Partial<InsertWetCheckFinding> = {};
  if (body.issueType !== undefined) patch.issueType = body.issueType;
  if (body.severity !== undefined) patch.severity = body.severity ?? null;
  if (body.partId !== undefined) patch.partId = body.partId ?? null;
  if (body.partName !== undefined) patch.partName = body.partName ?? null;
  if (body.partPrice !== undefined) patch.partPrice = body.partPrice != null ? String(body.partPrice) : null;
  if (body.quantity !== undefined) patch.quantity = body.quantity;
  if (body.laborHours !== undefined) patch.laborHours = String(body.laborHours);
  if (body.notes !== undefined) patch.notes = body.notes ?? null;
  if (body.repairedInField !== undefined) {
    patch.resolution = body.repairedInField ? "repaired_in_field" : "pending";
    patch.resolutionDecidedAt = body.repairedInField ? new Date() : null;
    patch.resolutionDecidedBy = body.repairedInField ? userId : null;
    // Mirror tech intent unless caller is explicitly setting it below.
    if (body.techDisposition === undefined) {
      patch.techDisposition = body.repairedInField ? "completed_in_field" : "needs_review";
    }
  }
  if (body.techDisposition !== undefined) {
    patch.techDisposition = body.techDisposition;
  }
  // Task #464 — labor-only Mark Complete. Storage layer also force-clears
  // this when a partId is assigned, so the two states cannot both be true.
  if (body.noPartNeeded !== undefined) {
    patch.noPartNeeded = body.noPartNeeded;
  }
  return patch;
}
