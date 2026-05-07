/**
 * Build a Maps URL for navigation, preferring a precise lat/lng pin over an
 * encoded address string. UA test matches the legacy work-order list:
 * Apple Maps on iOS+Android (mobile), Google Maps elsewhere.
 *
 * The optional `label` is used as the map search query when no lat/lng is
 * available; callers should pass the best human-readable destination label
 * (e.g. workLocationAddress ?? projectAddress ?? customerName).
 */
export function buildMapsUrl(opts: {
  lat?: number | string | null;
  lng?: number | string | null;
  address?: string | null;
  label?: string | null;
}): string | null {
  const latNum = opts.lat == null ? NaN : typeof opts.lat === "number" ? opts.lat : parseFloat(opts.lat);
  const lngNum = opts.lng == null ? NaN : typeof opts.lng === "number" ? opts.lng : parseFloat(opts.lng);
  const isApple =
    typeof navigator !== "undefined" &&
    /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  if (Number.isFinite(latNum) && Number.isFinite(lngNum)) {
    const q = `${latNum},${lngNum}`;
    return isApple
      ? `https://maps.apple.com/?q=${q}&ll=${q}`
      : `https://www.google.com/maps/search/?api=1&query=${q}`;
  }

  const fallback = (opts.label ?? opts.address ?? "").trim();
  if (!fallback) return null;
  const q = encodeURIComponent(fallback);
  return isApple
    ? `https://maps.apple.com/?q=${q}`
    : `https://www.google.com/maps/search/?api=1&query=${q}`;
}
