import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  MapIcon, 
  Settings, 
  Droplets, 
  Eye,
  Navigation,
  MapPin,
  Maximize,
  Minimize
} from "lucide-react";

// Import all the color constants and interfaces from the original
interface ColoredZone {
  id: string;
  name: string;
  controllerId: string;
  color?: string;
  boundaries?: [number, number][];
  stationNumber?: number;
  zoneType?: string;
  coverage?: string;
  description?: string;
}

interface ColoredController {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  color: string;
  stationCount?: number;
  zones?: ColoredZone[];
}

interface SiteMapProject {
  controllers: ColoredController[];
  zonesByController: { [controllerId: string]: ColoredZone[] };
  allZones: ColoredZone[];
}

interface CompactMapViewerProps {
  project: SiteMapProject;
  onControllerClick?: (controller: ColoredController) => void;
  onZoneClick?: (zone: ColoredZone) => void;
}

export function CompactMapViewer({ 
  project, 
  onControllerClick, 
  onZoneClick 
}: CompactMapViewerProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [visibleControllers, setVisibleControllers] = useState<Set<string>>(
    new Set(project.controllers.map(c => c.id))
  );
  const [displayMode, setDisplayMode] = useState<'markers' | 'circles'>('circles');
  const [markerSize, setMarkerSize] = useState<'small' | 'medium' | 'large'>('small');

  // Calculate dynamic height based on controller count
  const mapHeight = Math.max(400, project.controllers.length * 60 + 150);

  const totalZones = project.allZones.length;
  const visibleZones = project.allZones.filter(z => visibleControllers.has(z.controllerId)).length;

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
    setTimeout(() => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize();
      }
    }, 100);
  };

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    // Initialize map
    const map = L.map(mapRef.current, {
      maxZoom: 25,
      zoomControl: true,
      scrollWheelZoom: true,
      doubleClickZoom: true,
      touchZoom: true,
      dragging: true,
    }).setView([40.7128, -74.0060], 18);
    
    mapInstanceRef.current = map;

    // Add tile layer
    L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
      attribution: '&copy; Google',
      maxZoom: 25,
    }).addTo(map);

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Update map markers when controllers change
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    // Clear existing markers
    mapInstanceRef.current.eachLayer((layer: any) => {
      if (layer instanceof L.Marker || layer instanceof L.CircleMarker || layer instanceof L.Polygon) {
        mapInstanceRef.current?.removeLayer(layer);
      }
    });

    // Add controller markers
    project.controllers.forEach(controller => {
      if (!visibleControllers.has(controller.id) || !mapInstanceRef.current) return;

      const size = markerSize === 'small' ? 8 : markerSize === 'medium' ? 12 : 16;
      
      if (displayMode === 'circles') {
        L.circleMarker([controller.latitude, controller.longitude], {
          radius: size,
          fillColor: controller.color,
          color: 'white',
          weight: 2,
          opacity: 1,
          fillOpacity: 0.8
        }).addTo(mapInstanceRef.current)
          .bindPopup(`<strong>${controller.name}</strong><br/>Stations: ${controller.stationCount || 0}`);
      } else {
        const marker = L.marker([controller.latitude, controller.longitude], {
          icon: L.divIcon({
            html: `<div style="background-color: ${controller.color}; width: ${size * 2}px; height: ${size * 2}px;" class="rounded-full border-2 border-white shadow-lg flex items-center justify-center text-white font-bold text-xs">${controller.name.charAt(0)}</div>`,
            className: 'custom-div-icon',
            iconSize: [size * 2, size * 2],
            iconAnchor: [size, size]
          })
        }).addTo(mapInstanceRef.current)
          .bindPopup(`<strong>${controller.name}</strong><br/>Stations: ${controller.stationCount || 0}`);
      }
    });

    // Add zone boundaries
    project.allZones.forEach(zone => {
      if (!visibleControllers.has(zone.controllerId) || !zone.boundaries || !mapInstanceRef.current) return;

      zone.boundaries.forEach(boundary => {
        if (boundary && boundary.length >= 2) {
          L.circleMarker([boundary[0], boundary[1]], {
            radius: 4,
            fillColor: zone.color || '#0066cc',
            color: 'white',
            weight: 1,
            opacity: 1,
            fillOpacity: 0.6
          }).addTo(mapInstanceRef.current!)
            .bindPopup(`<strong>${zone.name}</strong><br/>Type: ${zone.zoneType || 'Unknown'}`);
        }
      });
    });

    // Fit bounds if controllers exist
    if (project.controllers.length > 0) {
      const allCoordinates: [number, number][] = [];
      project.controllers.forEach(controller => {
        if (visibleControllers.has(controller.id)) {
          allCoordinates.push([controller.latitude, controller.longitude]);
        }
      });

      if (allCoordinates.length > 0) {
        setTimeout(() => {
          if (mapInstanceRef.current) {
            const bounds = L.latLngBounds(allCoordinates);
            mapInstanceRef.current.fitBounds(bounds, { padding: [20, 20], maxZoom: 20 });
          }
        }, 100);
      }
    }
  }, [project, visibleControllers, displayMode, markerSize]);

  return (
    <div className={`${isFullscreen ? 'fixed inset-0 z-50 bg-white p-4 overflow-y-auto' : 'space-y-2'}`}>
      {/* Compact header */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <MapIcon className="w-4 h-4 text-green-600 flex-shrink-0" />
          <span className="text-sm font-semibold truncate">Site Map</span>
          <Badge variant="outline" className="text-xs whitespace-nowrap">
            {project.controllers.length} Controllers • {totalZones} Zones
          </Badge>
        </div>
        
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (mapInstanceRef.current) {
                const currentZoom = mapInstanceRef.current.getZoom();
                mapInstanceRef.current.setZoom(Math.min(currentZoom + 2, 25));
              }
            }}
            className="h-6 w-6 p-0"
            title="Zoom In"
          >
            <span className="text-sm font-bold">+</span>
          </Button>
          
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (mapInstanceRef.current) {
                const currentZoom = mapInstanceRef.current.getZoom();
                mapInstanceRef.current.setZoom(Math.max(currentZoom - 2, 1));
              }
            }}
            className="h-6 w-6 p-0"
            title="Zoom Out"
          >
            <span className="text-sm font-bold">-</span>
          </Button>
          
          <Button
            variant="outline"
            size="sm"
            onClick={toggleFullscreen}
            className="h-6 w-6 p-0"
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? (
              <Minimize className="w-3 h-3" />
            ) : (
              <Maximize className="w-3 h-3" />
            )}
          </Button>
        </div>
      </div>

      {/* Compact display controls */}
      {!isFullscreen && (
        <div className="flex items-center gap-2 text-xs">
          <select 
            value={displayMode} 
            onChange={(e) => setDisplayMode(e.target.value as any)}
            className="px-2 py-1 border rounded text-xs"
          >
            <option value="circles">Circles</option>
            <option value="markers">Markers</option>
          </select>
          
          <select 
            value={markerSize} 
            onChange={(e) => setMarkerSize(e.target.value as any)}
            className="px-2 py-1 border rounded text-xs"
          >
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
          </select>
        </div>
      )}

      {/* Map container */}
      <div 
        className={`relative bg-gray-100 rounded-lg overflow-hidden border ${
          isFullscreen 
            ? 'h-[calc(100vh-120px)]' 
            : 'w-full'
        }`} 
        style={{
          height: isFullscreen ? undefined : `${mapHeight}px`,
        }}
      >
        <div ref={mapRef} className="w-full h-full" />
        
        {/* Map overlay info */}
        <div className="absolute top-2 right-2 bg-white/95 backdrop-blur-sm rounded-lg p-2 shadow-lg">
          <div className="text-xs space-y-1">
            <div className="flex items-center gap-2">
              <Settings className="w-3 h-3 text-blue-600" />
              <span className="font-medium">{visibleControllers.size}/{project.controllers.length}</span>
            </div>
            <div className="flex items-center gap-2">
              <Droplets className="w-3 h-3 text-green-600" />
              <span className="font-medium">{visibleZones}/{totalZones}</span>
            </div>
          </div>
        </div>

        {project.controllers.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-50">
            <div className="text-center">
              <MapIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500 text-sm">Upload controller KML files to view the map</p>
            </div>
          </div>
        )}
      </div>

      {/* Compact controller list */}
      {!isFullscreen && project.controllers.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 text-xs">
          {project.controllers.slice(0, 6).map((controller) => {
            const isVisible = visibleControllers.has(controller.id);
            const zoneCount = project.zonesByController[controller.id]?.length || 0;
            
            return (
              <div
                key={controller.id}
                className={`flex items-center gap-2 p-2 rounded border cursor-pointer transition-all ${
                  isVisible ? 'bg-white border-gray-300' : 'bg-gray-50 border-gray-200 opacity-60'
                }`}
                onClick={() => {
                  const newVisible = new Set(visibleControllers);
                  if (isVisible) {
                    newVisible.delete(controller.id);
                  } else {
                    newVisible.add(controller.id);
                  }
                  setVisibleControllers(newVisible);
                }}
              >
                <div
                  className="w-3 h-3 rounded-full border border-white shadow-sm flex-shrink-0"
                  style={{ backgroundColor: controller.color }}
                />
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{controller.name}</div>
                  <div className="text-gray-500">{zoneCount} zones</div>
                </div>
                <Eye className={`w-3 h-3 ${isVisible ? 'text-green-600' : 'text-gray-400'}`} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}