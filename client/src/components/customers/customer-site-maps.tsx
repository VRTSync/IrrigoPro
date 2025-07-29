import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, MapPin, Upload, Eye, Edit, Trash2, Plus } from "lucide-react";
import type { Customer, SiteMap, Controller, IrrigationZone } from "@shared/schema";
import { ColorCodedMapViewer } from "@/components/site-maps/color-coded-map-viewer";
import { ControllerUpload } from "@/components/site-maps/controller-upload";
import { ZonesDataView } from "@/components/site-maps/zones-data-view";

interface CustomerSiteMapsProps {
  customer: Customer;
  onBack: () => void;
  userRole: string;
}

interface Project {
  id: number;
  name: string;
  controllers: Controller[];
  zones: IrrigationZone[];
  zonesByController: Record<string, IrrigationZone[]>;
}

export function CustomerSiteMaps({ customer, onBack, userRole }: CustomerSiteMapsProps) {
  const [activeTab, setActiveTab] = useState("maps");
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [uploadingControllersFor, setUploadingControllersFor] = useState<number | null>(null);
  const [uploadingZonesFor, setUploadingZonesFor] = useState<number | null>(null);

  const isAdmin = userRole === "company_admin" || userRole === "super_admin";
  const canEdit = isAdmin;

  // Fetch customer site maps
  const { data: siteMaps, isLoading } = useQuery<SiteMap[]>({
    queryKey: [`/api/customers/${customer.id}/site-maps`],
  });

  // Fetch controllers and zones for selected project
  const { data: controllers } = useQuery<Controller[]>({
    queryKey: [`/api/site-maps/${selectedProject?.id}/controllers`],
    enabled: !!selectedProject,
  });

  const { data: zones } = useQuery<IrrigationZone[]>({
    queryKey: [`/api/site-maps/${selectedProject?.id}/zones`],
    enabled: !!selectedProject,
  });

  // Transform data for map viewer
  const project: Project | null = selectedProject && controllers && zones ? {
    id: selectedProject.id,
    name: selectedProject.name,
    controllers: controllers || [],
    zones: zones || [],
    zonesByController: (zones || []).reduce((acc, zone) => {
      // Use zone name or description to determine controller
      const controllerName = zone.name?.includes('Controller') ? 
        zone.name.split(' - ')[0] : 'Unknown Controller';
      if (!acc[controllerName]) {
        acc[controllerName] = [];
      }
      acc[controllerName].push(zone);
      return acc;
    }, {} as Record<string, IrrigationZone[]>)
  } : null;

  const handleControllerKMLParsed = async (controllers: Controller[]) => {
    setUploadingControllersFor(null);
    // Refetch data after upload
    // This would typically trigger a refetch of the site maps
  };

  const handleZoneKMLParsed = async (zones: IrrigationZone[]) => {
    setUploadingZonesFor(null);
    // Refetch data after upload
  };

  const startControllerUpload = (projectId: number) => {
    setUploadingControllersFor(projectId);
  };

  const startZoneUpload = (projectId: number) => {
    setUploadingZonesFor(projectId);
  };

  if (selectedProject && project) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* Header */}
          <div className="mb-6">
            <Button
              variant="outline"
              onClick={() => setSelectedProject(null)}
              className="mb-4"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Site Maps
            </Button>
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold text-gray-900">{project.name}</h1>
                <p className="text-gray-600 mt-1">
                  Site map for {customer.name}
                </p>
              </div>
              {!canEdit && (
                <Badge variant="secondary" className="bg-blue-100 text-blue-800">
                  View Only
                </Badge>
              )}
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              {canEdit && (
                <TabsTrigger value="upload">Upload KML</TabsTrigger>
              )}
              <TabsTrigger value="maps">Map View</TabsTrigger>
              <TabsTrigger value="data">Data Review</TabsTrigger>
            </TabsList>

            {canEdit && (
              <TabsContent value="upload" className="space-y-6 mt-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Upload className="w-5 h-5" />
                      Upload KML Files
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <ControllerUpload
                      onKMLParsed={handleControllerKMLParsed}
                      uploadingFor={uploadingControllersFor}
                      onStartUpload={startControllerUpload}
                    />

                    <ControllerUpload
                      onKMLParsed={handleZoneKMLParsed}
                      uploadingFor={uploadingZonesFor}
                      onStartUpload={startZoneUpload}
                      zonesByController={project.zonesByController}
                    />
                  </CardContent>
                </Card>
              </TabsContent>
            )}

            <TabsContent value="maps" className="space-y-6 mt-6">
              <ColorCodedMapViewer 
                project={{
                  ...project,
                  allZones: project.zones
                }}
                showEditControls={canEdit}
              />
            </TabsContent>

            <TabsContent value="data" className="space-y-6 mt-6">
              <ZonesDataView 
                controllers={project.controllers}
                zones={project.zones}
                zonesByController={project.zonesByController}
                showEditControls={canEdit}
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Header */}
        <div className="mb-6">
          <Button
            variant="outline"
            onClick={onBack}
            className="mb-4"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Customers
          </Button>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Site Maps</h1>
              <p className="text-gray-600 mt-1">
                {customer.name} - Property site maps and irrigation systems
              </p>
            </div>
            {!canEdit && (
              <Badge variant="secondary" className="bg-blue-100 text-blue-800">
                View Only
              </Badge>
            )}
          </div>
        </div>

        {/* Site Maps List */}
        <div className="space-y-4">
          {canEdit && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Manage Site Maps</span>
                  <Button size="sm">
                    <Plus className="w-4 h-4 mr-2" />
                    Create New Site Map
                  </Button>
                </CardTitle>
              </CardHeader>
            </Card>
          )}

          {isLoading ? (
            <Card>
              <CardContent className="p-6">
                <div className="text-center text-gray-500">Loading site maps...</div>
              </CardContent>
            </Card>
          ) : siteMaps && siteMaps.length > 0 ? (
            <div className="grid gap-4">
              {siteMaps.map((siteMap) => (
                <Card key={siteMap.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4">
                        <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                          <MapPin className="w-6 h-6 text-blue-600" />
                        </div>
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900">
                            {siteMap.name}
                          </h3>
                          <p className="text-gray-600 text-sm">
                            {siteMap.description || "No description"}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedProject({
                            id: siteMap.id,
                            name: siteMap.name,
                            controllers: [],
                            zones: [],
                            zonesByController: {}
                          })}
                        >
                          <Eye className="w-4 h-4 mr-2" />
                          View Map
                        </Button>
                        {canEdit && (
                          <>
                            <Button variant="outline" size="sm">
                              <Edit className="w-4 h-4 mr-2" />
                              Edit
                            </Button>
                            <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700">
                              <Trash2 className="w-4 h-4 mr-2" />
                              Delete
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="p-12 text-center">
                <MapPin className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  No Site Maps Available
                </h3>
                <p className="text-gray-600 mb-6">
                  {canEdit 
                    ? "Create a new site map to get started with this customer's property mapping."
                    : "No site maps have been created for this customer yet."
                  }
                </p>
                {canEdit && (
                  <Button>
                    <Plus className="w-4 h-4 mr-2" />
                    Create First Site Map
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}