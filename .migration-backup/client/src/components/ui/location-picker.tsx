import { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MapPin, RotateCcw, Navigation, Loader2, AlertCircle } from "lucide-react";

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
  className?: string;
}

const PULSING_DOT_CSS = `
.leaflet-pulsing-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #3B82F6;
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
  className = ""
}: LocationPickerProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const liveLocationMarkerRef = useRef<L.Marker | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const liveLocationRef = useRef<{ lat: number; lng: number } | null>(null);
  const prevAddressRef = useRef<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [geocodeFailed, setGeocodeFailed] = useState(false);

  const trimmedAddress = (defaultAddress ?? "").trim();
  const hasAddress = trimmedAddress.length > 0;
  const showEmptyState = !hasAddress && !selectedLocation;

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

  // Initialize the map. Skipped while we're in the empty-address state
  // (re-runs when an address arrives so the map mounts at that point).
  useEffect(() => {
    if (showEmptyState) return;
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

      // Centering preference: a previously saved pin wins (it's the most
      // precise location we have — e.g. when editing an existing estimate),
      // then customer address, then a regional fallback.
      let initialCenter: [number, number] = FALLBACK_CENTER;
      let initialZoom = FALLBACK_ZOOM;
      let usedAddress = false;

      if (selectedLocation) {
        initialCenter = [selectedLocation.lat, selectedLocation.lng];
        initialZoom = 20;
        // Mark the address as "already handled" so the address-change effect
        // below doesn't fly the map away from the pin on first render.
        if (hasAddress) {
          usedAddress = true;
        }
      } else if (hasAddress) {
        const coords = await geocodeAddress(trimmedAddress);
        if (coords) {
          initialCenter = [coords.lat, coords.lng];
          initialZoom = 18;
          usedAddress = true;
        } else {
          setGeocodeFailed(true);
        }
      }

      const map = L.map(mapRef.current!, {
        center: initialCenter,
        zoom: initialZoom,
        zoomControl: true,
        maxZoom: 25,
        minZoom: 10,
        zoomSnap: 0.1,
        wheelPxPerZoomLevel: 20,
      });

      L.tileLayer("https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", {
        attribution: '© Google',
        maxZoom: 25,
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
      }).addTo(map);

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
  }, [showEmptyState]);

  // Whenever the customer address changes, re-center the map on it — even
  // if a `selectedLocation` pin is already present. The pin stays visible.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!hasAddress) return;
    if (trimmedAddress === prevAddressRef.current) return;

    prevAddressRef.current = trimmedAddress;
    setGeocodeFailed(false);
    (async () => {
      const coords = await geocodeAddress(trimmedAddress);
      if (coords) {
        map.flyTo([coords.lat, coords.lng], 18, { duration: 1 });
      } else {
        setGeocodeFailed(true);
      }
    })();
  }, [trimmedAddress, hasAddress]);

  const resetToDefault = async () => {
    if (!mapInstanceRef.current || !hasAddress) return;
    setIsLoading(true);
    setGeocodeFailed(false);
    const coords = await geocodeAddress(trimmedAddress);
    if (coords) {
      mapInstanceRef.current.setView([coords.lat, coords.lng], 18);
      if (markerRef.current) {
        mapInstanceRef.current.removeLayer(markerRef.current);
        markerRef.current = null;
      }
    } else {
      setGeocodeFailed(true);
    }
    setIsLoading(false);
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
        setIsLocating(false);
      },
      (error) => {
        switch (error.code) {
          case error.PERMISSION_DENIED:
            setLocationError("Location permission was denied. Please enable it in your browser settings.");
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
            {hasAddress && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={resetToDefault}
                disabled={isLoading}
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                Reset to Address
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

          {geocodeFailed && !showEmptyState && (
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
                <p className="text-sm font-medium text-gray-700">No address on file for this customer</p>
                <p className="text-xs text-gray-500 mt-1">
                  Add an address to the customer profile to enable map centering.
                </p>
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
