// GET /api/external/parts — delta-polling endpoint for CRM catalog sync.
//
// The route is mounted behind requireApiKey, which has already:
//   - validated the Bearer token
//   - attached req.apiKeyCompanyId (tenant scope)
//   - stamped lastUsedAt
//
// Query params:
//   updatedSince  ISO-8601 timestamp (optional; omit for full catalog)
//   cursor        opaque base64(<iso>|<id>) — continue a previous page
//   limit         integer 1–1000, default 200
//
// Response: { parts, nextCursor, hasMore, serverTime }
//   nextCursor is null when hasMore is false.
//
// Ordering: (updatedAt ASC, id ASC) — stable even when many parts share
// the same updatedAt second, because the id tiebreak is injective.

import type { Express, RequestHandler } from "express";
import { and, asc, eq, gt, gte, or } from "drizzle-orm";
import { db } from "@workspace/db";
import { parts } from "@workspace/db/schema";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

function encodeCursor(updatedAt: Date, id: number): string {
  const raw = `${updatedAt.toISOString()}|${id}`;
  return Buffer.from(raw, "utf8").toString("base64");
}

function decodeCursor(cursor: string): { updatedAt: Date; id: number } | null {
  try {
    const raw = Buffer.from(cursor, "base64").toString("utf8");
    const pipeIdx = raw.lastIndexOf("|");
    if (pipeIdx === -1) return null;
    const iso = raw.slice(0, pipeIdx);
    const id = parseInt(raw.slice(pipeIdx + 1), 10);
    const updatedAt = new Date(iso);
    if (isNaN(updatedAt.getTime()) || isNaN(id)) return null;
    return { updatedAt, id };
  } catch {
    return null;
  }
}

export interface RegisterExternalPartsRouteDeps {
  requireApiKey: RequestHandler;
}

export function registerExternalPartsRoute(
  app: Express,
  { requireApiKey }: RegisterExternalPartsRouteDeps,
): void {
  app.get("/api/external/parts", requireApiKey, async (req, res) => {
    try {
      const companyId = req.apiKeyCompanyId!;

      const rawLimit = req.query.limit;
      const limit = Math.min(
        MAX_LIMIT,
        Math.max(1, rawLimit ? parseInt(String(rawLimit), 10) || DEFAULT_LIMIT : DEFAULT_LIMIT),
      );

      const rawUpdatedSince = req.query.updatedSince;
      const rawCursor = req.query.cursor;

      let sinceDate: Date | null = null;
      let sinceId: number | null = null;

      if (rawCursor) {
        const parsed = decodeCursor(String(rawCursor));
        if (!parsed) {
          res.status(400).json({ error: "INVALID_CURSOR", message: "cursor is malformed" });
          return;
        }
        sinceDate = parsed.updatedAt;
        sinceId = parsed.id;
      } else if (rawUpdatedSince) {
        const d = new Date(String(rawUpdatedSince));
        if (isNaN(d.getTime())) {
          res.status(400).json({ error: "INVALID_PARAM", message: "updatedSince must be a valid ISO-8601 timestamp" });
          return;
        }
        sinceDate = d;
      }

      // Build where conditions:
      //   company scope (always)
      //   + optional delta filter keyed on (updatedAt, id)
      //
      // For cursor-based pagination the window is:
      //   updatedAt > sinceDate   OR   (updatedAt = sinceDate AND id > sinceId)
      //
      // For updatedSince (non-cursor) we want every row with updatedAt >= sinceDate.
      let rows: typeof parts.$inferSelect[];

      if (sinceDate !== null && sinceId !== null) {
        // cursor mode — strict tiebreak
        rows = await db
          .select()
          .from(parts)
          .where(
            and(
              eq(parts.companyId, companyId),
              or(
                gt(parts.updatedAt, sinceDate),
                and(eq(parts.updatedAt, sinceDate), gt(parts.id, sinceId)),
              ),
            ),
          )
          .orderBy(asc(parts.updatedAt), asc(parts.id))
          .limit(limit + 1);
      } else if (sinceDate !== null) {
        // updatedSince mode — inclusive lower bound
        rows = await db
          .select()
          .from(parts)
          .where(
            and(
              eq(parts.companyId, companyId),
              gte(parts.updatedAt, sinceDate),
            ),
          )
          .orderBy(asc(parts.updatedAt), asc(parts.id))
          .limit(limit + 1);
      } else {
        // full catalog
        rows = await db
          .select()
          .from(parts)
          .where(eq(parts.companyId, companyId))
          .orderBy(asc(parts.updatedAt), asc(parts.id))
          .limit(limit + 1);
      }

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;

      const lastRow = page[page.length - 1];
      const nextCursor = hasMore && lastRow ? encodeCursor(lastRow.updatedAt, lastRow.id) : null;

      res.json({
        parts: page,
        nextCursor,
        hasMore,
        serverTime: new Date().toISOString(),
      });
    } catch (error) {
      console.error("External API - Error fetching parts catalog:", error);
      res.status(500).json({ error: "SERVER_ERROR", message: "Failed to fetch parts catalog" });
    }
  });
}
