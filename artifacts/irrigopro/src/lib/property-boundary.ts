import L from "leaflet";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import { geoJsonBounds } from "./boundary-style";

export interface PropertyBoundary {
  geojson: Feature<Polygon | MultiPolygon>;
  kml: string;
  fileName: string;
  centerLat: number;
  centerLng: number;
  zoom: number;
  areaAcres: number;
  bounds: L.LatLngBounds;
}

const SQ_M_PER_ACRE = 4046.8564224;
const EARTH_RADIUS_M = 6378137;

export function isBoundaryFile(file: File): boolean {
  const name = (file.name || "").toLowerCase();
  return name.endsWith(".kml") || name.endsWith(".kmz");
}

// ────────────────────────────────────────────────────────────────────────────────
// KMZ extraction (no JSZip — native DecompressionStream("deflate-raw"))
// ────────────────────────────────────────────────────────────────────────────────

interface ZipEntry {
  fileName: string;
  data: Uint8Array;
}

async function decompressDeflateRaw(input: Uint8Array): Promise<Uint8Array> {
  const DS = (globalThis as unknown as {
    DecompressionStream?: new (format: string) => GenericTransformStream;
  }).DecompressionStream;

  if (DS) {
    try {
      const stream = new Blob([input as BlobPart]).stream().pipeThrough(new DS("deflate-raw"));
      const buf = await new Response(stream).arrayBuffer();
      return new Uint8Array(buf);
    } catch {
      // Fall through to deflate fallback below
    }
  }

  // Fallback: synthesize a minimal zlib header and use "deflate"
  if (DS) {
    const zlib = new Uint8Array(input.length + 6);
    zlib[0] = 0x78;
    zlib[1] = 0x9c;
    zlib.set(input, 2);
    // Append a fake adler32 (won't be checked by all impls; best-effort)
    try {
      const stream = new Blob([zlib as BlobPart]).stream().pipeThrough(new DS("deflate"));
      const buf = await new Response(stream).arrayBuffer();
      return new Uint8Array(buf);
    } catch {
      throw new Error("KMZ decompression unsupported in this browser");
    }
  }

  throw new Error("KMZ decompression unsupported in this browser");
}

async function readKmzEntries(buf: ArrayBuffer): Promise<ZipEntry[]> {
  const data = new Uint8Array(buf);
  const view = new DataView(buf);
  const decoder = new TextDecoder("utf-8");
  const entries: ZipEntry[] = [];

  let i = 0;
  while (i < data.length - 4) {
    // Local file header signature: 0x04034b50
    if (view.getUint32(i, true) === 0x04034b50) {
      const compressionMethod = view.getUint16(i + 8, true);
      const compressedSize = view.getUint32(i + 18, true);
      const uncompressedSize = view.getUint32(i + 22, true);
      const fileNameLength = view.getUint16(i + 26, true);
      const extraLength = view.getUint16(i + 28, true);
      const nameStart = i + 30;
      const dataStart = nameStart + fileNameLength + extraLength;
      const fileName = decoder.decode(data.slice(nameStart, nameStart + fileNameLength));

      // Skip data-descriptor entries (size==0 with bit 3 set) — bypass
      if (compressedSize > 0 && dataStart + compressedSize <= data.length) {
        const compressed = data.slice(dataStart, dataStart + compressedSize);
        if (compressionMethod === 0) {
          entries.push({ fileName, data: compressed });
        } else if (compressionMethod === 8) {
          try {
            const inflated = await decompressDeflateRaw(compressed);
            entries.push({ fileName, data: inflated });
          } catch {
            // skip unreadable entries
          }
        }
        i = dataStart + compressedSize;
        // Account for an optional data descriptor (12 or 16 bytes)
        if (i + 4 <= data.length && view.getUint32(i, true) === 0x08074b50) {
          i += 16;
        }
        continue;
      }
      void uncompressedSize;
      // Fallback: advance by header
      i = dataStart + Math.max(0, compressedSize);
      continue;
    }
    // Central directory signature: 0x02014b50 → done with local headers
    if (view.getUint32(i, true) === 0x02014b50) break;
    i++;
  }

  return entries;
}

async function extractKmlFromKmz(buf: ArrayBuffer): Promise<{ kml: string; fileName: string }> {
  const entries = await readKmzEntries(buf);
  // Prefer doc.kml at root, else first .kml entry
  let entry = entries.find((e) => e.fileName.toLowerCase() === "doc.kml");
  if (!entry) entry = entries.find((e) => e.fileName.toLowerCase().endsWith(".kml"));
  if (!entry) throw new Error("No KML file found inside KMZ");
  return {
    kml: new TextDecoder("utf-8").decode(entry.data),
    fileName: entry.fileName,
  };
}

// ────────────────────────────────────────────────────────────────────────────────
// KML → GeoJSON (boundary-only, Polygon-first)
// ────────────────────────────────────────────────────────────────────────────────

function parseCoordinates(text: string): number[][] {
  const coords: number[][] = [];
  const tokens = text.trim().split(/\s+/);
  for (const tok of tokens) {
    if (!tok) continue;
    const parts = tok.split(",").map((p) => parseFloat(p));
    if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
      coords.push([parts[0], parts[1]]); // [lng, lat]
    }
  }
  return coords;
}

function ringFromLinearRing(linearRing: Element | null): number[][] | null {
  if (!linearRing) return null;
  const coordEl = linearRing.getElementsByTagNameNS("*", "coordinates")[0]
    ?? linearRing.getElementsByTagName("coordinates")[0];
  if (!coordEl) return null;
  const coords = parseCoordinates(coordEl.textContent || "");
  if (coords.length < 3) return null;
  // Close ring if not closed
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) coords.push([first[0], first[1]]);
  return coords;
}

function polygonFromKml(polygonEl: Element): number[][][] | null {
  const outer = polygonEl.getElementsByTagNameNS("*", "outerBoundaryIs")[0]
    ?? polygonEl.getElementsByTagName("outerBoundaryIs")[0];
  if (!outer) return null;
  const outerLinear = outer.getElementsByTagNameNS("*", "LinearRing")[0]
    ?? outer.getElementsByTagName("LinearRing")[0];
  const outerRing = ringFromLinearRing(outerLinear);
  if (!outerRing) return null;
  const rings: number[][][] = [outerRing];
  const innerEls = polygonEl.getElementsByTagNameNS("*", "innerBoundaryIs");
  const innerCollection: HTMLCollectionOf<Element> | Element[] =
    innerEls.length > 0 ? innerEls : Array.from(polygonEl.getElementsByTagName("innerBoundaryIs"));
  for (let i = 0; i < (innerCollection as ArrayLike<Element>).length; i++) {
    const inner = (innerCollection as ArrayLike<Element>)[i];
    const linear = inner.getElementsByTagNameNS("*", "LinearRing")[0]
      ?? inner.getElementsByTagName("LinearRing")[0];
    const ring = ringFromLinearRing(linear);
    if (ring) rings.push(ring);
  }
  return rings;
}

export function parseBoundaryKmlString(kml: string, fileName: string): PropertyBoundary {
  const doc = new DOMParser().parseFromString(kml, "application/xml");
  const errs = doc.getElementsByTagName("parsererror");
  if (errs.length > 0) throw new Error("Invalid KML file");

  const polygons: number[][][][] = []; // each polygon is array of rings (lng/lat)
  const polygonEls = doc.getElementsByTagName("Polygon");
  for (let i = 0; i < polygonEls.length; i++) {
    const rings = polygonFromKml(polygonEls[i]);
    if (rings) polygons.push(rings);
  }

  if (polygons.length === 0) {
    throw new Error("No polygons found in KML — boundary requires a Polygon Placemark");
  }

  let geometry: Polygon | MultiPolygon;
  if (polygons.length === 1) {
    geometry = { type: "Polygon", coordinates: polygons[0] };
  } else {
    geometry = { type: "MultiPolygon", coordinates: polygons };
  }
  const feature: Feature<Polygon | MultiPolygon> = {
    type: "Feature",
    properties: { source: fileName },
    geometry,
  };

  const { centerLat, centerLng } = computeCentroid(polygons);
  const areaAcres = computeAreaAcres(polygons);
  const bounds = geoJsonBounds(feature);
  if (!bounds) throw new Error("Could not compute bounds for boundary");
  const zoom = suggestZoom(bounds);

  return {
    geojson: feature,
    kml,
    fileName,
    centerLat,
    centerLng,
    zoom,
    areaAcres,
    bounds,
  };
}

export async function parseBoundaryFile(file: File): Promise<PropertyBoundary> {
  const lowerName = (file.name || "").toLowerCase();
  if (lowerName.endsWith(".kmz")) {
    const buf = await file.arrayBuffer();
    const { kml, fileName } = await extractKmlFromKmz(buf);
    return parseBoundaryKmlString(kml, file.name || fileName);
  }
  if (lowerName.endsWith(".kml")) {
    const text = await file.text();
    return parseBoundaryKmlString(text, file.name);
  }
  throw new Error("Unsupported file type — please upload a .kml or .kmz file");
}

// ────────────────────────────────────────────────────────────────────────────────
// Centroid (signed-area-weighted), spherical-excess area, zoom heuristic
// ────────────────────────────────────────────────────────────────────────────────

function ringSignedArea(ring: number[][]): number {
  // Planar signed area in coordinate units; only used for centroid weighting
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

function ringCentroid(ring: number[][]): { x: number; y: number; area: number } {
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    const cross = x1 * y2 - x2 * y1;
    a += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  a /= 2;
  if (a === 0) {
    // Fallback: simple average
    let sx = 0;
    let sy = 0;
    for (const [x, y] of ring) {
      sx += x;
      sy += y;
    }
    const n = Math.max(1, ring.length);
    return { x: sx / n, y: sy / n, area: 0 };
  }
  cx /= 6 * a;
  cy /= 6 * a;
  return { x: cx, y: cy, area: a };
}

function computeCentroid(polygons: number[][][][]): { centerLat: number; centerLng: number } {
  let sumX = 0;
  let sumY = 0;
  let sumW = 0;
  for (const poly of polygons) {
    if (poly.length === 0) continue;
    const outer = poly[0];
    const c = ringCentroid(outer);
    const w = Math.abs(c.area);
    sumX += c.x * w;
    sumY += c.y * w;
    sumW += w;
  }
  if (sumW === 0) {
    // fallback to first vertex
    const first = polygons[0]?.[0]?.[0];
    return { centerLat: first?.[1] ?? 0, centerLng: first?.[0] ?? 0 };
  }
  return { centerLat: sumY / sumW, centerLng: sumX / sumW };
}

function ringAreaSquareMeters(ring: number[][]): number {
  // Spherical excess (l'Huilier-equivalent) using consecutive cross products.
  // Adapted from the standard "geodesic ring area" formula.
  if (ring.length < 4) return 0;
  let total = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[i + 1];
    total +=
      ((lng2 - lng1) * Math.PI) / 180 *
      (2 + Math.sin((lat1 * Math.PI) / 180) + Math.sin((lat2 * Math.PI) / 180));
  }
  return Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
}

function computeAreaAcres(polygons: number[][][][]): number {
  let m2 = 0;
  for (const poly of polygons) {
    if (poly.length === 0) continue;
    m2 += ringAreaSquareMeters(poly[0]);
    for (let i = 1; i < poly.length; i++) {
      m2 -= ringAreaSquareMeters(poly[i]);
    }
  }
  return Math.max(0, m2) / SQ_M_PER_ACRE;
}

export function suggestZoom(bounds: L.LatLngBounds): number {
  const ne = bounds.getNorthEast();
  const sw = bounds.getSouthWest();
  const latSpan = Math.abs(ne.lat - sw.lat);
  const lngSpan = Math.abs(ne.lng - sw.lng);
  const span = Math.max(latSpan, lngSpan);
  // Rough: residential parcels (<0.005°) → 19, large estates → 17, commercial → 15
  if (span < 0.0015) return 20;
  if (span < 0.004) return 19;
  if (span < 0.01) return 18;
  if (span < 0.03) return 17;
  if (span < 0.08) return 16;
  if (span < 0.2) return 15;
  return 14;
}

// ────────────────────────────────────────────────────────────────────────────────
// Hydrate from persisted DB fields (drizzle decimals come back as strings)
// ────────────────────────────────────────────────────────────────────────────────

export interface StoredBoundaryFields {
  propertyBoundary?: string | null;
  propertyBoundaryKml?: string | null;
  propertyBoundaryFileName?: string | null;
  propertyBoundaryCenterLat?: string | number | null;
  propertyBoundaryCenterLng?: string | number | null;
  propertyBoundaryZoom?: number | null;
  propertyBoundaryAreaAcres?: string | number | null;
}

function toNum(v: string | number | null | undefined): number {
  if (v == null) return NaN;
  return typeof v === "number" ? v : parseFloat(v);
}

export function hydrateStoredBoundary(
  fields: StoredBoundaryFields | null | undefined,
): PropertyBoundary | null {
  if (!fields || !fields.propertyBoundary) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fields.propertyBoundary);
  } catch {
    return null;
  }
  let feature: Feature<Polygon | MultiPolygon> | null = null;
  const obj = parsed as { type?: string; geometry?: unknown };
  if (obj?.type === "Feature" && obj.geometry) {
    feature = parsed as Feature<Polygon | MultiPolygon>;
  } else if (obj?.type === "Polygon" || obj?.type === "MultiPolygon") {
    feature = {
      type: "Feature",
      properties: {},
      geometry: parsed as Polygon | MultiPolygon,
    };
  } else if (obj?.type === "FeatureCollection") {
    const fc = parsed as { features?: Feature<Polygon | MultiPolygon>[] };
    if (fc.features && fc.features.length > 0) feature = fc.features[0];
  }
  if (!feature) return null;

  const bounds = geoJsonBounds(feature);
  if (!bounds) return null;

  const centerLat = toNum(fields.propertyBoundaryCenterLat);
  const centerLng = toNum(fields.propertyBoundaryCenterLng);
  const areaAcres = toNum(fields.propertyBoundaryAreaAcres);

  return {
    geojson: feature,
    kml: fields.propertyBoundaryKml ?? "",
    fileName: fields.propertyBoundaryFileName ?? "",
    centerLat: Number.isFinite(centerLat) ? centerLat : bounds.getCenter().lat,
    centerLng: Number.isFinite(centerLng) ? centerLng : bounds.getCenter().lng,
    zoom: fields.propertyBoundaryZoom ?? suggestZoom(bounds),
    areaAcres: Number.isFinite(areaAcres) ? areaAcres : 0,
    bounds,
  };
}
