import React, { useState } from 'react';
import { KMLParser, ParsedKMLData, KMLController, KMLZone } from '../lib/kml-parser';

interface ColoredController extends KMLController {
  color: string;
  id: string;
}

interface ColoredZone extends KMLZone {
  controllerId: string;
  color: string;
}

interface SiteMapProject {
  controllers: ColoredController[];
  zonesByController: { [controllerId: string]: ColoredZone[] };
  allZones: ColoredZone[];
}

export function IrrigationMapDemo() {
  const [project, setProject] = useState<SiteMapProject>({
    controllers: [],
    zonesByController: {},
    allZones: []
  });
  const [uploadingZonesFor, setUploadingZonesFor] = useState<string | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);

  // Color palette for controllers
  const controllerColors = [
    '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
    '#06b6d4', '#84cc16', '#f97316', '#ec4899', '#6366f1'
  ];

  const handleControllerKMLParsed = (data: ParsedKMLData) => {
    const coloredControllers: ColoredController[] = data.controllers.map((controller, index) => ({
      ...controller,
      id: `controller-${index}`,
      color: controllerColors[index % controllerColors.length]
    }));

    setProject({
      controllers: coloredControllers,
      zonesByController: {},
      allZones: []
    });
  };

  const handleZoneKMLParsed = (data: ParsedKMLData, controllerId: string) => {
    if (!uploadingZonesFor) return;

    const controller = project.controllers.find(c => c.id === controllerId);
    if (!controller) return;

    const coloredZones: ColoredZone[] = data.zones.map(zone => ({
      ...zone,
      controllerId,
      color: controller.color
    }));

    setProject(prev => ({
      ...prev,
      zonesByController: {
        ...prev.zonesByController,
        [controllerId]: coloredZones
      },
      allZones: [
        ...prev.allZones.filter(z => z.controllerId !== controllerId),
        ...coloredZones
      ]
    }));

    setUploadingZonesFor(null);
  };

  const handleControllerUpload = async (file: File) => {
    try {
      const parsedData = await KMLParser.parseKMLFile(file);
      handleControllerKMLParsed(parsedData);
      console.log('Controller KML processed:', parsedData);
    } catch (error) {
      console.error('Failed to process controller KML:', error);
    }
  };

  const handleZoneUpload = async (file: File, controllerId: string) => {
    try {
      const parsedData = await KMLParser.parseKMLFile(file);
      handleZoneKMLParsed(parsedData, controllerId);
      console.log('Zone KML processed:', parsedData);
    } catch (error) {
      console.error('Failed to process zone KML:', error);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Irrigation KML Mapping System Demo
        </h1>
        <p className="text-gray-600 text-lg">
          Import KML files to visualize irrigation controllers and zones on interactive maps
        </p>
      </div>

      {/* Customer Selection (simplified for demo) */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-xl font-semibold mb-4">Step 1: Select Customer</h2>
        <select 
          value={selectedCustomer?.id || ""}
          onChange={(e) => setSelectedCustomer({ id: e.target.value, name: e.target.options[e.target.selectedIndex].text })}
          className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="">Select a customer...</option>
          <option value="demo1">First Bank - Main Campus</option>
          <option value="demo2">Corporate Office Complex</option>
          <option value="demo3">Residential Estate</option>
        </select>
        {selectedCustomer && (
          <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-sm text-green-800">
              ✓ Customer selected: {selectedCustomer.name}
            </p>
          </div>
        )}
      </div>

      {/* File Upload Sections */}
      {selectedCustomer && (
        <div className="space-y-6">
          {/* Controller Upload */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-xl font-semibold mb-4">Step 2: Upload Controller KML</h2>
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
              <input
                type="file"
                accept=".kml"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleControllerUpload(file);
                }}
                className="mb-4"
              />
              <p className="text-gray-600">
                Upload a KML file containing irrigation controller locations
              </p>
            </div>
            
            {project.controllers.length > 0 && (
              <div className="mt-4">
                <h3 className="font-medium mb-2">Loaded Controllers:</h3>
                <div className="space-y-2">
                  {project.controllers.map(controller => (
                    <div key={controller.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                      <div 
                        className="w-4 h-4 rounded-full border-2 border-white shadow-sm"
                        style={{ backgroundColor: controller.color }}
                      />
                      <span className="font-medium">{controller.name}</span>
                      <span className="text-sm text-gray-600">
                        {controller.model || 'Model not specified'}
                      </span>
                      <span className="text-sm text-gray-600">
                        Stations: {controller.stationCount || 8}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Zone Upload */}
          {project.controllers.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-xl font-semibold mb-4">Step 3: Upload Zone KML Files</h2>
              
              <div className="mb-6">
                <h3 className="font-medium mb-3">Select Controller for Zone Upload:</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {project.controllers.map(controller => {
                    const zones = project.zonesByController[controller.id] || [];
                    const isSelected = uploadingZonesFor === controller.id;
                    
                    return (
                      <div
                        key={controller.id}
                        className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                          isSelected
                            ? 'border-blue-500 bg-blue-50 shadow-md'
                            : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                        }`}
                        onClick={() => setUploadingZonesFor(controller.id)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div
                              className="w-4 h-4 rounded-full border-2 border-white shadow-sm"
                              style={{ backgroundColor: controller.color }}
                            />
                            <div>
                              <div className="font-medium text-gray-900">{controller.name}</div>
                              {controller.model && (
                                <div className="text-xs text-gray-500">{controller.model}</div>
                              )}
                            </div>
                          </div>
                          <div className="text-right">
                            <span className="text-xs border border-gray-300 rounded px-2 py-1">
                              {zones.length} zones
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {uploadingZonesFor && (
                <div className="border-2 border-dashed border-green-300 rounded-lg p-8 text-center">
                  <input
                    type="file"
                    accept=".kml"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file && uploadingZonesFor) {
                        handleZoneUpload(file, uploadingZonesFor);
                      }
                    }}
                    className="mb-4"
                  />
                  <p className="text-gray-600">
                    Upload zones for {project.controllers.find(c => c.id === uploadingZonesFor)?.name}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Data Review */}
          {project.allZones.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-xl font-semibold mb-4">Step 4: Review Data</h2>
              
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Controllers Summary */}
                <div>
                  <h3 className="font-medium mb-3">Controllers ({project.controllers.length})</h3>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {project.controllers.map(controller => {
                      const zoneCount = project.zonesByController[controller.id]?.length || 0;
                      return (
                        <div key={controller.id} className="p-3 border border-gray-200 rounded-lg">
                          <div className="flex items-center gap-3 mb-1">
                            <div
                              className="w-3 h-3 rounded-full"
                              style={{ backgroundColor: controller.color }}
                            />
                            <span className="font-medium">{controller.name}</span>
                            <span className="text-xs bg-gray-100 px-2 py-1 rounded">
                              {zoneCount} zones
                            </span>
                          </div>
                          <div className="text-sm text-gray-600 ml-6">
                            <div>Model: {controller.model || 'Not specified'}</div>
                            <div>Stations: {controller.stationCount || 8}</div>
                            <div className="text-xs">
                              Location: {controller.latitude.toFixed(6)}, {controller.longitude.toFixed(6)}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Zones Summary */}
                <div>
                  <h3 className="font-medium mb-3">Zones ({project.allZones.length})</h3>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {project.allZones.map((zone, index) => {
                      const controller = project.controllers.find(c => c.id === zone.controllerId);
                      return (
                        <div key={`${zone.controllerId}-${index}`} className="p-3 border border-gray-200 rounded-lg">
                          <div className="flex items-center gap-3 mb-1">
                            <div
                              className="w-3 h-3 rounded-full"
                              style={{ backgroundColor: zone.color }}
                            />
                            <span className="font-medium">{zone.name}</span>
                          </div>
                          <div className="text-sm text-gray-600 ml-6">
                            <div>Controller: {controller?.name}</div>
                            {zone.stationNumber && <div>Station: {zone.stationNumber}</div>}
                            {zone.zoneType && <div>Type: {zone.zoneType}</div>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* KML File Format Instructions */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-blue-900 mb-4">KML File Requirements</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
          <div>
            <h3 className="font-medium text-blue-900 mb-2">For Controllers:</h3>
            <ul className="list-disc list-inside space-y-1 text-blue-800">
              <li>Use <strong>Point</strong> placemarks to mark controller locations</li>
              <li>Include controller details in description: Model, Serial Number, Station Count</li>
              <li>Example: "Model: Rain Bird ESP-6TM, Serial: 12345, Stations: 8"</li>
            </ul>
          </div>
          <div>
            <h3 className="font-medium text-blue-900 mb-2">For Zones:</h3>
            <ul className="list-disc list-inside space-y-1 text-blue-800">
              <li>Use <strong>Point</strong> placemarks to mark irrigation zone locations</li>
              <li>Include zone details: Controller name, Station number, Zone type</li>
              <li>Example: "Controller: Clock A, Station: 7, Type: Pop-ups"</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}