import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CustomerSelector } from "@/components/ui/customer-selector";
import { 
  MapIcon, 
  Upload, 
  Database, 
  Settings, 
  Info,
  FileText,
  AlertTriangle,
  Users,
  Building
} from "lucide-react";
import { ControllerUpload } from "./controller-upload";
import { ZoneUpload } from "./zone-upload";
import { ColorCodedMapViewer } from "./color-coded-map-viewer";
import { ColorCodedDataReview } from "./color-coded-data-review";
import type { ParsedKMLData, KMLController, KMLZone } from "@/lib/kml-parser";

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

export function SiteMapsPage() {
  // Get current user role for permissions
  const getCurrentUser = () => {
    const savedUser = localStorage.getItem("user");
    return savedUser ? JSON.parse(savedUser) : null;
  };
  
  const user = getCurrentUser();
  const userRole = user?.role;
  const canEdit = userRole === 'company_admin' || userRole === 'super_admin';
  const canView = userRole === 'company_admin' || userRole === 'super_admin' || userRole === 'irrigation_manager' || userRole === 'field_tech';

  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [project, setProject] = useState<SiteMapProject>({
    controllers: [],
    zonesByController: {},
    allZones: []
  });
  const [controllerFile, setControllerFile] = useState<File | null>(null);
  const [selectedController, setSelectedController] = useState<ColoredController | null>(null);
  const [selectedZone, setSelectedZone] = useState<ColoredZone | null>(null);
  const [uploadingZonesFor, setUploadingZonesFor] = useState<string | null>(null);

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

  const handleControllerFileSelected = (file: File) => {
    setControllerFile(file);
  };

  const startZoneUpload = (controllerId: string) => {
    setUploadingZonesFor(controllerId);
  };

  const handleSaveToDatabase = () => {
    if (!selectedCustomer) {
      console.error("No customer selected");
      return;
    }
    
    // TODO: Implement saving to database with customer ID
    console.log("Saving to database:", { 
      customerId: selectedCustomer.id,
      customerName: selectedCustomer.name,
      project 
    });
  };

  // Redirect unauthorized users
  if (!canView) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center">
        <div className="bg-red-50 border border-red-200 rounded-lg p-8">
          <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-red-800 mb-2">Access Restricted</h2>
          <p className="text-red-600">
            You don't have permission to access the Site Maps feature. 
            Please contact your administrator for access.
          </p>
        </div>
      </div>
    );
  }

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
                {canEdit 
                  ? "Import KML files to visualize irrigation controllers and zones on interactive maps"
                  : "View irrigation controller and zone maps for your properties"
                }
              </p>
              {selectedCustomer && canEdit && (
                <div className="mt-4">
                  <Badge className="bg-blue-100 text-blue-800 border-blue-300">
                    <Building className="w-3 h-3 mr-1" />
                    Creating site map for: {selectedCustomer.name}
                  </Badge>
                </div>
              )}
              {!canEdit && (
                <div className="mt-4">
                  <Badge className="bg-blue-100 text-blue-800 border-blue-300">
                    <Info className="w-3 h-3 mr-1" />
                    View-Only Access
                  </Badge>
                </div>
              )}
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

      <Tabs defaultValue={canEdit ? "upload" : "map"} className="w-full">
        <TabsList className={`grid w-full ${canEdit ? 'grid-cols-3' : 'grid-cols-2'} bg-white shadow-sm border border-gray-200 p-1 rounded-xl`}>
          {canEdit && (
            <TabsTrigger 
              value="upload" 
              className="flex items-center gap-2 data-[state=active]:bg-blue-500 data-[state=active]:text-white data-[state=active]:shadow-md rounded-lg transition-all duration-200"
            >
              <Upload className="w-4 h-4" />
              <span className="font-medium">Upload KML</span>
            </TabsTrigger>
          )}
          <TabsTrigger 
            value="map" 
            className="flex items-center gap-2 data-[state=active]:bg-green-500 data-[state=active]:text-white data-[state=active]:shadow-md rounded-lg transition-all duration-200"
            disabled={project.controllers.length === 0}
          >
            <MapIcon className="w-4 h-4" />
            <span className="font-medium">Map View</span>
          </TabsTrigger>
          <TabsTrigger 
            value="data" 
            className="flex items-center gap-2 data-[state=active]:bg-purple-500 data-[state=active]:text-white data-[state=active]:shadow-md rounded-lg transition-all duration-200"
            disabled={project.controllers.length === 0}
          >
            <Database className="w-4 h-4" />
            <span className="font-medium">Data Review</span>
          </TabsTrigger>
        </TabsList>

        {canEdit && (
          <TabsContent value="upload" className="space-y-6 mt-6">
            {/* Customer Selection */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-blue-600" />
                  Select Customer
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <p className="text-sm text-gray-600">
                    Choose the customer to attach this site map to before uploading KML files.
                  </p>
                  <CustomerSelector
                    selectedCustomer={selectedCustomer}
                    onSelectCustomer={(customer) => {
                      setSelectedCustomer(customer);
                    }}
                    placeholder="Select a customer for this site map..."
                  />
                  {selectedCustomer && (
                    <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                      <p className="text-sm text-green-800">
                        ✓ Customer selected. You can now upload KML files for this site map.
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* File Upload Sections - Only show if customer is selected */}
            {selectedCustomer ? (
              <>
                <ControllerUpload 
                  onKMLParsed={handleControllerKMLParsed}
                  onFileSelected={handleControllerFileSelected}
                />
                
                <ZoneUpload
                  controllers={project.controllers}
                  onZoneKMLParsed={handleZoneKMLParsed}
                  uploadingFor={uploadingZonesFor}
                  onStartUpload={startZoneUpload}
                  zonesByController={project.zonesByController}
                />
              </>
            ) : (
              <Card>
                <CardContent className="flex items-center justify-center py-16">
                  <div className="text-center">
                    <Upload className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">Select Customer First</h3>
                    <p className="text-gray-600">Choose a customer above to begin uploading site map files</p>
                  </div>
                </CardContent>
              </Card>
            )}

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
        )}

        <TabsContent value="map" className="space-y-6 mt-6">
          {project.controllers.length > 0 ? (
            <ColorCodedMapViewer
              project={project}
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
          {project.controllers.length > 0 ? (
            <ColorCodedDataReview project={project} />
          ) : (
            <Card>
              <CardContent className="p-12 text-center">
                <FileText className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No KML Data Available</h3>
                <p className="text-gray-600">Upload and process KML files to review the extracted data</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}