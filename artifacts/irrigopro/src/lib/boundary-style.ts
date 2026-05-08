import L from "leaflet";
import type {
  Feature,
  FeatureCollection,
  Geometry,
  MultiPolygon,
  Polygon,
} from "geojson";

export const BOUNDARY_PURPLE = "#B026FF";
export const BOUNDARY_FILL_RGBA = "rgba(176, 38, 255, 0.16)";
export const BOUNDARY_GLOW_RGBA = "rgba(176, 38, 255, 0.55)";

export const BOUNDARY_YELLOW = "#FFD024";
export const BOUNDARY_YELLOW_FILL_RGBA = "rgba(255, 208, 36, 0.18)";
export const BOUNDARY_YELLOW_GLOW_RGBA = "rgba(255, 208, 36, 0.55)";

const STYLE_ID = "irrigopro-boundary-styles";

export function ensureBoundaryStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .boundary-glow-outer {
      filter: drop-shadow(0 0 6px ${BOUNDARY_GLOW_RGBA})
              drop-shadow(0 0 12px ${BOUNDARY_GLOW_RGBA});
      pointer-events: none;
    }
    .boundary-glow-inner {
      stroke-dasharray: 8 4;
      animation: boundary-march 1.4s linear infinite;
    }
    @keyframes boundary-march {
      to { stroke-dashoffset: -24; }
    }
  `;
  document.head.appendChild(style);
}

export interface DrawBoundaryOptions {
  color?: string;
  fillRgba?: string;
  glowRgba?: string;
  animated?: boolean;
  filled?: boolean;
  interactive?: boolean;
}

type BoundaryGeoJson =
  | Feature<Polygon | MultiPolygon>
  | FeatureCollection<Polygon | MultiPolygon>
  | Polygon
  | MultiPolygon;

function toGeoJsonObject(input: BoundaryGeoJson): Geometry | Feature | FeatureCollection {
  return input as unknown as Geometry | Feature | FeatureCollection;
}

function parseRgbaAlpha(rgba: string | undefined): number | null {
  if (!rgba) return null;
  const m = rgba.match(/rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*([\d.]+))?\s*\)/i);
  if (!m) return null;
  if (m[1] == null) return 1;
  const v = parseFloat(m[1]);
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : null;
}

export function drawPropertyBoundary(
  map: L.Map,
  geojson: BoundaryGeoJson,
  opts: DrawBoundaryOptions = {},
): L.LayerGroup {
  ensureBoundaryStyles();
  const color = opts.color ?? BOUNDARY_PURPLE;
  const fillRgba = opts.fillRgba ?? BOUNDARY_FILL_RGBA;
  const glowRgba = opts.glowRgba ?? BOUNDARY_GLOW_RGBA;
  const animated = opts.animated ?? true;
  const filled = opts.filled ?? true;
  const interactive = opts.interactive ?? false;

  const group = L.layerGroup();

  // Parse the optional rgba overrides (alpha component) so callers can tune
  // fill / glow strength without forking this helper.
  const fillOpacity = parseRgbaAlpha(fillRgba) ?? 0.16;
  const glowOpacity = parseRgbaAlpha(glowRgba) ?? 0.55;

  // Layer 1: translucent fill (no stroke)
  if (filled) {
    const fill = L.geoJSON(toGeoJsonObject(geojson), {
      interactive,
      style: () => ({
        color,
        weight: 0,
        fillColor: color,
        fillOpacity,
        fill: true,
      }),
    });
    group.addLayer(fill);
  }

  // Layer 2: soft outer glow stroke
  const glow = L.geoJSON(toGeoJsonObject(geojson), {
    interactive: false,
    style: () => ({
      color,
      weight: 6,
      opacity: glowOpacity,
      fill: false,
      className: "boundary-glow-outer",
    }),
  });
  group.addLayer(glow);

  // Layer 3: crisp animated marching-ants stroke
  const stroke = L.geoJSON(toGeoJsonObject(geojson), {
    interactive,
    style: () => ({
      color,
      weight: 2,
      opacity: 1,
      fill: false,
      className: animated ? "boundary-glow-inner" : "",
    }),
  });
  group.addLayer(stroke);

  group.addTo(map);
  return group;
}

function eachPolygonRing(
  geojson: BoundaryGeoJson,
  fn: (ring: number[][]) => void,
): void {
  const visit = (geom: Geometry | undefined | null) => {
    if (!geom) return;
    if (geom.type === "Polygon") {
      for (const ring of geom.coordinates) fn(ring as number[][]);
    } else if (geom.type === "MultiPolygon") {
      for (const poly of geom.coordinates) {
        for (const ring of poly) fn(ring as number[][]);
      }
    } else if (geom.type === "GeometryCollection") {
      for (const g of geom.geometries) visit(g);
    }
  };
  if ((geojson as FeatureCollection).type === "FeatureCollection") {
    for (const f of (geojson as FeatureCollection).features) {
      visit(f.geometry as Geometry);
    }
  } else if ((geojson as Feature).type === "Feature") {
    visit((geojson as Feature).geometry as Geometry);
  } else {
    visit(geojson as Geometry);
  }
}

export function geoJsonBounds(geojson: BoundaryGeoJson): L.LatLngBounds | null {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  let any = false;
  eachPolygonRing(geojson, (ring) => {
    for (const coord of ring) {
      const lng = coord[0];
      const lat = coord[1];
      if (typeof lat !== "number" || typeof lng !== "number") continue;
      if (Number.isNaN(lat) || Number.isNaN(lng)) continue;
      any = true;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
  });
  if (!any) return null;
  return L.latLngBounds([minLat, minLng], [maxLat, maxLng]);
}
