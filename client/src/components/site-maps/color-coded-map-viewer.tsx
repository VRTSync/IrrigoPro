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
  Eye,
  Navigation,
  MapPin
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
  const [displayMode, setDisplayMode] = useState<'markers' | 'circles' | 'badges' | 'minimal' | 'heatmap' | 'clusters'>('circles');
  const [showZoneConnections, setShowZoneConnections] = useState(false);
  const [markerSize, setMarkerSize] = useState<'small' | 'medium' | 'large'>('small');
  const [showControllerAreas, setShowControllerAreas] = useState(false);
  const [showUserLocation, setShowUserLocation] = useState(false);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    // Initialize map with mobile-optimized zoom capabilities
    const map = L.map(mapRef.current, {
      maxZoom: 25,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 30,
      zoomControl: true,
      scrollWheelZoom: true,
      doubleClickZoom: true,
      touchZoom: true,
      dragging: true,
      // Mobile-specific optimizations
      tapTolerance: 15,
      bounceAtZoomLimits: true,
      zoomAnimation: true,
      fadeAnimation: true,
      markerZoomAnimation: true
    }).setView([40.7128, -74.0060], 18);
    mapInstanceRef.current = map;

    // Add multiple high-resolution tile layers for maximum detail
    const baseLayers = {
      'Google Satellite (Ultra HD)': L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
        attribution: '&copy; Google',
        maxZoom: 25,
        maxNativeZoom: 23  // Google's highest resolution
      }),
      'Google Hybrid': L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
        attribution: '&copy; Google',
        maxZoom: 25,
        maxNativeZoom: 22
      }),
      'CartoDB Positron': L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CartoDB',
        subdomains: 'abcd',
        maxZoom: 25,
        maxNativeZoom: 20
      }),
      'USGS Imagery': L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles courtesy of the U.S. Geological Survey',
        maxZoom: 25,
        maxNativeZoom: 20
      }),
      'Esri World Imagery': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
        maxZoom: 25,
        maxNativeZoom: 19
      }),
      'OpenStreetMap': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 25,
        maxNativeZoom: 19
      })
    };

    // Add Google satellite by default (highest resolution available)
    baseLayers['Google Satellite (Ultra HD)'].addTo(map);
    
    // Add layer control for switching between tile sources
    L.control.layers(baseLayers).addTo(map);

    // Set map options for enhanced zooming
    map.options.maxZoom = 25;
    map.options.zoomSnap = 0.25;
    map.options.zoomDelta = 0.5;

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

    // Add controller area circles if enabled
    if (showControllerAreas) {
      project.controllers.forEach((controller) => {
        if (!visibleControllers.has(controller.id)) return;
        
        const controllerZones = project.allZones.filter((z: any) => z.controllerId === controller.id);
        if (controllerZones.length > 0) {
          // Calculate coverage area radius based on number of zones
          const radius = Math.max(50, controllerZones.length * 15);
          
          L.circle([controller.latitude, controller.longitude], {
            color: controller.color,
            fillColor: controller.color,
            fillOpacity: 0.1,
            weight: 2,
            radius: radius
          }).addTo(map);
        }
      });
    }

    // Add controller markers with different display modes
    project.controllers.forEach((controller) => {
      if (!visibleControllers.has(controller.id)) return;

      // Validate coordinates before adding
      if (isNaN(controller.latitude) || isNaN(controller.longitude)) {
        console.error(`Invalid controller coordinates for ${controller.name}: lat=${controller.latitude}, lng=${controller.longitude}`);
        return;
      }

      allCoordinates.push([controller.latitude, controller.longitude]);

      // Skip controller markers for heatmap mode
      if (displayMode === 'heatmap') return;

      let controllerIcon;
      const sizes = { small: [28, 28], medium: [40, 40], large: [52, 52] };
      const [width, height] = sizes[markerSize];

      switch (displayMode) {
        case 'circles':
          controllerIcon = L.divIcon({
            html: `
              <div class="rounded-full shadow-lg flex items-center justify-center text-white font-bold border-2 border-white" 
                   style="background-color: ${controller.color}; width: ${width}px; height: ${height}px; font-size: ${markerSize === 'small' ? '10px' : markerSize === 'large' ? '16px' : '12px'}">
                ${controller.name.split(' ')[1] || 'C'}
              </div>
            `,
            className: 'custom-div-icon',
            iconSize: [width, height],
            iconAnchor: [width/2, height/2]
          });
          break;
        case 'badges':
          controllerIcon = L.divIcon({
            html: `
              <div class="bg-white rounded-lg shadow-lg px-2 py-1 border-l-4 text-xs font-bold whitespace-nowrap" style="border-color: ${controller.color}">
                ${controller.name}
              </div>
            `,
            className: 'custom-div-icon',
            iconSize: [80, 24],
            iconAnchor: [40, 12]
          });
          break;
        case 'minimal':
          controllerIcon = L.divIcon({
            html: `
              <div class="rounded-full border-2 border-white shadow-md" 
                   style="background-color: ${controller.color}; width: ${width * 0.7}px; height: ${height * 0.7}px;">
              </div>
            `,
            className: 'custom-div-icon',
            iconSize: [width * 0.7, height * 0.7],
            iconAnchor: [width * 0.35, height * 0.35]
          });
          break;
        default: // markers
          controllerIcon = L.divIcon({
            html: `
              <div class="bg-white text-gray-800 rounded-full flex items-center justify-center text-xs font-bold shadow-lg border-4" 
                   style="border-color: ${controller.color}; width: ${width}px; height: ${height}px; font-size: ${markerSize === 'small' ? '10px' : markerSize === 'large' ? '16px' : '12px'}">
                C
              </div>
            `,
            className: 'custom-div-icon',
            iconSize: [width, height],
            iconAnchor: [width/2, height/2]
          });
      }

      const marker = L.marker([controller.latitude, controller.longitude], {
        icon: controllerIcon
      }).addTo(map);

      // Create enhanced popup content for controller
      const controllerPopupContent = `
        <div class="bg-white rounded-lg shadow-xl border-2 overflow-hidden min-w-[280px] max-w-[320px]" style="border-color: ${controller.color}">
          <div class="px-4 py-3" style="background: linear-gradient(135deg, ${controller.color}ee, ${controller.color})">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-lg border-2 border-white shadow-lg flex items-center justify-center bg-white">
                <span class="font-bold text-lg" style="color: ${controller.color}">${controller.name.split(' ')[1] || 'C'}</span>
              </div>
              <div>
                <h3 class="font-bold text-white text-lg leading-tight">${controller.name}</h3>
                <p class="text-white text-opacity-90 text-sm">Controller</p>
              </div>
            </div>
          </div>
          <div class="p-4 space-y-3">
            <div class="grid grid-cols-2 gap-4">
              <div class="rounded-lg p-3 text-center border-2" style="background-color: ${controller.color}15; border-color: ${controller.color}30">
                <div class="text-2xl font-bold" style="color: ${controller.color}">${controller.stationCount || 0}</div>
                <div class="text-xs text-gray-600 font-medium">STATIONS</div>
              </div>
              <div class="rounded-lg p-3 text-center border-2" style="background-color: ${controller.color}15; border-color: ${controller.color}30">
                <div class="text-2xl font-bold" style="color: ${controller.color}">${project.zonesByController[controller.id]?.length || 0}</div>
                <div class="text-xs text-gray-600 font-medium">ZONES</div>
              </div>
            </div>
            ${controller.model ? `
              <div class="flex items-center gap-3 p-2 rounded" style="background-color: ${controller.color}08">
                <div class="w-2 h-2 rounded-full" style="background-color: ${controller.color}"></div>
                <span class="text-gray-700 text-sm"><strong>Model:</strong> ${controller.model}</span>
              </div>
            ` : ''}
            ${controller.serialNumber ? `
              <div class="flex items-center gap-3 p-2 rounded" style="background-color: ${controller.color}08">
                <div class="w-2 h-2 rounded-full" style="background-color: ${controller.color}"></div>
                <span class="text-gray-700 text-sm"><strong>Serial:</strong> ${controller.serialNumber}</span>
              </div>
            ` : ''}
            ${controller.description ? `
              <div class="mt-3 p-3 rounded-lg border-l-4" style="background-color: ${controller.color}10; border-color: ${controller.color}">
                <p class="text-sm text-gray-700 italic">${controller.description}</p>
              </div>
            ` : ''}
          </div>
          <div class="px-4 py-2 border-t" style="background-color: ${controller.color}08; border-color: ${controller.color}30">
            <div class="flex items-center justify-between text-xs text-gray-600">
              <span>Location</span>
              <span class="font-mono">${controller.latitude.toFixed(6)}, ${controller.longitude.toFixed(6)}</span>
            </div>
          </div>
        </div>
      `;

      marker.bindPopup(controllerPopupContent);
      
      marker.on('click', () => {
        setSelectedController(controller);
        onControllerClick?.(controller);
      });
    });

    // Handle different display modes for zones
    if (displayMode === 'heatmap') {
      // Create heat map effect with colored circles
      project.allZones.forEach((zone) => {
        if (!visibleControllers.has(zone.controllerId)) return;

        if (zone.boundaries && zone.boundaries.length > 0) {
          // Filter and validate coordinate pairs for heatmap
          const validCoords = zone.boundaries.filter(coord => 
            coord && Array.isArray(coord) && coord.length >= 2 && 
            !isNaN(coord[0]) && !isNaN(coord[1]) &&
            coord[0] !== null && coord[1] !== null &&
            coord[0] !== undefined && coord[1] !== undefined
          );
          
          if (validCoords.length === 0) {
            console.warn(`No valid zone boundaries for ${zone.name} in heatmap`);
            return;
          }
          
          const lats = validCoords.map(coord => coord[0]);
          const lngs = validCoords.map(coord => coord[1]);
          
          const zoneLat = lats.reduce((sum, lat) => sum + lat, 0) / lats.length;
          const zoneLng = lngs.reduce((sum, lng) => sum + lng, 0) / lngs.length;
          
          if (!isNaN(zoneLat) && !isNaN(zoneLng) && 
              zoneLat !== null && zoneLng !== null &&
              zoneLat !== undefined && zoneLng !== undefined) {
            allCoordinates.push([zoneLat, zoneLng]);
          } else {
            console.error(`Invalid calculated coordinates for ${zone.name} in heatmap`);
            return;
          }

          L.circle([zoneLat, zoneLng], {
            color: zone.color,
            fillColor: zone.color,
            fillOpacity: 0.6,
            weight: 1,
            radius: markerSize === 'small' ? 8 : markerSize === 'large' ? 20 : 15
          }).addTo(map).bindPopup(`
            <div class="p-2">
              <h4 class="font-bold text-sm">${zone.name}</h4>
              <p class="text-xs">Station: ${zone.stationNumber || 'N/A'}</p>
              <p class="text-xs">Type: ${zone.zoneType || 'Unknown'}</p>
            </div>
          `);
        }
      });
    } else if (displayMode === 'clusters') {
      // Group zones by controller for cluster display
      const clusterGroups = new Map<string, typeof project.allZones>();
      
      project.allZones.forEach((zone) => {
        if (!visibleControllers.has(zone.controllerId)) return;
        
        if (!clusterGroups.has(zone.controllerId)) {
          clusterGroups.set(zone.controllerId, []);
        }
        clusterGroups.get(zone.controllerId)!.push(zone);
      });

      clusterGroups.forEach((zones, controllerId) => {
        zones.forEach((zone, index) => {
          if (zone.boundaries && zone.boundaries.length > 0) {
            // Filter and validate coordinate pairs for clusters
            const validCoords = zone.boundaries.filter(coord => 
              coord && Array.isArray(coord) && coord.length >= 2 && 
              !isNaN(coord[0]) && !isNaN(coord[1]) &&
              coord[0] !== null && coord[1] !== null &&
              coord[0] !== undefined && coord[1] !== undefined
            );
            
            if (validCoords.length === 0) {
              console.warn(`No valid zone boundaries for ${zone.name} in cluster mode`);
              return;
            }
            
            const lats = validCoords.map(coord => coord[0]);
            const lngs = validCoords.map(coord => coord[1]);
            
            const zoneLat = lats.reduce((sum, lat) => sum + lat, 0) / lats.length;
            const zoneLng = lngs.reduce((sum, lng) => sum + lng, 0) / lngs.length;
            
            if (!isNaN(zoneLat) && !isNaN(zoneLng) && 
                zoneLat !== null && zoneLng !== null &&
                zoneLat !== undefined && zoneLng !== undefined) {
              allCoordinates.push([zoneLat, zoneLng]);
            } else {
              console.error(`Invalid calculated coordinates for ${zone.name} in cluster mode`);
              return;
            }

            // Create cluster marker showing zone count
            const clusterIcon = L.divIcon({
              html: `
                <div class="bg-white rounded-full shadow-lg border-2 flex items-center justify-center text-xs font-bold" 
                     style="border-color: ${zone.color}; width: 24px; height: 24px;">
                  ${zone.stationNumber || index + 1}
                </div>
              `,
              className: 'custom-div-icon',
              iconSize: [24, 24],
              iconAnchor: [12, 12]
            });

            L.marker([zoneLat, zoneLng], { icon: clusterIcon }).addTo(map).bindPopup(`
              <div class="p-2">
                <h4 class="font-bold text-sm">${zone.name}</h4>
                <p class="text-xs">Station: ${zone.stationNumber || 'N/A'}</p>
                <p class="text-xs">Type: ${zone.zoneType || 'Unknown'}</p>
              </div>
            `);
          }
        });
      });
    } else {
      // Regular zone markers
      project.allZones.forEach((zone) => {
        if (!visibleControllers.has(zone.controllerId)) return;

        // Calculate center point from boundaries if available
        let zoneLat: number, zoneLng: number;
        
        if (zone.boundaries && zone.boundaries.length > 0) {
          // Filter and validate coordinate pairs
          const validCoords = zone.boundaries.filter(coord => 
            coord && Array.isArray(coord) && coord.length >= 2 && 
            !isNaN(coord[0]) && !isNaN(coord[1]) &&
            coord[0] !== null && coord[1] !== null &&
            coord[0] !== undefined && coord[1] !== undefined
          );
          
          if (validCoords.length === 0) {
            console.warn(`No valid zone boundaries for ${zone.name}`);
            return;
          }
          
          const lats = validCoords.map(coord => coord[0]);
          const lngs = validCoords.map(coord => coord[1]);
          
          zoneLat = lats.reduce((sum, lat) => sum + lat, 0) / lats.length;
          zoneLng = lngs.reduce((sum, lng) => sum + lng, 0) / lngs.length;
          
          // Final validation of calculated center
          if (isNaN(zoneLat) || isNaN(zoneLng) || 
              zoneLat === null || zoneLng === null ||
              zoneLat === undefined || zoneLng === undefined) {
            console.error(`Failed to calculate valid center for ${zone.name}`);
            return;
          }
          
          allCoordinates.push([zoneLat, zoneLng]);
        } else {
          return; // Skip zones without boundaries
        }

        let zoneIcon;
        const zoneSizes = { small: [20, 20], medium: [32, 32], large: [44, 44] };
        const [zWidth, zHeight] = zoneSizes[markerSize];

        switch (displayMode) {
        case 'circles':
          zoneIcon = L.divIcon({
            html: `
              <div class="rounded-full shadow-md border border-white flex items-center justify-center text-white font-bold" 
                   style="background-color: ${zone.color}; width: ${zWidth}px; height: ${zHeight}px; font-size: ${markerSize === 'small' ? '8px' : markerSize === 'large' ? '12px' : '10px'}">
                ${zone.stationNumber || 'Z'}
              </div>
            `,
            className: 'custom-div-icon',
            iconSize: [zWidth, zHeight],
            iconAnchor: [zWidth/2, zHeight/2]
          });
          break;
        case 'badges':
          zoneIcon = L.divIcon({
            html: `
              <div class="bg-white rounded px-1 py-0.5 shadow text-xs font-bold border-l-2" style="border-color: ${zone.color}">
                ${zone.stationNumber || 'Z'}
              </div>
            `,
            className: 'custom-div-icon',
            iconSize: [24, 16],
            iconAnchor: [12, 8]
          });
          break;
        case 'minimal':
          zoneIcon = L.divIcon({
            html: `
              <div class="rounded-full shadow-sm" 
                   style="background-color: ${zone.color}; width: ${zWidth * 0.6}px; height: ${zHeight * 0.6}px;">
              </div>
            `,
            className: 'custom-div-icon',
            iconSize: [zWidth * 0.6, zHeight * 0.6],
            iconAnchor: [zWidth * 0.3, zHeight * 0.3]
          });
          break;
        default: // markers
          zoneIcon = L.divIcon({
            html: `
              <div class="text-white rounded-full flex items-center justify-center text-xs font-bold shadow-lg border-2 border-white" 
                   style="background-color: ${zone.color}; width: ${zWidth}px; height: ${zHeight}px; font-size: ${markerSize === 'small' ? '8px' : markerSize === 'large' ? '12px' : '10px'}">
                Z
              </div>
            `,
            className: 'custom-div-icon',
            iconSize: [zWidth, zHeight],
            iconAnchor: [zWidth/2, zHeight/2]
          });
      }

      const marker = L.marker([zoneLat, zoneLng], {
        icon: zoneIcon
      }).addTo(map);

      // Create enhanced popup content for zone
      const zoneController = project.controllers.find(c => c.id === zone.controllerId);
      const zonePopupContent = `
        <div class="bg-white rounded-lg shadow-xl border-2 overflow-hidden min-w-[260px] max-w-[300px]" style="border-color: ${zone.color}">
          <div class="px-4 py-3" style="background: linear-gradient(135deg, ${zone.color}ee, ${zone.color})">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-lg border-2 border-white shadow-lg flex items-center justify-center bg-white">
                <span class="font-bold text-sm" style="color: ${zone.color}">${zone.stationNumber || 'Z'}</span>
              </div>
              <div>
                <h3 class="font-bold text-white text-base leading-tight">${zone.name}</h3>
                <p class="text-white text-opacity-90 text-sm">
                  ${zone.zoneType ? zone.zoneType.charAt(0).toUpperCase() + zone.zoneType.slice(1) + ' Zone' : 'Zone'}
                </p>
              </div>
            </div>
          </div>
          <div class="p-4 space-y-3">
            ${zoneController ? `
              <div class="flex items-center gap-3 p-3 rounded-lg border-2" style="background-color: ${zoneController.color}10; border-color: ${zoneController.color}30">
                <div class="w-6 h-6 rounded-full" style="background-color: ${zoneController.color}"></div>
                <div>
                  <div class="font-medium text-gray-900 text-sm">${zoneController.name}</div>
                  <div class="text-xs" style="color: ${zoneController.color}">Parent Controller</div>
                </div>
              </div>
            ` : ''}
            <div class="grid grid-cols-2 gap-3">
              ${zone.stationNumber ? `
                <div class="rounded-lg p-3 text-center border-2" style="background-color: ${zone.color}15; border-color: ${zone.color}30">
                  <div class="text-xl font-bold" style="color: ${zone.color}">#${zone.stationNumber}</div>
                  <div class="text-xs text-gray-600 font-medium">STATION</div>
                </div>
              ` : ''}
              ${zone.zoneType ? `
                <div class="rounded-lg p-3 text-center border-2" style="background-color: ${zone.color}15; border-color: ${zone.color}30">
                  <div class="font-bold" style="color: ${zone.color}">${zone.zoneType.toUpperCase()}</div>
                  <div class="text-xs text-gray-600 font-medium">TYPE</div>
                </div>
              ` : ''}
            </div>
            ${zone.coverage ? `
              <div class="flex items-center gap-3 p-2 rounded" style="background-color: ${zone.color}08">
                <div class="w-2 h-2 rounded-full" style="background-color: ${zone.color}"></div>
                <span class="text-gray-700 text-sm"><strong>Coverage:</strong> ${zone.coverage}</span>
              </div>
            ` : ''}
            ${zone.description ? `
              <div class="mt-3 p-3 rounded-lg border-l-4" style="background-color: ${zone.color}10; border-color: ${zone.color}">
                <p class="text-sm text-gray-700 italic">${zone.description}</p>
              </div>
            ` : ''}
          </div>
          <div class="px-4 py-2 border-t" style="background-color: ${zone.color}08; border-color: ${zone.color}30">
            <div class="text-xs text-gray-600 text-center">
              <span>Irrigation Zone</span>
            </div>
          </div>
        </div>
      `;

      marker.bindPopup(zonePopupContent);
      
      marker.on('click', () => {
        setSelectedZone(zone);
        onZoneClick?.(zone);
      });

      // Add connection lines between controller and zones if enabled
      if (showZoneConnections) {
        const zoneController = project.controllers.find(c => c.id === zone.controllerId);
        if (zoneController && visibleControllers.has(zoneController.id)) {
          const connectionLine = L.polyline([
            [zoneController.latitude, zoneController.longitude],
            [zoneLat, zoneLng]
          ], {
            color: zone.color,
            weight: 1,
            opacity: 0.5,
            dashArray: '4, 4'
          }).addTo(map);
        }
      }
    });
    }

    // Fit map to show all markers with enhanced zoom for irrigation detail
    if (allCoordinates.length > 0) {
      if (allCoordinates.length === 1) {
        map.setView(allCoordinates[0], 22); // Much closer for single point
      } else {
        const bounds = L.latLngBounds(allCoordinates);
        map.fitBounds(bounds, { 
          padding: [20, 20],
          maxZoom: 20  // Start closer for detailed irrigation point viewing
        });
      }
    }
  }, [project, visibleControllers, displayMode, markerSize, showZoneConnections, showControllerAreas, onControllerClick, onZoneClick]);

  // Live location functionality
  const getUserLocation = () => {
    if (!navigator.geolocation) {
      setLocationError("Geolocation is not supported by this browser");
      return;
    }

    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        const location: [number, number] = [latitude, longitude];
        setUserLocation(location);
        setShowUserLocation(true);
        
        // Add user location marker to map
        if (mapInstanceRef.current) {
          const userIcon = L.divIcon({
            html: `
              <div class="relative">
                <div class="w-4 h-4 bg-red-500 rounded-full border-2 border-white shadow-lg animate-pulse"></div>
                <div class="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-2 h-2 bg-white rounded-full"></div>
              </div>
            `,
            className: 'user-location-icon',
            iconSize: [16, 16],
            iconAnchor: [8, 8]
          });

          const userMarker = L.marker(location, { icon: userIcon }).addTo(mapInstanceRef.current);
          
          userMarker.bindPopup(`
            <div class="p-2">
              <div class="flex items-center gap-2 mb-2">
                <div class="w-3 h-3 bg-red-500 rounded-full"></div>
                <h3 class="font-bold text-red-600">Your Location</h3>
              </div>
              <p class="text-xs text-gray-600">
                <strong>Coordinates:</strong><br>
                ${latitude.toFixed(6)}, ${longitude.toFixed(6)}
              </p>
              <p class="text-xs text-gray-500 mt-1">
                Accuracy: ±${position.coords.accuracy?.toFixed(0) || 'Unknown'}m
              </p>
            </div>
          `);

          // Optionally center map on user location
          mapInstanceRef.current.setView(location, Math.max(mapInstanceRef.current.getZoom(), 18));
        }
      },
      (error) => {
        switch(error.code) {
          case error.PERMISSION_DENIED:
            setLocationError("Location access denied by user");
            break;
          case error.POSITION_UNAVAILABLE:
            setLocationError("Location information is unavailable");
            break;
          case error.TIMEOUT:
            setLocationError("Location request timed out");
            break;
          default:
            setLocationError("An unknown error occurred while retrieving location");
            break;
        }
        setShowUserLocation(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000 // Cache location for 1 minute
      }
    );
  };

  const watchUserLocation = () => {
    if (!navigator.geolocation) {
      setLocationError("Geolocation is not supported by this browser");
      return;
    }

    setLocationError(null);
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        const location: [number, number] = [latitude, longitude];
        setUserLocation(location);
        
        // Update user location marker on map
        if (mapInstanceRef.current && showUserLocation) {
          // Remove existing user location markers
          mapInstanceRef.current.eachLayer((layer: any) => {
            if (layer.options?.icon?.options?.className === 'user-location-icon') {
              mapInstanceRef.current?.removeLayer(layer);
            }
          });
          
          // Add updated user location marker
          const userIcon = L.divIcon({
            html: `
              <div class="relative">
                <div class="w-4 h-4 bg-red-500 rounded-full border-2 border-white shadow-lg animate-pulse"></div>
                <div class="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-2 h-2 bg-white rounded-full"></div>
              </div>
            `,
            className: 'user-location-icon',
            iconSize: [16, 16],
            iconAnchor: [8, 8]
          });

          L.marker(location, { icon: userIcon }).addTo(mapInstanceRef.current)
            .bindPopup(`
              <div class="p-2">
                <div class="flex items-center gap-2 mb-2">
                  <div class="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                  <h3 class="font-bold text-red-600">Your Live Location</h3>
                </div>
                <p class="text-xs text-gray-600">
                  <strong>Coordinates:</strong><br>
                  ${latitude.toFixed(6)}, ${longitude.toFixed(6)}
                </p>
                <p class="text-xs text-gray-500 mt-1">
                  Accuracy: ±${position.coords.accuracy?.toFixed(0) || 'Unknown'}m
                </p>
                <p class="text-xs text-blue-600 mt-1">
                  🔄 Live tracking active
                </p>
              </div>
            `);
        }
      },
      (error) => {
        console.error("Location tracking error:", error);
        setLocationError("Failed to track location continuously");
      },
      {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 30000
      }
    );

    // Store watch ID for cleanup
    return watchId;
  };

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
    
    // Force map resize after fullscreen toggle
    setTimeout(() => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize();
        // Re-fit bounds to ensure map displays properly
        const allCoordinates: [number, number][] = [];
        
        project.controllers.forEach(controller => {
          if (visibleControllers.has(controller.id)) {
            allCoordinates.push([controller.latitude, controller.longitude]);
          }
        });

        project.allZones.forEach(zone => {
          if (visibleControllers.has(zone.controllerId) && zone.boundaries && zone.boundaries.length > 0) {
            zone.boundaries.forEach(coord => {
              if (coord && coord.length >= 2) {
                allCoordinates.push([coord[0], coord[1]]);
              }
            });
          }
        });

        if (allCoordinates.length > 0) {
          if (allCoordinates.length === 1) {
            mapInstanceRef.current.setView(allCoordinates[0], 22);
          } else {
            const bounds = L.latLngBounds(allCoordinates);
            mapInstanceRef.current.fitBounds(bounds, { 
              padding: [20, 20],
              maxZoom: 20
            });
          }
        }
      }
    }, 300); // Give time for DOM to update
  };

  const totalZones = project.allZones.length;
  const visibleZones = project.allZones.filter(z => visibleControllers.has(z.controllerId)).length;
  
  // Calculate dynamic height based on controller count
  const mapHeight = Math.max(500, project.controllers.length * 80 + 200);
  console.log(`Map height calculation: ${project.controllers.length} controllers = ${mapHeight}px`);

  return (
    <Card className={`${isFullscreen ? 'mobile-fullscreen-container fixed inset-0 z-50 bg-white p-2 sm:p-4 overflow-y-auto' : 'space-y-2'}`}>
      <CardHeader className="pb-4">
        <CardTitle className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <MapIcon className="w-4 h-4 text-green-600 flex-shrink-0" />
            <span className="text-sm font-semibold truncate">
              {isFullscreen ? 'Fullscreen Site Map' : 'Site Map View'}
            </span>
            <Badge variant="outline" className="text-xs whitespace-nowrap ml-auto">
              {project.controllers.length} Controllers • {totalZones} Zones
            </Badge>
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {/* Essential control buttons only */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (mapInstanceRef.current) {
                  const currentZoom = mapInstanceRef.current.getZoom();
                  mapInstanceRef.current.setZoom(Math.min(currentZoom + 2, 25));
                }
              }}
              title="Zoom In"
              className="h-7 w-7 sm:h-8 sm:w-8 p-0"
            >
              <span className="text-sm sm:text-lg font-bold">+</span>
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
              title="Zoom Out"
              className="h-7 w-7 sm:h-8 sm:w-8 p-0"
            >
              <span className="text-sm sm:text-lg font-bold">-</span>
            </Button>
            <Button
              variant={showUserLocation ? "default" : "outline"}
              size="sm"
              onClick={getUserLocation}
              title="Show My Location"
              className="h-7 sm:h-8 px-2"
            >
              <Navigation className="w-3 h-3 sm:w-4 sm:h-4 mr-1" />
              <span className="text-xs sm:text-sm">GPS</span>
            </Button>
            <Button
              variant={isFullscreen ? "default" : "outline"}
              size="sm"
              onClick={toggleFullscreen}
              className="h-7 sm:h-8 px-3 sm:px-2"
              title={isFullscreen ? "Exit Map View" : "View Map Fullscreen"}
            >
              {isFullscreen ? (
                <>
                  <Minimize className="w-3 h-3 sm:w-4 sm:h-4 sm:mr-1" />
                  <span className="text-xs sm:text-sm">Exit</span>
                </>
              ) : (
                <>
                  <Maximize className="w-3 h-3 sm:w-4 sm:h-4 sm:mr-1" />
                  <span className="text-xs sm:text-sm">
                    <span className="hidden sm:inline">View Map</span>
                    <span className="sm:hidden">Map</span>
                  </span>
                </>
              )}
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
        <CardContent className={`${isFullscreen ? 'pt-2 pb-2' : 'pt-4'}`}>
          {/* Mobile-optimized Display Options - Collapsible in fullscreen */}
          <div className={`${isFullscreen ? 'mb-2 space-y-2' : 'mb-4 space-y-3'} ${isFullscreen ? 'hidden sm:block' : ''}`}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex items-center gap-2">
                <label className="text-xs sm:text-sm font-medium flex-shrink-0">Display:</label>
                <select 
                  value={displayMode} 
                  onChange={(e) => setDisplayMode(e.target.value as any)}
                  className="px-2 py-1 border rounded text-xs sm:text-sm flex-1"
                >
                  <option value="markers">Markers</option>
                  <option value="circles">Circles</option>
                  <option value="badges">Badges</option>
                  <option value="minimal">Minimal</option>
                  <option value="heatmap">Heat Map</option>
                  <option value="clusters">Clusters</option>
                </select>
              </div>
              
              <div className="flex items-center gap-2">
                <label className="text-xs sm:text-sm font-medium flex-shrink-0">Size:</label>
                <select 
                  value={markerSize} 
                  onChange={(e) => setMarkerSize(e.target.value as any)}
                  className="px-2 py-1 border rounded text-xs sm:text-sm flex-1"
                >
                  <option value="small">Small</option>
                  <option value="medium">Medium</option>
                  <option value="large">Large</option>
                </select>
              </div>
            </div>

            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-xs sm:text-sm">
                <input
                  type="checkbox"
                  checked={showZoneConnections}
                  onChange={(e) => setShowZoneConnections(e.target.checked)}
                  className="rounded"
                />
                <span className="hidden sm:inline">Zone Connections</span>
                <span className="sm:hidden">Connections</span>
              </label>

              <label className="flex items-center gap-2 text-xs sm:text-sm">
                <input
                  type="checkbox"
                  checked={showControllerAreas}
                  onChange={(e) => setShowControllerAreas(e.target.checked)}
                  className="rounded"
                />
                <span className="hidden sm:inline">Controller Areas</span>
                <span className="sm:hidden">Areas</span>
              </label>
              
              <label className="flex items-center gap-2 text-xs sm:text-sm">
                <input
                  type="checkbox"
                  checked={showUserLocation}
                  onChange={(e) => {
                    if (e.target.checked) {
                      getUserLocation();
                    } else {
                      setShowUserLocation(false);
                      setUserLocation(null);
                      // Remove user location markers from map
                      if (mapInstanceRef.current) {
                        mapInstanceRef.current.eachLayer((layer: any) => {
                          if (layer.options?.icon?.options?.className === 'user-location-icon') {
                            mapInstanceRef.current?.removeLayer(layer);
                          }
                        });
                      }
                    }
                  }}
                  className="rounded"
                />
                <span className="hidden sm:inline">My Location</span>
                <span className="sm:hidden">Location</span>
              </label>
            </div>
            
            {/* Location Error Display */}
            {locationError && (
              <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs sm:text-sm text-red-700">
                <div className="flex items-center gap-1">
                  <MapPin className="w-3 h-3 flex-shrink-0" />
                  <span>{locationError}</span>
                </div>
              </div>
            )}
          </div>
          {/* Mobile-optimized Controller Legend & Controls - Collapsible in fullscreen */}
          <div className={`${isFullscreen ? 'mb-2 hidden sm:block' : 'mb-4'}`}>
            <h4 className="font-medium text-gray-900 text-xs sm:text-base mb-1 sm:mb-3">Controllers:</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {project.controllers.map((controller) => {
                const isVisible = visibleControllers.has(controller.id);
                const zoneCount = project.zonesByController[controller.id]?.length || 0;
                
                return (
                  <div
                    key={controller.id}
                    className={`flex items-center justify-between p-2 sm:p-3 rounded-lg border cursor-pointer transition-all ${
                      isVisible 
                        ? 'border-gray-300 bg-white shadow-sm' 
                        : 'border-gray-200 bg-gray-50 opacity-60'
                    }`}
                    onClick={() => toggleControllerVisibility(controller.id)}
                  >
                    <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                      <div
                        className="w-3 h-3 sm:w-4 sm:h-4 rounded-full border-2 border-white shadow-sm flex-shrink-0"
                        style={{ backgroundColor: controller.color }}
                      />
                      <div className="min-w-0">
                        <div className="font-medium text-xs sm:text-sm text-gray-900 truncate">{controller.name}</div>
                        <div className="text-xs text-gray-500">{zoneCount} zones</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Eye className={`w-3 h-3 sm:w-4 sm:h-4 ${isVisible ? 'text-green-600' : 'text-gray-400'}`} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Truly dynamic Map container based on controller count */}
          <div className={`relative bg-gray-100 rounded-lg overflow-hidden border ${
            isFullscreen 
              ? 'mobile-fullscreen-map h-[calc(100vh-100px)] sm:h-[calc(100vh-140px)]' 
              : 'w-full'
          }`} style={{
            height: isFullscreen ? undefined : `${mapHeight}px`,
          }}>
            <div ref={mapRef} className="w-full h-full touch-pan-x touch-pan-y touch-pinch-zoom" />
            
            {/* Mobile-optimized Map Info Overlay */}
            <div className="absolute top-2 right-2 sm:top-4 sm:right-4 bg-white/95 backdrop-blur-sm rounded-lg p-2 sm:p-3 shadow-lg max-w-[150px] sm:max-w-none">
              <div className="text-xs sm:text-sm space-y-1">
                <div className="flex items-center gap-1 sm:gap-2">
                  <Settings className="w-3 h-3 sm:w-4 sm:h-4 text-blue-600" />
                  <span className="font-medium truncate">
                    <span className="hidden sm:inline">Controllers: </span>
                    {visibleControllers.size}/{project.controllers.length}
                  </span>
                </div>
                <div className="flex items-center gap-1 sm:gap-2">
                  <Droplets className="w-3 h-3 sm:w-4 sm:h-4 text-green-600" />
                  <span className="font-medium truncate">
                    <span className="hidden sm:inline">Zones: </span>
                    {visibleZones}/{totalZones}
                  </span>
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

          {/* Mobile-optimized Legend - Hidden in mobile fullscreen */}
          <div className={`${isFullscreen ? 'mt-2 p-2 hidden sm:block' : 'mt-4 p-3 sm:p-4'} bg-blue-50 border border-blue-200 rounded-lg`}>
            <div className="flex items-center gap-2 mb-2">
              <Info className="w-3 h-3 sm:w-4 sm:h-4 text-blue-600" />
              <span className="font-medium text-blue-800 text-sm sm:text-base">Map Legend</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 text-xs sm:text-sm text-blue-700">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 sm:w-6 sm:h-6 bg-white border-2 border-blue-600 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">C</div>
                <span className="truncate">
                  <span className="hidden sm:inline">Controllers</span>
                  <span className="sm:hidden">Controllers</span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 sm:w-5 sm:h-5 bg-blue-600 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0">Z</div>
                <span className="truncate">
                  <span className="hidden sm:inline">Zones</span>
                  <span className="sm:hidden">Zones</span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-red-500 rounded-full border border-white shadow-sm flex-shrink-0 animate-pulse"></div>
                <span className="truncate">
                  <span className="hidden sm:inline">Your Location</span>
                  <span className="sm:hidden">You</span>
                </span>
              </div>
            </div>
          </div>
        </CardContent>
    </Card>
  );
}