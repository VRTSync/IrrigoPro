import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MapPin, Zap, Droplets, Wrench, Link } from 'lucide-react';

interface ZonePoint {
  id: number;
  name: string;
  controllerName: string;
  stationNumber?: number;
  zoneType: string;
  latitude: number;
  longitude: number;
  description?: string;
}

interface Controller {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  model?: string;
  serialNumber?: string;
  stationCount: number;
  zones: ZonePoint[];
}

interface ZonesDataViewProps {
  controllers: Controller[];
  onZoneClick?: (zone: ZonePoint) => void;
  onControllerClick?: (controller: Controller) => void;
}

const getZoneTypeIcon = (zoneType: string) => {
  switch (zoneType.toLowerCase()) {
    case 'popup':
    case 'pop up':
      return <Zap className="h-4 w-4" />;
    case 'rotor':
      return <Zap className="h-4 w-4" />;
    case 'drip':
      return <Droplets className="h-4 w-4" />;
    case 'node':
      return <Link className="h-4 w-4" />;
    case 'splice':
      return <Wrench className="h-4 w-4" />;
    default:
      return <MapPin className="h-4 w-4" />;
  }
};

const getZoneTypeColor = (zoneType: string) => {
  switch (zoneType.toLowerCase()) {
    case 'popup':
    case 'pop up':
      return 'bg-blue-100 text-blue-800';
    case 'rotor':
      return 'bg-green-100 text-green-800';
    case 'drip':
      return 'bg-purple-100 text-purple-800';
    case 'node':
      return 'bg-orange-100 text-orange-800';
    case 'splice':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
};

export function ZonesDataView({ controllers, onZoneClick, onControllerClick }: ZonesDataViewProps) {
  // Ensure controllers is an array and has valid data
  const validControllers = Array.isArray(controllers) ? controllers : [];
  const totalZones = validControllers.reduce((sum, controller) => sum + (controller?.zones?.length || 0), 0);

  if (validControllers.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">No controllers found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold">{validControllers.length}</div>
            <div className="text-sm text-muted-foreground">Controllers</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold">{totalZones}</div>
            <div className="text-sm text-muted-foreground">Zone Points</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold">
              {validControllers.reduce((sum, c) => sum + (c?.stationCount || 0), 0)}
            </div>
            <div className="text-sm text-muted-foreground">Total Stations</div>
          </CardContent>
        </Card>
      </div>

      {/* Controllers and Zones */}
      <div className="space-y-4">
        {validControllers.map((controller) => {
          if (!controller || !controller.id) return null;
          
          const latitude = typeof controller.latitude === 'string' ? parseFloat(controller.latitude) : controller.latitude;
          const longitude = typeof controller.longitude === 'string' ? parseFloat(controller.longitude) : controller.longitude;
          const zones = controller.zones || [];
          
          return (
            <Card key={controller.id} className="overflow-hidden">
              <CardHeader 
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => onControllerClick?.(controller)}
              >
                <CardTitle className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-5 w-5 text-blue-600" />
                    <span>{controller.name || 'Unknown Controller'}</span>
                    <Badge variant="outline">{zones.length} zones</Badge>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {typeof latitude === 'number' && !isNaN(latitude) ? latitude.toFixed(6) : '0.000000'}, {typeof longitude === 'number' && !isNaN(longitude) ? longitude.toFixed(6) : '0.000000'}
                  </div>
                </CardTitle>
                {(controller.model || controller.serialNumber) && (
                  <div className="text-sm text-muted-foreground">
                    {controller.model && <span>Model: {controller.model}</span>}
                    {controller.model && controller.serialNumber && <span> • </span>}
                    {controller.serialNumber && <span>Serial: {controller.serialNumber}</span>}
                    <span> • {controller.stationCount || 0} stations</span>
                  </div>
                )}
              </CardHeader>
              
              {zones.length > 0 && (
                <CardContent className="pt-0">
                  <div className="grid gap-2">
                    {zones.map((zone) => {
                      if (!zone || !zone.id) return null;
                      return (
                        <div
                          key={zone.id}
                          className="flex items-center justify-between p-3 rounded-lg border cursor-pointer hover:bg-muted/50"
                          onClick={() => onZoneClick?.(zone)}
                        >
                          <div className="flex items-center gap-3">
                            {getZoneTypeIcon(zone.zoneType || '')}
                            <div>
                              <div className="font-medium">{zone.name || 'Unknown Zone'}</div>
                              {zone.stationNumber && (
                                <div className="text-sm text-muted-foreground">
                                  Station {zone.stationNumber}
                                </div>
                              )}
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-2">
                            <Badge 
                              variant="secondary" 
                              className={getZoneTypeColor(zone.zoneType || '')}
                            >
                              {zone.zoneType || 'unknown'}
                            </Badge>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}