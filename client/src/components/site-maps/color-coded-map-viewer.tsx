import { useState, useRef, useEffect } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  MapIcon, 
  Maximize,
  Minimize,
  Eye,
  EyeOff,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Layers,
  Settings,
  Info,
  Droplets,
  Navigation
} from 'lucide-react';

// Component imports and interfaces (copy from original)
interface ColoredZone {
  id: string;
  name: string;
  color: string;
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
  zones?: ColoredZone[];
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

  // Map initialization and other functions (simplified)
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

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
      bounceAtZoomLimits: true,
      zoomAnimation: true,
      fadeAnimation: true,
      markerZoomAnimation: true
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

  const toggleFullscreen = () => setIsFullscreen(!isFullscreen);
  const toggleControllerVisibility = (controllerId: string) => {
    const newVisible = new Set(visibleControllers);
    if (newVisible.has(controllerId)) {
      newVisible.delete(controllerId);
    } else {
      newVisible.add(controllerId);
    }
    setVisibleControllers(newVisible);
  };

  const getUserLocation = () => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation not supported');
      return;
    }
    
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location: [number, number] = [position.coords.latitude, position.coords.longitude];
        setUserLocation(location);
        setShowUserLocation(true);
        setLocationError(null);
        if (mapInstanceRef.current) {
          mapInstanceRef.current.setView(location, 20);
        }
      },
      (error) => {
        setLocationError(`Location error: ${error.message}`);
        setShowUserLocation(false);
      }
    );
  };

  const totalZones = project.allZones.length;
  const visibleZones = project.allZones.filter(z => visibleControllers.has(z.controllerId)).length;
  
  // Calculate dynamic height based on controller count
  const mapHeight = Math.max(500, project.controllers.length * 80 + 200);

  return (
    <div className={`${isFullscreen ? 'mobile-fullscreen-container fixed inset-0 z-50 bg-white p-2 sm:p-4 overflow-y-auto' : 'space-y-4'}`}>
      {/* Map Controls Header - No Card Wrapper */}
      <div className="bg-white border rounded-lg p-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <MapIcon className="w-4 h-4 sm:w-5 sm:h-5 text-green-600 flex-shrink-0" />
            <span className="text-sm sm:text-base font-semibold truncate">
              {isFullscreen ? 'Fullscreen Site Map' : 'Site Map View'}
            </span>
          </div>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3">
            <Badge variant="outline" className="text-xs sm:text-sm whitespace-nowrap">
              {project.controllers.length} Controllers • {totalZones} Zones
            </Badge>
            {/* Mobile-optimized control buttons */}
            <div className="flex items-center gap-1 flex-wrap">
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
          </div>
        </div>
      </div>
      
      {/* Map Controls Section */}
      <div className="bg-white border rounded-lg p-4 shadow-sm">
        {/* Display Options */}
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
        </div>

        {/* Controller List */}
        <div className={`${isFullscreen ? 'mb-2' : 'mb-4'}`}>
          <h4 className="text-sm font-medium text-gray-700 mb-2">Controllers</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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

        {/* Dynamic Map Container - No Card Wrapper */}
        <div className={`relative bg-gray-100 rounded-lg overflow-hidden border ${
          isFullscreen 
            ? 'mobile-fullscreen-map h-[calc(100vh-100px)] sm:h-[calc(100vh-140px)]' 
            : 'w-full'
        }`} style={{
          height: isFullscreen ? undefined : `${mapHeight}px`,
        }}>
          <div ref={mapRef} className="w-full h-full touch-pan-x touch-pan-y touch-pinch-zoom" />
          
          {/* Map Info Overlay */}
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

        {/* Map Legend */}
        <div className={`${isFullscreen ? 'mt-2 p-2 hidden sm:block' : 'mt-4 p-3 sm:p-4'} bg-blue-50 border border-blue-200 rounded-lg`}>
          <div className="flex items-center gap-2 mb-2">
            <Info className="w-3 h-3 sm:w-4 sm:h-4 text-blue-600" />
            <span className="font-medium text-blue-800 text-sm sm:text-base">Map Legend</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 text-xs sm:text-sm text-blue-700">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 sm:w-6 sm:h-6 bg-white border-2 border-blue-600 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">C</div>
              <span className="truncate">Controllers</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 sm:w-5 sm:h-5 bg-blue-600 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0">Z</div>
              <span className="truncate">Zones</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-red-500 rounded-full border border-white shadow-sm flex-shrink-0 animate-pulse"></div>
              <span className="truncate">Your Location</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}