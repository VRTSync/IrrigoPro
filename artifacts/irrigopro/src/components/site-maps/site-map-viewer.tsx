import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  MapIcon, 
  Settings, 
  ZoomIn, 
  ZoomOut, 
  Maximize2,
  Cpu as Controller,
  Droplets
} from "lucide-react";
import type { ParsedKMLData, KMLController, KMLZone } from "@/lib/kml-parser";

// Fix for default markers in Leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

interface SiteMapViewerProps {
  kmlData: ParsedKMLData;
  onControllerClick?: (controller: KMLController) => void;
  onZoneClick?: (zone: KMLZone) => void;
}

export function SiteMapViewer({ kmlData, onControllerClick, onZoneClick }: SiteMapViewerProps) {
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedController, setSelectedController] = useState<KMLController | null>(null);
  const [selectedZone, setSelectedZone] = useState<KMLZone | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // Initialize map
    const map = L.map(mapContainerRef.current).setView(
      [kmlData.centerLat, kmlData.centerLng],
      15
    );

    // Add OpenStreetMap tiles (with Task #552 tile-error telemetry).
    const osmTiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    });
    osmTiles.on('tileerror', (ev: any) => {
      try {
        void import('@/lib/offline/telemetry').then(({ postTelemetry }) =>
          postTelemetry({
            name: 'map.tile.failed',
            type: 'metric',
            severity: 'warning',
            source: 'sw',
            component: 'site-maps.viewer',
            message: 'tile fetch failed',
            context: { provider: 'osm', src: ev?.tile?.src ?? null },
          }),
        );
      } catch { /* swallow */ }
    });
    osmTiles.addTo(map);

    mapRef.current = map;

    // Add controllers as markers
    kmlData.controllers.forEach((controller) => {
      const controllerIcon = L.divIcon({
        html: `
          <div class="bg-blue-600 text-white rounded-full w-8 h-8 flex items-center justify-center text-xs font-bold shadow-lg border-2 border-white">
            C
          </div>
        `,
        className: 'custom-div-icon',
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });

      const marker = L.marker([controller.latitude, controller.longitude], {
        icon: controllerIcon
      }).addTo(map);

      // Create popup content
      const popupContent = `
        <div class="p-2">
          <h3 class="font-bold text-blue-800 mb-2">${controller.name}</h3>
          ${controller.model ? `<p><strong>Model:</strong> ${controller.model}</p>` : ''}
          ${controller.serialNumber ? `<p><strong>Serial:</strong> ${controller.serialNumber}</p>` : ''}
          <p><strong>Zones:</strong> ${controller.stationCount || 8}</p>
          ${controller.description ? `<p class="text-sm text-gray-600 mt-2">${controller.description}</p>` : ''}
        </div>
      `;

      marker.bindPopup(popupContent);
      
      marker.on('click', () => {
        setSelectedController(controller);
        onControllerClick?.(controller);
      });
    });

    // Add zones as point markers
    kmlData.zones.forEach((zone) => {
      // Calculate center point from boundaries if available, otherwise skip
      let zoneLat: number, zoneLng: number;
      
      if (zone.boundaries && zone.boundaries.length > 0) {
        // Calculate centroid of zone boundaries
        const lats = zone.boundaries.map(coord => coord[0]);
        const lngs = zone.boundaries.map(coord => coord[1]);
        zoneLat = lats.reduce((sum, lat) => sum + lat, 0) / lats.length;
        zoneLng = lngs.reduce((sum, lng) => sum + lng, 0) / lngs.length;
      } else {
        // Skip zones without boundaries
        return;
      }

      const zoneIcon = L.divIcon({
        html: `
          <div class="bg-green-600 text-white rounded-full w-8 h-8 flex items-center justify-center text-xs font-bold shadow-lg border-2 border-white">
            Z
          </div>
        `,
        className: 'custom-div-icon',
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });

      const marker = L.marker([zoneLat, zoneLng], {
        icon: zoneIcon
      }).addTo(map);

      // Create popup content for zone
      const zonePopupContent = `
        <div class="p-2">
          <h3 class="font-bold text-green-800 mb-2">${zone.name}</h3>
          ${zone.controllerName ? `<p><strong>Controller:</strong> ${zone.controllerName}</p>` : ''}
          ${zone.stationNumber ? `<p><strong>Zone #:</strong> ${zone.stationNumber}</p>` : ''}
          ${zone.zoneType ? `<p><strong>Type:</strong> ${zone.zoneType}</p>` : ''}
          ${zone.coverage ? `<p><strong>Coverage:</strong> ${zone.coverage}</p>` : ''}
          ${zone.description ? `<p class="text-sm text-gray-600 mt-2">${zone.description}</p>` : ''}
        </div>
      `;

      marker.bindPopup(zonePopupContent);
      
      marker.on('click', () => {
        setSelectedZone(zone);
        onZoneClick?.(zone);
      });
    });

    // Fit map to bounds
    if (kmlData.controllers.length > 0 || kmlData.zones.length > 0) {
      const bounds = L.latLngBounds([
        [kmlData.bounds.south, kmlData.bounds.west],
        [kmlData.bounds.north, kmlData.bounds.east]
      ]);
      map.fitBounds(bounds, { padding: [20, 20] });
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [kmlData, onControllerClick, onZoneClick]);

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
    setTimeout(() => {
      if (mapRef.current) {
        mapRef.current.invalidateSize();
      }
    }, 100);
  };

  const zoomIn = () => {
    if (mapRef.current) {
      mapRef.current.zoomIn();
    }
  };

  const zoomOut = () => {
    if (mapRef.current) {
      mapRef.current.zoomOut();
    }
  };

  const resetView = () => {
    if (mapRef.current && kmlData) {
      const bounds = L.latLngBounds([
        [kmlData.bounds.south, kmlData.bounds.west],
        [kmlData.bounds.north, kmlData.bounds.east]
      ]);
      mapRef.current.fitBounds(bounds, { padding: [20, 20] });
    }
  };

  return (
    <Card className={isFullscreen ? "fixed inset-4 z-50 shadow-2xl" : ""}>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <MapIcon className="w-5 h-5 text-green-600" />
            Site Map View
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-blue-50">
              <Controller className="w-3 h-3 mr-1" />
              {kmlData.controllers.length} Controllers
            </Badge>
            <Badge variant="outline" className="bg-green-50">
              <Droplets className="w-3 h-3 mr-1" />
              {kmlData.zones.length} Zones
            </Badge>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" onClick={zoomIn}>
                <ZoomIn className="w-4 h-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={zoomOut}>
                <ZoomOut className="w-4 h-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={resetView}>
                <Settings className="w-4 h-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={toggleFullscreen}>
                <Maximize2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div
          ref={mapContainerRef}
          className={`bg-gray-100 ${
            isFullscreen ? "h-[calc(100vh-200px)]" : "h-96"
          }`}
          style={{ minHeight: '300px' }}
        />
        
        {/* Selected item info */}
        {(selectedController || selectedZone) && (
          <div className="p-4 border-t bg-gray-50">
            {selectedController && (
              <div className="space-y-2">
                <h4 className="font-semibold text-blue-800 flex items-center gap-2">
                  <Controller className="w-4 h-4" />
                  {selectedController.name}
                </h4>
                <div className="grid grid-cols-2 gap-4 text-sm text-gray-600">
                  {selectedController.model && (
                    <div><span className="font-medium">Model:</span> {selectedController.model}</div>
                  )}
                  {selectedController.serialNumber && (
                    <div><span className="font-medium">Serial:</span> {selectedController.serialNumber}</div>
                  )}
                  <div><span className="font-medium">Zones:</span> {selectedController.stationCount || 8}</div>
                  <div><span className="font-medium">Location:</span> {selectedController.latitude.toFixed(6)}, {selectedController.longitude.toFixed(6)}</div>
                </div>
              </div>
            )}
            
            {selectedZone && (
              <div className="space-y-2">
                <h4 className="font-semibold text-green-800 flex items-center gap-2">
                  <Droplets className="w-4 h-4" />
                  {selectedZone.name}
                </h4>
                <div className="grid grid-cols-2 gap-4 text-sm text-gray-600">
                  {selectedZone.controllerName && (
                    <div><span className="font-medium">Controller:</span> {selectedZone.controllerName}</div>
                  )}
                  {selectedZone.stationNumber && (
                    <div><span className="font-medium">Zone #:</span> {selectedZone.stationNumber}</div>
                  )}
                  {selectedZone.zoneType && (
                    <div><span className="font-medium">Type:</span> {selectedZone.zoneType}</div>
                  )}
                  {selectedZone.coverage && (
                    <div><span className="font-medium">Coverage:</span> {selectedZone.coverage}</div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}