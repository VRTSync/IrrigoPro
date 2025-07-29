import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Settings, Droplets, MapIcon } from "lucide-react";

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

interface ColorCodedDataReviewProps {
  project: SiteMapProject;
}

export function ColorCodedDataReview({ project }: ColorCodedDataReviewProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Controllers Data */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-blue-600" />
            Controllers ({project.controllers.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {project.controllers.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No controllers uploaded yet</p>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {project.controllers.map((controller) => {
                const zoneCount = project.zonesByController[controller.id]?.length || 0;
                
                return (
                  <div 
                    key={controller.id}
                    className="p-4 border border-gray-200 rounded-lg hover:bg-blue-50 transition-colors"
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <div
                        className="w-4 h-4 rounded-full border-2 border-white shadow-sm"
                        style={{ backgroundColor: controller.color }}
                      />
                      <h4 className="font-medium text-gray-900">{controller.name}</h4>
                      <Badge variant="outline" className="text-xs">
                        {zoneCount} zones
                      </Badge>
                    </div>
                    <div className="text-sm text-gray-600 space-y-1 ml-7">
                      {controller.model && <div><strong>Model:</strong> {controller.model}</div>}
                      {controller.serialNumber && <div><strong>Serial:</strong> {controller.serialNumber}</div>}
                      <div><strong>Stations:</strong> {controller.stationCount || 8}</div>
                      <div className="text-xs text-gray-500">
                        <strong>Location:</strong> {controller.latitude.toFixed(6)}, {controller.longitude.toFixed(6)}
                      </div>
                      {controller.description && (
                        <div className="text-xs text-gray-500 mt-2">
                          <strong>Description:</strong> {controller.description}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Zones Data */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Droplets className="w-5 h-5 text-green-600" />
            Irrigation Zones ({project.allZones.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {project.allZones.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No zones uploaded yet</p>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {project.allZones.map((zone, index) => {
                const controller = project.controllers.find(c => c.id === zone.controllerId);
                
                return (
                  <div 
                    key={`${zone.controllerId}-${index}`}
                    className="p-4 border border-gray-200 rounded-lg hover:bg-green-50 transition-colors"
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <div
                        className="w-4 h-4 rounded-full border-2 border-white shadow-sm"
                        style={{ backgroundColor: zone.color }}
                      />
                      <h4 className="font-medium text-gray-900">{zone.name}</h4>
                    </div>
                    <div className="text-sm text-gray-600 space-y-1 ml-7">
                      {controller && <div><strong>Controller:</strong> {controller.name}</div>}
                      {zone.stationNumber && <div><strong>Station:</strong> {zone.stationNumber}</div>}
                      {zone.zoneType && <div><strong>Type:</strong> {zone.zoneType}</div>}
                      {zone.coverage && <div><strong>Coverage:</strong> {zone.coverage}</div>}
                      <div className="text-xs text-gray-500">
                        <strong>Boundaries:</strong> {zone.boundaries ? `${zone.boundaries.length} points` : 'No boundaries'}
                      </div>
                      {zone.description && (
                        <div className="text-xs text-gray-500 mt-2">
                          <strong>Description:</strong> {zone.description}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Project Summary */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapIcon className="w-5 h-5 text-purple-600" />
            Project Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div className="text-center">
              <div className="text-3xl font-bold text-blue-600 mb-2">
                {project.controllers.length}
              </div>
              <div className="text-sm text-gray-600">Controllers Uploaded</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-green-600 mb-2">
                {project.allZones.length}
              </div>
              <div className="text-sm text-gray-600">Total Zones</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-purple-600 mb-2">
                {Object.keys(project.zonesByController).filter(id => project.zonesByController[id]?.length > 0).length}
              </div>
              <div className="text-sm text-gray-600">Controllers with Zones</div>
            </div>
          </div>

          {/* Controllers with Zone Counts */}
          {project.controllers.length > 0 && (
            <div className="mt-6">
              <h4 className="font-medium text-gray-900 mb-3">Zone Distribution:</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {project.controllers.map((controller) => {
                  const zoneCount = project.zonesByController[controller.id]?.length || 0;
                  
                  return (
                    <div 
                      key={controller.id}
                      className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: controller.color }}
                        />
                        <span className="text-sm font-medium text-gray-900">
                          {controller.name}
                        </span>
                      </div>
                      <Badge 
                        variant="outline" 
                        className={`text-xs ${zoneCount === 0 ? 'border-orange-300 text-orange-700' : 'border-green-300 text-green-700'}`}
                      >
                        {zoneCount} zones
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}