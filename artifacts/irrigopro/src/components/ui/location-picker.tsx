import { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MapPin, RotateCcw, Navigation, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { addSatelliteHybrid } from "@/lib/leaflet-base-layers";
import { drawPropertyBoundary, geoJsonBounds } from "@/lib/boundary-style";
import type { PropertyBoundary } from "@/lib/property-boundary";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

interface LocationPickerProps {
  defaultAddress?: string;
  onLocationSelect: (location: { lat: number; lng: number; address?: string }) => void;
  selectedLocation?: { lat: number; lng: number; address?: string } | null;
  customerBoundary?: PropertyBoundary | null;
  className?: string;
}

const PULSING_DOT_CSS = `
.leaflet-pulsing-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #1E5A99;
  border: 3px solid white;
  box-shadow: 0 0 0 rgba(59,130,246,0.4);
  animation: pulse-ring 2s ease-out infinite;
  position: relative;
}
@keyframes pulse-ring {
  0% { box-shadow: 0 0 0 0 rgba(59,130,246,0.5); }
  70% { box-shadow: 0 0 0 16px rgba(59,130,246,0); }
  100% { box-shadow: 0 0 0 0 rgba(59,130,246,0); }
}
`;

const FALLBACK_CENTER: [number, number] = [39.8283, -98.5795];
const FALLBACK_ZOOM = 12;

async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`
    );
    const data = await response.json();
    if (data && data.length > 0) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    }
  } catch (error) {
    console.error("Geocoding error:", error);
  }
  return null;
}

async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`
    );
    const data = await response.json();
    if (data && data.display_name) {
      return data.display_name;
    }
  } catch (error) {
    console.error("Reverse geocoding error:", error);
  }
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

export function LocationPicker({
  defaultAddress,
  onLocationSelect,
  selectedLocation,
  customerBoundary,
  className = ""
}: LocationPickerProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const boundaryLayerRef = useRef<L.LayerGroup | null>(null);
  const liveLocationMarkerRef = useRef<L.Marker | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const liveLocationRef = useRef<{ lat: number; lng: number } | null>(null);
  const prevAddressRef = useRef<string | undefined>(undefined);
  // Stores geocode result from a "Try Again" retry so the init effect can
  // use it directly without issuing a second Nominatim call.
  const pendingGeocodedCoordsRef = useRef<{ lat: number; lng: number } | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [geocodeFailed, setGeocodeFailed] = useState(false);
  // True when geocoding failed with no fallback anchor (no pin, no boundary).
  // In this state the Leaflet map is NOT mounted to prevent accidental Kansas pins.
  const [showMapless, setShowMapless] = useState(false);

  const trimmedAddress = (defaultAddress ?? "").trim();
  const hasAddress = trimmedAddress.length > 0;
  const hasBoundary = !!customerBoundary;
  const showEmptyState = !hasAddress && !selectedLocation && !hasBoundary;

  const updateLiveLocationMarker = useCallback((lat: number, lng: number) => {
    const map = mapInstanceRef.current;
    if (!map) return;

    liveLocationRef.current = { lat, lng };

    if (liveLocationMarkerRef.current) {
      liveLocationMarkerRef.current.setLatLng([lat, lng]);
    } else {
      const icon = L.divIcon({
        className: 'leaflet-pulsing-dot-container',
        html: '<div class="leaflet-pulsing-dot"></div>',
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });
      const marker = L.marker([lat, lng], { icon, interactive: false, zIndexOffset: -1000 }).addTo(map);
      liveLocationMarkerRef.current = marker;
    }
  }, []);

  // Initialize the map. Skipped while we're in the empty-address state or
  // mapless (geocode-failed with no fallback anchor) state.
  // Re-runs when showEmptyState or showMapless flips, so the map mounts as
  // soon as both become false (e.g. after a successful retry geocode or GPS fix).
  useEffect(() => {
    if (showEmptyState || showMapless) return;
    if (!mapRef.current || mapInstanceRef.current) return;

    if (!document.getElementById('pulsing-dot-styles')) {
      const style = document.createElement('style');
      style.id = 'pulsing-dot-styles';
      style.textContent = PULSING_DOT_CSS;
      document.head.appendChild(style);
    }

    const initializeMap = async () => {
      setIsLoading(true);
      setGeocodeFailed(false);

      // Centering preference: a previously saved pin wins (most precise),
      // then customer boundary, then customer address, then a regional fallback.
      let initialCenter: [number, number] = FALLBACK_CENTER;
      let initialZoom = FALLBACK_ZOOM;
      let usedAddress = false;
      let fitToBoundary = false;

      if (selectedLocation) {
        // Use the existing pin even if the address couldn't be geocoded —
        // the pin is the reliable anchor, not the address string.
        initialCenter = [selectedLocation.lat, selectedLocation.lng];
        initialZoom = 20;
        if (hasAddress) usedAddress = true;
      } else if (customerBoundary) {
        initialCenter = [customerBoundary.centerLat, customerBoundary.centerLng];
        initialZoom = customerBoundary.zoom;
        fitToBoundary = true;
        if (hasAddress) usedAddress = true;
      } else if (hasAddress) {
        // Use coords from a prior "Try Again" retry if available so we don't
        // issue a second Nominatim call for the same address.
        const cached = pendingGeocodedCoordsRef.current;
        pendingGeocodedCoordsRef.current = null;
        const coords = cached ?? await geocodeAddress(trimmedAddress);
        if (coords) {
          initialCenter = [coords.lat, coords.lng];
          initialZoom = 18;
          usedAddress = true;
        } else {
          // Geocoding failed and there is no pin or boundary to fall back to.
          // Show the mapless empty state instead of initialising Leaflet at the
          // US geographic centre (Kansas), which would silently accept clicks.
          setGeocodeFailed(true);
          setShowMapless(true);
          setIsLoading(false);
          return;
        }
      }

      const map = L.map(mapRef.current!, {
        center: initialCenter,
        zoom: initialZoom,
        zoomControl: true,
        maxZoom: 22,
        minZoom: 3,
        zoomSnap: 0.1,
        wheelPxPerZoomLevel: 20,
      });

      addSatelliteHybrid(map, { withLabels: true, maxZoom: 22, withControl: true });

      if (customerBoundary) {
        boundaryLayerRef.current = drawPropertyBoundary(map, customerBoundary.geojson);
        if (fitToBoundary && !selectedLocation) {
          const b = geoJsonBounds(customerBoundary.geojson);
          if (b) map.fitBounds(b.pad(0.18), { animate: false });
        }
      }

      map.on("click", async (e) => {
        const { lat, lng } = e.latlng;
        if (markerRef.current) {
          map.removeLayer(markerRef.current);
        }
        const marker = L.marker([lat, lng]).addTo(map);
        markerRef.current = marker;
        const address = await reverseGeocode(lat, lng);
        onLocationSelect({ lat, lng, address });
      });

      if (selectedLocation) {
        const marker = L.marker([selectedLocation.lat, selectedLocation.lng]).addTo(map);
        markerRef.current = marker;
      }

      mapInstanceRef.current = map;
      prevAddressRef.current = usedAddress ? trimmedAddress : undefined;
      setIsLoading(false);

      if ('geolocation' in navigator) {
        const wId = navigator.geolocation.watchPosition(
          (position) => {
            updateLiveLocationMarker(position.coords.latitude, position.coords.longitude);
          },
          (error) => {
            if (error.code === error.PERMISSION_DENIED) {
              setLocationError("Location access denied. Enable it in browser settings for live tracking.");
            }
          },
          { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
        );
        watchIdRef.current = wId;
      }
    };

    initializeMap();

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
      liveLocationMarkerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showEmptyState, showMapless]);

  // When the component is in mapless state (geocode failed, no anchor at render
  // time) and a valid anchor later arrives asynchronously — e.g. customerBoundary
  // resolves from useCustomerBoundary, or the parent sets selectedLocation via GPS
  // — clear the mapless latch so the init effect can mount the map on that anchor.
  useEffect(() => {
    if (!showMapless) return;
    if (selectedLocation || customerBoundary) {
      setShowMapless(false);
      setGeocodeFailed(false);
    }
  }, [showMapless, selectedLocation, customerBoundary]);

  // Sync the pin marker whenever the parent changes `selectedLocation` from
  // outside — e.g. when the host component's "I'm here" GPS button fires and
  // updates the prop. Without this effect, the map shows a stale marker
  // because the init effect only places the marker once at mount.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (selectedLocation) {
      const { lat, lng } = selectedLocation;
      if (markerRef.current) {
        markerRef.current.setLatLng([lat, lng]);
      } else {
        markerRef.current = L.marker([lat, lng]).addTo(map);
      }
      // Fly to the new pin so the tech can see where it landed.
      map.flyTo([lat, lng], Math.max(map.getZoom(), 18), { duration: 0.8 });
    } else {
      // Pin was cleared externally — remove the marker.
      if (markerRef.current) {
        map.removeLayer(markerRef.current);
        markerRef.current = null;
      }
    }
    // selectedLocation is an object — depend on the primitive values to avoid
    // spurious re-runs from reference inequality.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLocation?.lat, selectedLocation?.lng]);

  // Swap boundary overlay when it changes (e.g. switching customer).
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (boundaryLayerRef.current) {
      map.removeLayer(boundaryLayerRef.current);
      boundaryLayerRef.current = null;
    }
    if (customerBoundary) {
      boundaryLayerRef.current = drawPropertyBoundary(map, customerBoundary.geojson);
      if (!selectedLocation) {
        const b = geoJsonBounds(customerBoundary.geojson);
        if (b) map.fitBounds(b.pad(0.18), { animate: true, duration: 0.6 });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerBoundary?.geojson]);

  // Whenever the customer address changes, re-center the map on it — even
  // if a `selectedLocation` pin is already present. The pin stays visible.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!hasAddress) return;
    if (trimmedAddress === prevAddressRef.current) return;

    prevAddressRef.current = trimmedAddress;
    // When the customer has a saved boundary, the boundary is the source of
    // truth for centering — don't fly the map away from it on address change.
    if (customerBoundary) return;
    setGeocodeFailed(false);
    (async () => {
      const coords = await geocodeAddress(trimmedAddress);
      if (coords) {
        map.flyTo([coords.lat, coords.lng], 18, { duration: 1 });
      } else {
        setGeocodeFailed(true);
      }
    })();
  }, [trimmedAddress, hasAddress, customerBoundary]);

  const resetToDefault = async () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (markerRef.current) {
      map.removeLayer(markerRef.current);
      markerRef.current = null;
    }
    if (customerBoundary) {
      const b = geoJsonBounds(customerBoundary.geojson);
      if (b) map.fitBounds(b.pad(0.18), { animate: true });
      return;
    }
    if (!hasAddress) return;
    setIsLoading(true);
    setGeocodeFailed(false);
    const coords = await geocodeAddress(trimmedAddress);
    if (coords) {
      map.setView([coords.lat, coords.lng], 18);
    } else {
      setGeocodeFailed(true);
    }
    setIsLoading(false);
  };

  // Retry geocoding after the tech corrects the address in the step above.
  // If it succeeds, store the result and let the init effect mount the map.
  const handleTryAgain = async () => {
    if (!hasAddress) return;
    setIsLoading(true);
    setGeocodeFailed(false);
    const coords = await geocodeAddress(trimmedAddress);
    if (coords) {
      pendingGeocodedCoordsRef.current = coords;
      setShowMapless(false);
      // isLoading stays true — the init effect will clear it once the map is ready.
    } else {
      setGeocodeFailed(true);
      setIsLoading(false);
    }
  };

  const handleUseMyLocation = async () => {
    setIsLocating(true);
    setLocationError(null);

    if (!('geolocation' in navigator)) {
      setLocationError("Location is not supported by your browser.");
      setIsLocating(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude: lat, longitude: lng } = position.coords;
        const map = mapInstanceRef.current;
        if (map) {
          map.flyTo([lat, lng], 20, { duration: 1 });
          if (markerRef.current) {
            map.removeLayer(markerRef.current);
          }
          const marker = L.marker([lat, lng]).addTo(map);
          markerRef.current = marker;
        }
        const address = await reverseGeocode(lat, lng);
        onLocationSelect({ lat, lng, address });
        // If we were in mapless state, calling onLocationSelect sets selectedLocation
        // on the parent. Dismiss mapless so the map can init centred on the pin.
        if (showMapless) {
          setShowMapless(false);
          setGeocodeFailed(false);
        }
        setIsLocating(false);
      },
      (error) => {
        switch (error.code) {
          case error.PERMISSION_DENIED:
            setLocationError(
              "Location permission was denied. Please enable it in your browser settings. " +
              "You can still click on the map to set your location manually."
            );
            break;
          case error.POSITION_UNAVAILABLE:
            setLocationError("Your location could not be determined.");
            break;
          case error.TIMEOUT:
            setLocationError("Location request timed out. Please try again.");
            break;
          default:
            setLocationError("Unable to get your location.");
        }
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between flex-wrap gap-2">
          <span className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-blue-600" />
            Work Location
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={handleUseMyLocation}
              disabled={isLocating || isLoading || showEmptyState}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {isLocating ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Navigation className="w-4 h-4 mr-2" />
              )}
              {isLocating ? "Locating..." : "Use My Location"}
            </Button>
            {(hasAddress || hasBoundary) && !showMapless && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={resetToDefault}
                disabled={isLoading}
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                {hasBoundary ? "Reset to Property" : "Reset to Address"}
              </Button>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Click on the map to select the exact work location, or use your current location
          </p>

          {locationError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-800">{locationError}</p>
            </div>
          )}

          {/* Only show the amber geocode-failed banner when the map IS showing and
              there is no existing pin — if a pin is already valid, the warning is
              irrelevant and confusing. */}
          {geocodeFailed && !showEmptyState && !showMapless && !selectedLocation && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-amber-800">
                Couldn't locate this address — click on the map to set the work location.
              </p>
            </div>
          )}

          {selectedLocation && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-sm font-medium text-blue-900">Selected Location:</p>
              <p className="text-sm text-blue-800 mt-1">
                {selectedLocation.address || `${selectedLocation.lat.toFixed(6)}, ${selectedLocation.lng.toFixed(6)}`}
              </p>
            </div>
          )}

          {showEmptyState ? (
            <div className="w-full h-64 rounded-lg border border-dashed border-gray-300 bg-gray-50 flex items-center justify-center px-4">
              <div className="text-center">
                <MapPin className="w-6 h-6 text-gray-400 mx-auto mb-2" />
                <p className="text-sm font-medium text-gray-700">No address or property boundary on file</p>
                <p className="text-xs text-gray-500 mt-1">
                  Add an address — or upload a property boundary on the customer profile —
                  to enable map centering.
                </p>
              </div>
            </div>
          ) : showMapless ? (
            /* Geocoding failed with no pin or boundary anchor — do NOT mount Leaflet
               here because a click on a Kansas-centred map would persist a wrong pin. */
            <div className="w-full rounded-lg border border-dashed border-amber-300 bg-amber-50 flex items-center justify-center px-4 py-10">
              <div className="text-center max-w-xs">
                <MapPin className="w-7 h-7 text-amber-500 mx-auto mb-2" />
                <p className="text-sm font-medium text-gray-800">Couldn't locate this address on the map</p>
                <p className="text-xs text-gray-600 mt-1 mb-4">
                  Correct the address above or use the button below to set your GPS location
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleTryAgain}
                  disabled={isLoading || !hasAddress}
                >
                  {isLoading ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4 mr-2" />
                  )}
                  {isLoading ? "Searching…" : "Try Again"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="relative">
              <div
                ref={mapRef}
                className="w-full h-64 rounded-lg border border-gray-300"
                style={{ minHeight: "256px" }}
              />
              {isLoading && (
                <div className="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center rounded-lg">
                  <div className="flex items-center gap-2 text-gray-600">
                    <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                    Loading map...
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
