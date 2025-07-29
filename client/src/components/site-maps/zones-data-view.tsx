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
  const totalZones = controllers.reduce((sum, controller) => sum + controller.zones.length, 0);

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold">{controllers.length}</div>
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
              {controllers.reduce((sum, c) => sum + c.stationCount, 0)}
            </div>
            <div className="text-sm text-muted-foreground">Total Stations</div>
          </CardContent>
        </Card>
      </div>

      {/* Controllers and Zones */}
      <div className="space-y-4">
        {controllers.map((controller) => (
          <Card key={controller.id} className="overflow-hidden">
            <CardHeader 
              className="cursor-pointer hover:bg-muted/50"
              onClick={() => onControllerClick?.(controller)}
            >
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MapPin className="h-5 w-5 text-blue-600" />
                  <span>{controller.name}</span>
                  <Badge variant="outline">{controller.zones.length} zones</Badge>
                </div>
                <div className="text-sm text-muted-foreground">
                  {controller.latitude?.toFixed(6) || '0.000000'}, {controller.longitude?.toFixed(6) || '0.000000'}
                </div>
              </CardTitle>
              {(controller.model || controller.serialNumber) && (
                <div className="text-sm text-muted-foreground">
                  {controller.model && <span>Model: {controller.model}</span>}
                  {controller.model && controller.serialNumber && <span> • </span>}
                  {controller.serialNumber && <span>Serial: {controller.serialNumber}</span>}
                  <span> • {controller.stationCount} stations</span>
                </div>
              )}
            </CardHeader>
            
            {controller.zones.length > 0 && (
              <CardContent className="pt-0">
                <div className="grid gap-2">
                  {controller.zones.map((zone) => (
                    <div
                      key={zone.id}
                      className="flex items-center justify-between p-3 rounded-lg border cursor-pointer hover:bg-muted/50"
                      onClick={() => onZoneClick?.(zone)}
                    >
                      <div className="flex items-center gap-3">
                        {getZoneTypeIcon(zone.zoneType)}
                        <div>
                          <div className="font-medium">{zone.name}</div>
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
                          className={getZoneTypeColor(zone.zoneType)}
                        >
                          {zone.zoneType}
                        </Badge>
                        <div className="text-sm text-muted-foreground">
                          {zone.latitude.toFixed(6)}, {zone.longitude.toFixed(6)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            )}
          </Card>
        ))}
      </div>

      {controllers.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center">
            <MapPin className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <div className="text-lg font-medium mb-2">No Data Available</div>
            <div className="text-muted-foreground">
              Upload controller and zone KML files to view the irrigation system data.
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}