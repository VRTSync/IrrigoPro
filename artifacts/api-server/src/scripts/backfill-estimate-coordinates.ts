// One-off backfill: geocode `projectAddress` into
// `workLocationLat` / `workLocationLng` / `workLocationAddress` for estimates
// that were created before the map picker existed (or saved without a pin).
//
// Idempotent: only touches rows where workLocationLat IS NULL and
// projectAddress is set. Re-running picks up where it left off and skips
// rows that already have coordinates.
//
// Uses the public OpenStreetMap Nominatim endpoint — same service the
// LocationPicker uses on the client. Per their usage policy we send a
// descriptive User-Agent and throttle requests to ~1/second.
//
// Usage:
//   node --import tsx/esm server/scripts/backfill-estimate-coordinates.ts \
//     [--dry-run] [--limit=500] [--delay=1100]

import { db } from "../db";
import { estimates } from "@workspace/db";
import { and, isNull, isNotNull, sql } from "drizzle-orm";

function arg(name: string, fallback?: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}`));
  if (!hit) return fallback;
  if (hit.includes("=")) return hit.split("=", 2)[1];
  return "true";
}

function withCountryHint(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  const hasCountry =
    lower.endsWith(", usa") ||
    lower.endsWith(" usa") ||
    lower.endsWith(", united states") ||
    lower.endsWith(" united states");
  return hasCountry ? trimmed : `${trimmed}, USA`;
}

const USER_AGENT = "IrrigoPro-EstimateBackfill/1.0 (ops@irrigopro.com)";

async function geocode(
  address: string,
): Promise<{ lat: number; lng: number; displayName: string } | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
    address,
  )}&limit=1&addressdetails=0`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const data = (await res.json()) as Array<{
    lat: string;
    lon: string;
    display_name: string;
  }>;
  if (!Array.isArray(data) || data.length === 0) return null;
  const hit = data[0];
  const lat = Number(hit.lat);
  const lng = Number(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, displayName: hit.display_name };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const dryRun = arg("dry-run") === "true";
  const limit = Number(arg("limit", "0")) || 0;
  const delayMs = Number(arg("delay", "1100"));

  console.log(
    `[GEOCODE-BACKFILL] start dryRun=${dryRun} limit=${limit || "all"} delayMs=${delayMs}`,
  );

  const rows = await db
    .select({
      id: estimates.id,
      estimateNumber: estimates.estimateNumber,
      projectAddress: estimates.projectAddress,
    })
    .from(estimates)
    .where(
      and(
        isNull(estimates.workLocationLat),
        isNotNull(estimates.projectAddress),
        sql`length(trim(${estimates.projectAddress})) > 0`,
      ),
    )
    .orderBy(estimates.id);

  const todo = limit > 0 ? rows.slice(0, limit) : rows;
  console.log(
    `[GEOCODE-BACKFILL] candidates=${rows.length} processing=${todo.length}`,
  );

  let updated = 0;
  let notFound = 0;
  const failures: Array<{ id: number; estimateNumber: string; error: string }> = [];

  for (let i = 0; i < todo.length; i++) {
    const row = todo[i];
    const address = withCountryHint(row.projectAddress ?? "");
    const tag = `[${i + 1}/${todo.length}] estimate#${row.id} (${row.estimateNumber})`;

    if (!address) {
      console.log(`${tag} skip: empty address`);
      continue;
    }

    try {
      const result = await geocode(address);
      if (!result) {
        notFound++;
        console.log(`${tag} no match for "${address}"`);
      } else if (dryRun) {
        console.log(
          `${tag} DRY would set lat=${result.lat} lng=${result.lng} addr="${result.displayName}"`,
        );
      } else {
        await db
          .update(estimates)
          .set({
            workLocationLat: String(result.lat),
            workLocationLng: String(result.lng),
            workLocationAddress: result.displayName,
            updatedAt: new Date(),
          })
          .where(
            and(isNull(estimates.workLocationLat), sql`${estimates.id} = ${row.id}`),
          );
        updated++;
        console.log(
          `${tag} ok lat=${result.lat} lng=${result.lng}`,
        );
      }
    } catch (err) {
      const msg = (err as Error).message;
      failures.push({ id: row.id, estimateNumber: row.estimateNumber, error: msg });
      console.log(`${tag} FAIL: ${msg}`);
    }

    if (i < todo.length - 1) await sleep(delayMs);
  }

  console.log(
    `[GEOCODE-BACKFILL] done updated=${updated} notFound=${notFound} failed=${failures.length}`,
  );
  if (failures.length > 0) {
    console.log("[GEOCODE-BACKFILL] failures:");
    for (const f of failures) {
      console.log(`  estimate#${f.id} (${f.estimateNumber}) → ${f.error}`);
    }
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[GEOCODE-BACKFILL] fatal:", err);
  process.exit(1);
});
