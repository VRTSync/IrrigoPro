import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  MapIcon, 
  Maximize, 
  Minimize, 
  Settings, 
  Droplets,
  Info,
  Eye
} from "lucide-react";

interface ColoredController {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  color: string;
  model?: string;
  serialNumber?: string;
  stationCount?: number;
  description?: string;
}

interface ColoredZone {
  name: string;
  controllerId: string;
  color: string;
  boundaries?: [number, number][];
  stationNumber?: number;
  zoneType?: string;
  coverage?: string;
  description?: string;
}

interface SiteMapProject {
  controllers: ColoredController[];
  zonesByController: { [controllerId: string]: ColoredZone[] };
  allZones: ColoredZone[];
}

interface ColorCodedMapViewerProps {
  project: SiteMapProject;
  onControllerClick?: (controller: ColoredController) => void;
  onZoneClick?: (zone: ColoredZone) => void;
}

export function ColorCodedMapViewer({ 
  project, 
  onControllerClick, 
  onZoneClick 
}: ColorCodedMapViewerProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedController, setSelectedController] = useState<ColoredController | null>(null);
  const [selectedZone, setSelectedZone] = useState<ColoredZone | null>(null);
  const [visibleControllers, setVisibleControllers] = useState<Set<string>>(
    new Set(project.controllers.map(c => c.id))
  );

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    // Initialize map
    const map = L.map(mapRef.current).setView([40.7128, -74.0060], 13);
    mapInstanceRef.current = map;

    // Add tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!mapInstanceRef.current || project.controllers.length === 0) return;

    const map = mapInstanceRef.current;
    
    // Clear existing markers
    map.eachLayer((layer) => {
      if (layer instanceof L.Marker) {
        map.removeLayer(layer);
      }
    });

    const allCoordinates: [number, number][] = [];

    // Add controller markers
    project.controllers.forEach((controller) => {
      if (!visibleControllers.has(controller.id)) return;

      allCoordinates.push([controller.latitude, controller.longitude]);

      const controllerIcon = L.divIcon({
        html: `
          <div class="bg-white text-gray-800 rounded-full w-10 h-10 flex items-center justify-center text-xs font-bold shadow-lg border-4" style="border-color: ${controller.color}">
            C
          </div>
        `,
        className: 'custom-div-icon',
        iconSize: [40, 40],
        iconAnchor: [20, 20]
      });

      const marker = L.marker([controller.latitude, controller.longitude], {
        icon: controllerIcon
      }).addTo(map);

      // Create popup content for controller
      const controllerPopupContent = `
        <div class="p-3">
          <div class="flex items-center gap-2 mb-2">
            <div class="w-4 h-4 rounded-full" style="background-color: ${controller.color}"></div>
            <h3 class="font-bold text-lg" style="color: ${controller.color}">${controller.name}</h3>
          </div>
          ${controller.model ? `<p><strong>Model:</strong> ${controller.model}</p>` : ''}
          ${controller.serialNumber ? `<p><strong>Serial:</strong> ${controller.serialNumber}</p>` : ''}
          ${controller.stationCount ? `<p><strong>Stations:</strong> ${controller.stationCount}</p>` : ''}
          ${controller.description ? `<p class="text-sm text-gray-600 mt-2">${controller.description}</p>` : ''}
          <p class="text-xs text-gray-500 mt-2">
            <strong>Zones:</strong> ${project.zonesByController[controller.id]?.length || 0}
          </p>
        </div>
      `;

      marker.bindPopup(controllerPopupContent);
      
      marker.on('click', () => {
        setSelectedController(controller);
        onControllerClick?.(controller);
      });
    });

    // Add zone markers
    project.allZones.forEach((zone) => {
      if (!visibleControllers.has(zone.controllerId)) return;

      // Calculate center point from boundaries if available
      let zoneLat: number, zoneLng: number;
      
      if (zone.boundaries && zone.boundaries.length > 0) {
        const lats = zone.boundaries.map(coord => coord[0]);
        const lngs = zone.boundaries.map(coord => coord[1]);
        zoneLat = lats.reduce((sum, lat) => sum + lat, 0) / lats.length;
        zoneLng = lngs.reduce((sum, lng) => sum + lng, 0) / lngs.length;
        allCoordinates.push([zoneLat, zoneLng]);
      } else {
        return; // Skip zones without boundaries
      }

      const zoneIcon = L.divIcon({
        html: `
          <div class="text-white rounded-full w-8 h-8 flex items-center justify-center text-xs font-bold shadow-lg border-2 border-white" style="background-color: ${zone.color}">
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
      const zoneController = project.controllers.find(c => c.id === zone.controllerId);
      const zonePopupContent = `
        <div class="p-2">
          <div class="flex items-center gap-2 mb-2">
            <div class="w-3 h-3 rounded-full" style="background-color: ${zone.color}"></div>
            <h3 class="font-bold" style="color: ${zone.color}">${zone.name}</h3>
          </div>
          ${zoneController ? `<p><strong>Controller:</strong> ${zoneController.name}</p>` : ''}
          ${zone.stationNumber ? `<p><strong>Station:</strong> ${zone.stationNumber}</p>` : ''}
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

    // Fit map to show all markers
    if (allCoordinates.length > 0) {
      if (allCoordinates.length === 1) {
        map.setView(allCoordinates[0], 16);
      } else {
        const bounds = L.latLngBounds(allCoordinates);
        map.fitBounds(bounds, { padding: [20, 20] });
      }
    }
  }, [project, visibleControllers, onControllerClick, onZoneClick]);

  const toggleControllerVisibility = (controllerId: string) => {
    setVisibleControllers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(controllerId)) {
        newSet.delete(controllerId);
      } else {
        newSet.add(controllerId);
      }
      return newSet;
    });
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  const totalZones = project.allZones.length;
  const visibleZones = project.allZones.filter(z => visibleControllers.has(z.controllerId)).length;

  return (
    <div className={`space-y-6 ${isFullscreen ? 'fixed inset-0 z-50 bg-white p-6' : ''}`}>
      {/* Map Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MapIcon className="w-5 h-5 text-green-600" />
              Color-Coded Site Map
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-sm">
                {project.controllers.length} Controllers • {totalZones} Zones
              </Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={toggleFullscreen}
              >
                {isFullscreen ? (
                  <>
                    <Minimize className="w-4 h-4 mr-1" />
                    Exit Fullscreen
                  </>
                ) : (
                  <>
                    <Maximize className="w-4 h-4 mr-1" />
                    Fullscreen
                  </>
                )}
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Controller Legend & Controls */}
          <div className="mb-4">
            <h4 className="font-medium text-gray-900 mb-3">Controller Visibility:</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {project.controllers.map((controller) => {
                const isVisible = visibleControllers.has(controller.id);
                const zoneCount = project.zonesByController[controller.id]?.length || 0;
                
                return (
                  <div
                    key={controller.id}
                    className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${
                      isVisible 
                        ? 'border-gray-300 bg-white shadow-sm' 
                        : 'border-gray-200 bg-gray-50 opacity-60'
                    }`}
                    onClick={() => toggleControllerVisibility(controller.id)}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-4 h-4 rounded-full border-2 border-white shadow-sm"
                        style={{ backgroundColor: controller.color }}
                      />
                      <div>
                        <div className="font-medium text-sm text-gray-900">{controller.name}</div>
                        <div className="text-xs text-gray-500">{zoneCount} zones</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Eye className={`w-4 h-4 ${isVisible ? 'text-green-600' : 'text-gray-400'}`} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Map */}
          <div className={`relative bg-gray-100 rounded-lg overflow-hidden border ${
            isFullscreen ? 'h-[calc(100vh-300px)]' : 'h-[500px]'
          }`}>
            <div ref={mapRef} className="w-full h-full" />
            
            {/* Map Info Overlay */}
            <div className="absolute top-4 right-4 bg-white/90 backdrop-blur-sm rounded-lg p-3 shadow-lg">
              <div className="text-sm space-y-1">
                <div className="flex items-center gap-2">
                  <Settings className="w-4 h-4 text-blue-600" />
                  <span className="font-medium">Controllers: {visibleControllers.size}/{project.controllers.length}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Droplets className="w-4 h-4 text-green-600" />
                  <span className="font-medium">Zones: {visibleZones}/{totalZones}</span>
                </div>
              </div>
            </div>

            {project.controllers.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-50">
                <div className="text-center">
                  <MapIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-500">Upload controller KML files to view the map</p>
                </div>
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Info className="w-4 h-4 text-blue-600" />
              <span className="font-medium text-blue-800">Map Legend</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm text-blue-700">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-white border-2 border-blue-600 rounded-full flex items-center justify-center text-xs font-bold">C</div>
                <span>Controllers (colored border)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 bg-blue-600 rounded-full flex items-center justify-center text-xs font-bold text-white">Z</div>
                <span>Zones (controller color)</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}