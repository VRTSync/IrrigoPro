import L from "leaflet";

const ESRI_WORLD_IMAGERY =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const CARTO_VOYAGER_LABELS =
  "https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png";

export function createSatelliteLayer(maxZoom = 22): L.TileLayer {
  return L.tileLayer(ESRI_WORLD_IMAGERY, {
    attribution:
      'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    maxNativeZoom: 19,
    maxZoom,
  });
}

export function createReferenceLabelsLayer(maxZoom = 22): L.TileLayer {
  return L.tileLayer(CARTO_VOYAGER_LABELS, {
    attribution: '&copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxNativeZoom: 22,
    maxZoom,
    opacity: 0.95,
    subdomains: "abcd",
  });
}

export function createStreetsLayer(maxZoom = 22): L.TileLayer {
  return L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxNativeZoom: 19,
    maxZoom,
  });
}

export function createCartoLightLayer(maxZoom = 22): L.TileLayer {
  return L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    {
      attribution: "&copy; OpenStreetMap &copy; CartoDB",
      subdomains: "abcd",
      maxNativeZoom: 19,
      maxZoom,
    },
  );
}

export interface SatelliteHybridOptions {
  withLabels?: boolean;
  maxZoom?: number;
  /** When true (default), adds a Leaflet `L.control.layers` switcher that
   *  shares the SAME base-layer instances mounted on the map (so toggling
   *  Streets/Light correctly removes the satellite tiles instead of stacking
   *  them). The reference-labels overlay is registered as an overlay so it
   *  can be turned off independently. */
  withControl?: boolean;
}

export interface HybridMapHandles {
  satellite: L.TileLayer;
  streets: L.TileLayer;
  light: L.TileLayer;
  labels: L.TileLayer | null;
  control: L.Control.Layers | null;
}

/**
 * Mount the standard IrrigoPro hybrid base-map setup on `map`:
 *   - Esri World Imagery (satellite) as the initially active base layer
 *   - Esri reference labels as an overlay (toggleable)
 *   - OSM Streets and Carto Light as alternate base layers
 *   - A single `L.control.layers` switcher wired to the SAME instances
 *
 * Using one shared set of layer instances avoids duplicate tile loading and
 * the "satellite stays under Streets" bug that happens when the control is
 * built from a different `createBaseLayers()` call than the one mounted.
 */
export function addSatelliteHybrid(
  map: L.Map,
  { withLabels = true, maxZoom = 22, withControl = true }: SatelliteHybridOptions = {},
): HybridMapHandles {
  const satellite = createSatelliteLayer(maxZoom).addTo(map);
  const streets = createStreetsLayer(maxZoom);
  const light = createCartoLightLayer(maxZoom);
  const labels = withLabels ? createReferenceLabelsLayer(maxZoom).addTo(map) : null;

  let control: L.Control.Layers | null = null;
  if (withControl) {
    const baseLayers: Record<string, L.TileLayer> = {
      Satellite: satellite,
      Streets: streets,
      Light: light,
    };
    const overlays: Record<string, L.TileLayer> = labels ? { Labels: labels } : {};
    control = L.control.layers(baseLayers, overlays, { collapsed: true }).addTo(map);
  }

  return { satellite, streets, light, labels, control };
}

/**
 * @deprecated Prefer `addSatelliteHybrid(map, { withControl: true })` so the
 * mounted layers and the layer-control share the same instances. Kept for
 * any callers that need a raw map of fresh base-layer tiles.
 */
export function createBaseLayers(maxZoom = 22): Record<string, L.TileLayer> {
  return {
    Satellite: createSatelliteLayer(maxZoom),
    Streets: createStreetsLayer(maxZoom),
    Light: createCartoLightLayer(maxZoom),
  };
}
