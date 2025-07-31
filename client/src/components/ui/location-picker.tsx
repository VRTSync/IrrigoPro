import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MapPin, RotateCcw } from "lucide-react";

// Fix for default markers
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

export function LocationPicker({ 
  defaultAddress, 
  onLocationSelect, 
  selectedLocation,
  className = ""
}: LocationPickerProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Geocode address to coordinates
  const geocodeAddress = async (address: string): Promise<{ lat: number; lng: number } | null> => {
    try {
      // Using Nominatim (OpenStreetMap's geocoding service)
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`
      );
      const data = await response.json();
      
      if (data && data.length > 0) {
        return {
          lat: parseFloat(data[0].lat),
          lng: parseFloat(data[0].lon)
        };
      }
    } catch (error) {
      console.error("Geocoding error:", error);
    }
    return null;
  };

  // Reverse geocode coordinates to address
  const reverseGeocode = async (lat: number, lng: number): Promise<string> => {
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
  };

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const initializeMap = async () => {
      setIsLoading(true);
      
      // Default to a central location
      let initialCenter: [number, number] = [39.8283, -98.5795]; // Center of US
      let initialZoom = 4;

      // Try to geocode the default address
      if (defaultAddress && defaultAddress.trim()) {
        const coords = await geocodeAddress(defaultAddress);
        if (coords) {
          initialCenter = [coords.lat, coords.lng];
          initialZoom = 16;
        }
      }

      // Use selected location if available
      if (selectedLocation) {
        initialCenter = [selectedLocation.lat, selectedLocation.lng];
        initialZoom = 16;
      }

      const map = L.map(mapRef.current, {
        center: initialCenter,
        zoom: Math.max(initialZoom, 18), // Start at higher zoom for better detail
        zoomControl: true,
        maxZoom: 25,
        minZoom: 10,
        zoomSnap: 0.1, // Smoother zoom increments
        wheelPxPerZoomLevel: 20, // More responsive zooming
      });

      // Add high-resolution satellite imagery
      L.tileLayer("https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", {
        attribution: '© Google',
        maxZoom: 25,
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
      }).addTo(map);

      // Add click handler
      map.on("click", async (e) => {
        const { lat, lng } = e.latlng;
        
        // Remove existing marker
        if (markerRef.current) {
          map.removeLayer(markerRef.current);
        }

        // Add new marker
        const marker = L.marker([lat, lng]).addTo(map);
        markerRef.current = marker;

        // Get address for the location
        const address = await reverseGeocode(lat, lng);
        
        // Call the callback
        onLocationSelect({ lat, lng, address });
      });

      // Add existing marker if location is selected
      if (selectedLocation) {
        const marker = L.marker([selectedLocation.lat, selectedLocation.lng]).addTo(map);
        markerRef.current = marker;
      }

      mapInstanceRef.current = map;
      setIsLoading(false);
    };

    initializeMap();

    // Cleanup
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [defaultAddress]);

  // Reset to default address
  const resetToDefault = async () => {
    if (!mapInstanceRef.current || !defaultAddress) return;
    
    setIsLoading(true);
    const coords = await geocodeAddress(defaultAddress);
    
    if (coords) {
      mapInstanceRef.current.setView([coords.lat, coords.lng], 16);
      
      // Remove existing marker
      if (markerRef.current) {
        mapInstanceRef.current.removeLayer(markerRef.current);
        markerRef.current = null;
      }
    }
    setIsLoading(false);
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-blue-600" />
            Work Location
          </span>
          {defaultAddress && (
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
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Click on the map to select the exact work location
          </p>
          
          {selectedLocation && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-sm font-medium text-blue-900">Selected Location:</p>
              <p className="text-sm text-blue-800 mt-1">
                {selectedLocation.address || `${selectedLocation.lat.toFixed(6)}, ${selectedLocation.lng.toFixed(6)}`}
              </p>
            </div>
          )}
          
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
        </div>
      </CardContent>
    </Card>
  );
}