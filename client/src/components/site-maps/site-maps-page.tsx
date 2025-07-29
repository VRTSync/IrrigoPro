import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  MapIcon, 
  Upload, 
  Database, 
  Settings, 
  Info,
  FileText,
  AlertTriangle
} from "lucide-react";
import { KMLUpload } from "./kml-upload";
import { SiteMapViewer } from "./site-map-viewer";
import type { ParsedKMLData, KMLController, KMLZone } from "@/lib/kml-parser";

export function SiteMapsPage() {
  const [kmlData, setKMLData] = useState<ParsedKMLData | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedController, setSelectedController] = useState<KMLController | null>(null);
  const [selectedZone, setSelectedZone] = useState<KMLZone | null>(null);

  const handleKMLParsed = (data: ParsedKMLData) => {
    setKMLData(data);
  };

  const handleFileSelected = (file: File) => {
    setSelectedFile(file);
  };

  const handleSaveToDatabase = () => {
    // TODO: Implement saving to database
    console.log("Saving to database:", { kmlData, selectedFile });
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Header */}
      <div className="mb-8">
        <div className="bg-gradient-to-r from-green-50 to-blue-50 rounded-xl border shadow-lg p-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-3 flex items-center gap-3">
                <div className="bg-gradient-to-br from-green-500 to-blue-600 p-3 rounded-2xl shadow-lg">
                  <MapIcon className="w-8 h-8 text-white" />
                </div>
                Site Maps & Controller Management
              </h1>
              <p className="text-gray-600 text-lg">
                Import KML files to visualize irrigation controllers and zones on interactive maps
              </p>
            </div>
            <div className="text-right">
              <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300 mb-2">
                <AlertTriangle className="w-3 h-3 mr-1" />
                Development Preview
              </Badge>
              <p className="text-sm text-gray-500">
                This feature is in development and not yet connected to the main customer database
              </p>
            </div>
          </div>
        </div>
      </div>

      <Tabs defaultValue="upload" className="w-full">
        <TabsList className="grid w-full grid-cols-3 bg-white shadow-sm border border-gray-200 p-1 rounded-xl">
          <TabsTrigger 
            value="upload" 
            className="flex items-center gap-2 data-[state=active]:bg-blue-500 data-[state=active]:text-white data-[state=active]:shadow-md rounded-lg transition-all duration-200"
          >
            <Upload className="w-4 h-4" />
            <span className="font-medium">Upload KML</span>
          </TabsTrigger>
          <TabsTrigger 
            value="map" 
            className="flex items-center gap-2 data-[state=active]:bg-green-500 data-[state=active]:text-white data-[state=active]:shadow-md rounded-lg transition-all duration-200"
            disabled={!kmlData}
          >
            <MapIcon className="w-4 h-4" />
            <span className="font-medium">Map View</span>
          </TabsTrigger>
          <TabsTrigger 
            value="data" 
            className="flex items-center gap-2 data-[state=active]:bg-purple-500 data-[state=active]:text-white data-[state=active]:shadow-md rounded-lg transition-all duration-200"
            disabled={!kmlData}
          >
            <Database className="w-4 h-4" />
            <span className="font-medium">Data Review</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="upload" className="space-y-6 mt-6">
          <KMLUpload 
            onKMLParsed={handleKMLParsed}
            onFileSelected={handleFileSelected}
          />

          {/* Instructions */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Info className="w-5 h-5 text-blue-600" />
                KML File Requirements
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4 text-sm text-gray-600">
                <div>
                  <h4 className="font-medium text-gray-900 mb-2">For Irrigation Controllers:</h4>
                  <ul className="list-disc list-inside space-y-1 ml-4">
                    <li>Use <strong>Point</strong> placemarks to mark controller locations</li>
                    <li>Include controller details in description: Model, Serial Number, Station Count</li>
                    <li>Example description: "Model: Rain Bird ESP-6TM, Serial: 12345, Stations: 8"</li>
                  </ul>
                </div>
                <div>
                  <h4 className="font-medium text-gray-900 mb-2">For Irrigation Zones:</h4>
                  <ul className="list-disc list-inside space-y-1 ml-4">
                    <li>Use <strong>Polygon</strong> or <strong>LineString</strong> placemarks to define zone boundaries</li>
                    <li>Include zone details: Controller name, Station number, Zone type, Coverage area</li>
                    <li>Example description: "Controller: Main Controller, Station: 1, Type: Sprinkler, Coverage: Front lawn"</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="map" className="space-y-6 mt-6">
          {kmlData ? (
            <SiteMapViewer
              kmlData={kmlData}
              onControllerClick={setSelectedController}
              onZoneClick={setSelectedZone}
            />
          ) : (
            <Card>
              <CardContent className="flex items-center justify-center py-16">
                <div className="text-center">
                  <MapIcon className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">No Map Data</h3>
                  <p className="text-gray-600">Upload a KML file to view the site map</p>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="data" className="space-y-6 mt-6">
          {kmlData ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Controllers Data */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Settings className="w-5 h-5 text-blue-600" />
                    Controllers ({kmlData.controllers.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {kmlData.controllers.length === 0 ? (
                    <p className="text-gray-500 text-center py-8">No controllers found in KML file</p>
                  ) : (
                    <div className="space-y-3 max-h-96 overflow-y-auto">
                      {kmlData.controllers.map((controller, index) => (
                        <div 
                          key={index}
                          className="p-3 border border-gray-200 rounded-lg hover:bg-blue-50 cursor-pointer transition-colors"
                          onClick={() => setSelectedController(controller)}
                        >
                          <h4 className="font-medium text-gray-900">{controller.name}</h4>
                          <div className="text-sm text-gray-600 mt-1 space-y-1">
                            {controller.model && <div>Model: {controller.model}</div>}
                            {controller.serialNumber && <div>Serial: {controller.serialNumber}</div>}
                            <div>Stations: {controller.stationCount || 8}</div>
                            <div className="text-xs text-gray-500">
                              {controller.latitude.toFixed(6)}, {controller.longitude.toFixed(6)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Zones Data */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MapIcon className="w-5 h-5 text-green-600" />
                    Irrigation Zones ({kmlData.zones.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {kmlData.zones.length === 0 ? (
                    <p className="text-gray-500 text-center py-8">No zones found in KML file</p>
                  ) : (
                    <div className="space-y-3 max-h-96 overflow-y-auto">
                      {kmlData.zones.map((zone, index) => (
                        <div 
                          key={index}
                          className="p-3 border border-gray-200 rounded-lg hover:bg-green-50 cursor-pointer transition-colors"
                          onClick={() => setSelectedZone(zone)}
                        >
                          <h4 className="font-medium text-gray-900">{zone.name}</h4>
                          <div className="text-sm text-gray-600 mt-1 space-y-1">
                            {zone.controllerName && <div>Controller: {zone.controllerName}</div>}
                            {zone.stationNumber && <div>Station: {zone.stationNumber}</div>}
                            {zone.zoneType && <div>Type: {zone.zoneType}</div>}
                            {zone.coverage && <div>Coverage: {zone.coverage}</div>}
                            <div className="text-xs text-gray-500">
                              {zone.boundaries ? `${zone.boundaries.length} boundary points` : 'No boundaries'}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card>
              <CardContent className="flex items-center justify-center py-16">
                <div className="text-center">
                  <FileText className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">No Data Available</h3>
                  <p className="text-gray-600">Upload and parse a KML file to review the extracted data</p>
                </div>
              </CardContent>
            </Card>
          )}

          {kmlData && (
            <Card className="border-orange-200 bg-orange-50">
              <CardHeader>
                <CardTitle className="text-orange-800">Ready to Save to Database?</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-orange-700 mb-4">
                  Once you're satisfied with the data, you can save it to the database and link it to customers.
                </p>
                <Button 
                  onClick={handleSaveToDatabase}
                  className="bg-orange-600 hover:bg-orange-700"
                  disabled
                >
                  Save to Database (Coming Soon)
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}