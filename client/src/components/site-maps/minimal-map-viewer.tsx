import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Button } from "@/components/ui/button";
import { Maximize, Minimize } from "lucide-react";

interface ColoredZone {
  id: string;
  name: string;
  controllerId: string;
  color?: string;
  boundaries?: [number, number][];
  stationNumber?: number;
  zoneType?: string;
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

interface MinimalMapViewerProps {
  project: SiteMapProject;
  onControllerClick?: (controller: ColoredController) => void;
  onZoneClick?: (zone: ColoredZone) => void;
}

export function MinimalMapViewer({ 
  project, 
  onControllerClick, 
  onZoneClick 
}: MinimalMapViewerProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Calculate height based on controller count - more compact for mobile
  const mapHeight = Math.max(300, project.controllers.length * 40 + 100);

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

    // Initialize map with minimal UI
    const map = L.map(mapRef.current, {
      maxZoom: 25,
      zoomControl: false, // Remove default zoom control
      scrollWheelZoom: true,
      doubleClickZoom: true,
      touchZoom: true,
      dragging: true,
    }).setView([40.7128, -74.0060], 18);
    
    mapInstanceRef.current = map;

    // Add satellite tile layer
    L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
      attribution: '',
      maxZoom: 25,
    }).addTo(map);

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Update map with controllers and zones
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    // Clear existing markers
    mapInstanceRef.current.eachLayer((layer: any) => {
      if (layer instanceof L.Marker || layer instanceof L.CircleMarker || layer instanceof L.Polygon) {
        mapInstanceRef.current?.removeLayer(layer);
      }
    });

    // Add controller markers with proper styling
    project.controllers.forEach(controller => {
      if (!mapInstanceRef.current) return;

      const marker = L.marker([controller.latitude, controller.longitude], {
        icon: L.divIcon({
          html: `<div style="background-color: ${controller.color}; width: 24px; height: 24px; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.2);" class="rounded-full flex items-center justify-center text-white font-bold text-xs">${controller.name.charAt(0)}</div>`,
          className: 'custom-div-icon',
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        })
      }).addTo(mapInstanceRef.current);

      // Enhanced popup with better formatting
      const zoneCount = project.zonesByController[controller.id]?.length || 0;
      marker.bindPopup(`
        <div class="p-2">
          <div class="font-semibold text-base mb-1">${controller.name}</div>
          <div class="text-sm text-gray-600 mb-1">Stations: ${controller.stationCount || 0}</div>
          <div class="text-sm text-gray-600">Zones: ${zoneCount}</div>
        </div>
      `);
    });

    // Add zone boundaries with zone numbers
    project.allZones.forEach(zone => {
      if (!zone.boundaries || !mapInstanceRef.current) return;

      zone.boundaries.forEach(boundary => {
        if (boundary && boundary.length >= 2) {
          const zoneMarker = L.marker([boundary[0], boundary[1]], {
            icon: L.divIcon({
              html: `<div style="background-color: ${zone.color || '#0066cc'}; width: 20px; height: 20px; border: 2px solid white; box-shadow: 0 1px 3px rgba(0,0,0,0.3);" class="rounded-full flex items-center justify-center text-white font-bold text-xs">${zone.stationNumber || '?'}</div>`,
              className: 'custom-zone-icon',
              iconSize: [20, 20],
              iconAnchor: [10, 10]
            })
          }).addTo(mapInstanceRef.current!);

          // Enhanced zone popup
          zoneMarker.bindPopup(`
            <div class="p-2">
              <div class="font-semibold text-base mb-1">${zone.name}</div>
              <div class="text-sm text-gray-600 mb-1">Station: ${zone.stationNumber || 'Unknown'}</div>
              <div class="text-sm text-gray-600 mb-1">Type: ${zone.zoneType || 'Unknown'}</div>
              ${zone.coverage ? `<div class="text-sm text-gray-600">Coverage: ${zone.coverage}</div>` : ''}
            </div>
          `);
        }
      });
    });

    // Auto-fit bounds if controllers exist
    if (project.controllers.length > 0) {
      const allCoordinates: [number, number][] = [];
      project.controllers.forEach(controller => {
        allCoordinates.push([controller.latitude, controller.longitude]);
      });

      project.allZones.forEach(zone => {
        if (zone.boundaries) {
          zone.boundaries.forEach(boundary => {
            if (boundary && boundary.length >= 2) {
              allCoordinates.push([boundary[0], boundary[1]]);
            }
          });
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
  }, [project]);

  if (project.controllers.length === 0) {
    return (
      <div className="w-full h-32 bg-gray-100 rounded border flex items-center justify-center">
        <p className="text-gray-500 text-sm">No site map data available</p>
      </div>
    );
  }

  return (
    <div className={isFullscreen ? 'fixed inset-0 z-50 bg-white' : ''}>
      {/* Minimal controls overlay */}
      <div className="relative">
        <div 
          className={`bg-gray-100 rounded border overflow-hidden ${
            isFullscreen ? 'h-screen' : ''
          }`}
          style={{
            height: isFullscreen ? '100vh' : `${mapHeight}px`,
          }}
        >
          <div ref={mapRef} className="w-full h-full" />
          
          {/* Floating controls - minimal */}
          <div className="absolute top-2 right-2 flex flex-col gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (mapInstanceRef.current) {
                  const currentZoom = mapInstanceRef.current.getZoom();
                  mapInstanceRef.current.setZoom(Math.min(currentZoom + 2, 25));
                }
              }}
              className="h-8 w-8 p-0 bg-white/90 hover:bg-white"
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
              className="h-8 w-8 p-0 bg-white/90 hover:bg-white"
              title="Zoom Out"
            >
              <span className="text-sm font-bold">-</span>
            </Button>
            
            <Button
              variant="outline"
              size="sm"
              onClick={toggleFullscreen}
              className="h-8 w-8 p-0 bg-white/90 hover:bg-white"
              title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
            >
              {isFullscreen ? (
                <Minimize className="w-4 h-4" />
              ) : (
                <Maximize className="w-4 h-4" />
              )}
            </Button>
          </div>

          {/* Simple info overlay */}
          <div className="absolute bottom-2 right-2 bg-white/90 backdrop-blur-sm rounded px-2 py-1 text-xs">
            {project.controllers.length} Controllers • {project.allZones.length} Zones
          </div>
        </div>
      </div>
    </div>
  );
}