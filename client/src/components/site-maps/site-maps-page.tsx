import { useState, useEffect } from "react";
import * as React from "react";
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
  Building,
  Save,
  Edit,
  FolderOpen
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
  const [editingSiteMap, setEditingSiteMap] = useState<any>(null);
  const [customerSiteMaps, setCustomerSiteMaps] = useState<any[]>([]);
  const [allSiteMaps, setAllSiteMaps] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

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

  // Load existing site maps for a customer
  const loadCustomerSiteMaps = async (customerId: number) => {
    try {
      const response = await fetch(`/api/customers/${customerId}/site-maps`, {
        headers: {
          'x-user-role': user?.role || ''
        }
      });
      
      if (response.ok) {
        const siteMaps = await response.json();
        setCustomerSiteMaps(siteMaps);
      }
    } catch (error) {
      console.error("Error loading customer site maps:", error);
    }
  };

  // Load a site map for editing
  const loadSiteMapForEditing = async (siteMap: any) => {
    try {
      setEditingSiteMap(siteMap);
      
      // Load controllers
      const controllersResponse = await fetch(`/api/site-maps/${siteMap.id}/controllers`, {
        headers: {
          'x-user-role': user?.role || ''
        }
      });
      
      if (!controllersResponse.ok) {
        throw new Error('Failed to load controllers');
      }
      
      const controllers = await controllersResponse.json();
      
      // Load zones
      const zonesResponse = await fetch(`/api/site-maps/${siteMap.id}/zones`, {
        headers: {
          'x-user-role': user?.role || ''
        }
      });
      
      if (!zonesResponse.ok) {
        throw new Error('Failed to load zones');
      }
      
      const zones = await zonesResponse.json();
      
      // Convert database format to project format with robust coordinate parsing
      const coloredControllers: ColoredController[] = controllers.map((controller: any, index: number) => {
        const lat = typeof controller.latitude === 'string' ? parseFloat(controller.latitude) : controller.latitude;
        const lng = typeof controller.longitude === 'string' ? parseFloat(controller.longitude) : controller.longitude;
        
        console.log(`Controller ${controller.name}: lat=${lat}, lng=${lng} (original: ${controller.latitude}, ${controller.longitude})`);
        
        return {
          id: `controller-${controller.id}`,
          name: controller.name,
          latitude: lat,
          longitude: lng,
          model: controller.model || '',
          serialNumber: controller.serialNumber || '',
          stationCount: controller.stationCount || 8,
          description: controller.description || '',
          color: controllerColors[index % controllerColors.length]
        };
      });
      
      // Group zones by controller
      const zonesByController: { [controllerId: string]: ColoredZone[] } = {};
      const allZones: ColoredZone[] = [];
      
      zones.forEach((zone: any) => {
        const controller = coloredControllers.find(c => c.id === `controller-${zone.controllerId}`);
        if (controller) {
          // Parse zone coordinates more robustly
          let zoneLat: number, zoneLng: number;
          
          if (zone.latitude && zone.longitude) {
            zoneLat = typeof zone.latitude === 'string' ? parseFloat(zone.latitude) : zone.latitude;
            zoneLng = typeof zone.longitude === 'string' ? parseFloat(zone.longitude) : zone.longitude;
          } else if (zone.boundaries && Array.isArray(zone.boundaries) && zone.boundaries.length > 0) {
            // Try parsing from boundaries array
            const coords = Array.isArray(zone.boundaries[0]) ? zone.boundaries[0] : zone.boundaries;
            zoneLat = parseFloat(coords[0]);
            zoneLng = parseFloat(coords[1]);
          } else {
            // Fallback to controller coordinates with small offset
            zoneLat = controller.latitude + (Math.random() - 0.5) * 0.001;
            zoneLng = controller.longitude + (Math.random() - 0.5) * 0.001;
          }
          
          console.log(`Zone ${zone.name}: lat=${zoneLat}, lng=${zoneLng}`);
          
          const coloredZone: ColoredZone = {
            name: zone.name,
            stationNumber: zone.zoneNumber || zone.stationNumber,
            zoneType: zone.zoneType || 'unknown',
            boundaries: [[zoneLat, zoneLng]],
            coverage: zone.coverage || '',
            description: zone.description || '',
            controllerId: controller.id,
            color: controller.color
          };
          
          if (!zonesByController[controller.id]) {
            zonesByController[controller.id] = [];
          }
          zonesByController[controller.id].push(coloredZone);
          allZones.push(coloredZone);
        }
      });
      
      setProject({
        controllers: coloredControllers,
        zonesByController,
        allZones
      });
      
      console.log("Site map loaded for editing:", siteMap.name);
      
    } catch (error) {
      console.error("Error loading site map for editing:", error);
      alert(`Failed to load site map: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  // Load all site maps when component mounts
  const loadAllSiteMaps = async () => {
    try {
      const response = await fetch('/api/site-maps', {
        headers: {
          'x-user-role': user?.role || ''
        }
      });
      
      if (response.ok) {
        const siteMaps = await response.json();
        setAllSiteMaps(siteMaps);
        
        // If Lake Isle exists and no customer is selected, auto-select it
        const lakeIsleSiteMap = siteMaps.find((sm: any) => sm.name.toLowerCase().includes('lake isle'));
        if (lakeIsleSiteMap && !selectedCustomer) {
          // Get customer info for Lake Isle
          const customerResponse = await fetch(`/api/customers/${lakeIsleSiteMap.customerId}`);
          if (customerResponse.ok) {
            const customer = await customerResponse.json();
            setSelectedCustomer(customer);
            setCustomerSiteMaps([lakeIsleSiteMap]);
            // Auto-load the Lake Isle map for viewing
            await loadSiteMapForEditing(lakeIsleSiteMap);
          }
        }
      }
    } catch (error) {
      console.error("Error loading all site maps:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Initialize on mount
  React.useEffect(() => {
    if (user && canView) {
      loadAllSiteMaps();
    } else {
      setIsLoading(false);
    }
  }, [user, canView]);

  // Handle customer selection and load their site maps
  const handleCustomerSelection = (customer: any) => {
    setSelectedCustomer(customer);
    setEditingSiteMap(null);
    setProject({
      controllers: [],
      zonesByController: {},
      allZones: []
    });
    
    if (customer) {
      loadCustomerSiteMaps(customer.id);
    } else {
      setCustomerSiteMaps([]);
    }
  };

  const handleSaveToDatabase = async () => {
    if (!selectedCustomer) {
      console.error("No customer selected");
      return;
    }
    
    if (project.controllers.length === 0) {
      console.error("No controllers to save");
      return;
    }
    
    try {
      const user = getCurrentUser();
      if (!user) {
        console.error("No user found");
        return;
      }

      // Calculate center coordinates from controllers
      const controllerCoords = project.controllers.map(c => [c.latitude, c.longitude]);
      const centerLat = controllerCoords.reduce((sum, coord) => sum + coord[0], 0) / controllerCoords.length;
      const centerLng = controllerCoords.reduce((sum, coord) => sum + coord[1], 0) / controllerCoords.length;
      
      let siteMapId: number;
      
      if (editingSiteMap) {
        // Update existing site map
        const siteMapData = {
          name: editingSiteMap.name,
          description: editingSiteMap.description,
          centerLat: centerLat.toString(),
          centerLng: centerLng.toString(),
          zoomLevel: 18,
          kmlData: JSON.stringify({
            controllers: project.controllers,
            zones: project.allZones,
            timestamp: new Date().toISOString()
          })
        };
        
        const response = await fetch(`/api/site-maps/${editingSiteMap.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'x-user-role': user.role
          },
          body: JSON.stringify(siteMapData)
        });
        
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.message || 'Failed to update site map');
        }
        
        siteMapId = editingSiteMap.id;
        console.log("Site map updated:", editingSiteMap.name);
      } else {
        // Create new site map
        const siteMapName = `${selectedCustomer.name} - Site Map ${new Date().toLocaleDateString()}`;
        
        const siteMapData = {
          name: siteMapName,
          description: `Irrigation site map for ${selectedCustomer.name}`,
          customerId: selectedCustomer.id,
          companyId: user.companyId || 1,
          centerLat: centerLat.toString(),
          centerLng: centerLng.toString(),
          zoomLevel: 18,
          kmlData: JSON.stringify({
            controllers: project.controllers,
            zones: project.allZones,
            timestamp: new Date().toISOString()
          })
        };
        
        const response = await fetch(`/api/customers/${selectedCustomer.id}/site-maps`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-role': user.role
          },
          body: JSON.stringify(siteMapData)
        });
        
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.message || 'Failed to create site map');
        }
        
        const newSiteMap = await response.json();
        siteMapId = newSiteMap.id;
        console.log("Site map created:", newSiteMap);
      }
      
      // Save controllers
      const controllerData = project.controllers.map(controller => ({
        name: controller.name,
        model: controller.model || '',
        serialNumber: controller.serialNumber || '',
        stationCount: controller.stationCount || 8,
        latitude: controller.latitude.toString(),
        longitude: controller.longitude.toString(),
        description: controller.description || '',
        companyId: user.companyId || 1,
        customerId: selectedCustomer.id
      }));
      
      const controllersResponse = await fetch(`/api/site-maps/${siteMapId}/controllers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-role': user.role
        },
        body: JSON.stringify({ controllers: controllerData })
      });
      
      if (!controllersResponse.ok) {
        throw new Error('Failed to save controllers');
      }
      
      // Save zones if any exist
      if (project.allZones.length > 0) {
        const zoneData = project.allZones.map(zone => ({
          name: zone.name,
          zoneNumber: zone.stationNumber || 0,
          zoneType: zone.zoneType || 'unknown',
          latitude: zone.boundaries?.[0]?.[0]?.toString() || '0',
          longitude: zone.boundaries?.[0]?.[1]?.toString() || '0',
          coverage: zone.coverage || '',
          description: zone.description || '',
          companyId: user.companyId || 1,
          customerId: selectedCustomer.id
        }));
        
        const zonesResponse = await fetch(`/api/site-maps/${siteMapId}/zones`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-role': user.role
          },
          body: JSON.stringify({ zones: zoneData })
        });
        
        if (!zonesResponse.ok) {
          throw new Error('Failed to save zones');
        }
      }
      
      alert(editingSiteMap ? "Site map updated successfully!" : "Site map saved successfully!");
      
      // Reload customer site maps
      if (selectedCustomer) {
        loadCustomerSiteMaps(selectedCustomer.id);
      }
      
    } catch (error) {
      console.error("Error saving site map:", error);
      alert(`Failed to save site map: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
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

  // Show loading state
  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading site maps...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* All Site Maps Overview */}
      {allSiteMaps.length > 0 && (
        <div className="mb-8">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapIcon className="w-5 h-5 text-blue-600" />
                Available Site Maps
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {allSiteMaps.map((siteMap) => (
                  <div
                    key={siteMap.id}
                    className={`p-4 border rounded-lg cursor-pointer transition-all duration-200 ${
                      editingSiteMap?.id === siteMap.id
                        ? 'border-blue-500 bg-blue-50 shadow-md'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                    onClick={async () => {
                      // Load customer for this site map
                      const customerResponse = await fetch(`/api/customers/${siteMap.customerId}`);
                      if (customerResponse.ok) {
                        const customer = await customerResponse.json();
                        setSelectedCustomer(customer);
                        await loadSiteMapForEditing(siteMap);
                      }
                    }}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h4 className="font-semibold text-gray-900 mb-1">{siteMap.name}</h4>
                        <p className="text-sm text-gray-600 mb-2">{siteMap.description}</p>
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <MapIcon className="w-3 h-3" />
                          <span>Customer ID: {siteMap.customerId}</span>
                        </div>
                      </div>
                      {editingSiteMap?.id === siteMap.id && (
                        <Badge className="bg-blue-100 text-blue-800 border-blue-300">
                          Active
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
      
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
                    onSelectCustomer={handleCustomerSelection}
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

            {/* Existing Site Maps Section */}
            {selectedCustomer && customerSiteMaps.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FolderOpen className="w-5 h-5 text-blue-600" />
                    Existing Site Maps for {selectedCustomer.name}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {customerSiteMaps.map((siteMap) => (
                      <div key={siteMap.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border">
                        <div>
                          <h4 className="font-semibold text-gray-900">{siteMap.name}</h4>
                          <p className="text-sm text-gray-600">{siteMap.description}</p>
                          <p className="text-xs text-gray-500">
                            Created: {new Date(siteMap.createdAt).toLocaleDateString()}
                            {siteMap.updatedAt !== siteMap.createdAt && (
                              <span> • Updated: {new Date(siteMap.updatedAt).toLocaleDateString()}</span>
                            )}
                          </p>
                        </div>
                        {canEdit && (
                          <button
                            onClick={() => loadSiteMapForEditing(siteMap)}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors duration-200 flex items-center gap-2"
                          >
                            <Edit className="w-4 h-4" />
                            Edit
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Save to Database Section */}
            {selectedCustomer && project.controllers.length > 0 && (
              <Card className="border-2 border-green-200 bg-green-50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-green-800">
                    <Save className="w-5 h-5" />
                    {editingSiteMap ? 'Update Site Map' : 'Save Site Map'}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {editingSiteMap && (
                      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <p className="text-sm text-blue-800">
                          <Edit className="w-4 h-4 inline mr-1" />
                          Editing: {editingSiteMap.name}
                        </p>
                      </div>
                    )}
                    <div className="flex items-center justify-between p-4 bg-white rounded-lg border border-green-200">
                      <div>
                        <h4 className="font-semibold text-gray-900">
                          {editingSiteMap ? 'Ready to Update' : 'Ready to Save'}
                        </h4>
                        <p className="text-sm text-gray-600">
                          Customer: {selectedCustomer.name} • 
                          Controllers: {project.controllers.length} • 
                          Zones: {project.allZones.length}
                        </p>
                      </div>
                      <button
                        onClick={handleSaveToDatabase}
                        className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg shadow-md transition-colors duration-200 flex items-center gap-2"
                      >
                        <Save className="w-5 h-5" />
                        {editingSiteMap ? 'Update Site Map' : 'Save to Database'}
                      </button>
                    </div>
                    <p className="text-xs text-green-700">
                      This will {editingSiteMap ? 'update the existing' : 'create a permanent'} site map record linked to {selectedCustomer.name} with all {editingSiteMap ? 'modified' : 'uploaded'} controllers and zones.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

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
                      <li>Use <strong>Point</strong> placemarks to mark irrigation zone locations</li>
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