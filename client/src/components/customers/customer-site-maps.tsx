import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ArrowLeft, MapPin, Upload, Eye, Edit, Trash2, Plus } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Customer, SiteMap, Controller, IrrigationZone } from "@shared/schema";
import { ColorCodedMapViewer } from "@/components/site-maps/color-coded-map-viewer";
import { ControllerUpload } from "@/components/site-maps/controller-upload";
import { ZoneUpload } from "@/components/site-maps/zone-upload";
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

// Helper function to parse PostgreSQL array boundaries format
function parseBoundariesFromDB(boundariesStr: string | any[]): [number, number][] {
  try {
    // If it's already an array, return it
    if (Array.isArray(boundariesStr)) {
      return boundariesStr;
    }
    
    if (!boundariesStr || typeof boundariesStr !== 'string') return [];
    
    // Remove outer braces and split by comma
    const cleaned = boundariesStr.replace(/^{|}$/g, '');
    
    // Handle nested array format like {{"lat","lng"}}
    if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
      const innerCleaned = cleaned.replace(/^{|}$/g, '');
      const parts = innerCleaned.split(',').map(part => part.replace(/"/g, '').trim());
      if (parts.length >= 2) {
        const lat = parseFloat(parts[0]);
        const lng = parseFloat(parts[1]);
        if (!isNaN(lat) && !isNaN(lng)) {
          return [[lat, lng]];
        }
      }
    }
    
    return [];
  } catch (error) {
    console.warn('Failed to parse boundaries:', boundariesStr, error);
    return [];
  }
}

export function CustomerSiteMaps({ customer, onBack, userRole }: CustomerSiteMapsProps) {
  const [activeTab, setActiveTab] = useState("maps");
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [uploadingControllersFor, setUploadingControllersFor] = useState<number | null>(null);
  const [uploadingZonesFor, setUploadingZonesFor] = useState<number | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newSiteMapName, setNewSiteMapName] = useState("");
  const [newSiteMapDescription, setNewSiteMapDescription] = useState("");

  const isAdmin = userRole === "company_admin" || userRole === "super_admin";
  const canEdit = isAdmin;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch customer site maps
  const { data: siteMaps, isLoading } = useQuery<SiteMap[]>({
    queryKey: [`/api/customers/${customer.id}/site-maps`],
  });

  // Auto-select site map when coming from Maps page or if there's only one
  useEffect(() => {
    if (!siteMaps || siteMaps.length === 0) return;
    
    const selectedSiteMapId = localStorage.getItem('selectedSiteMapId');
    let siteMapToSelect: SiteMap | null = null;
    
    if (selectedSiteMapId) {
      // Find specific site map from Maps page
      siteMapToSelect = siteMaps.find(sm => sm.id.toString() === selectedSiteMapId) || null;
      localStorage.removeItem('selectedSiteMapId');
    } else if (siteMaps.length === 1) {
      // Auto-select if there's only one site map
      siteMapToSelect = siteMaps[0];
    }
    
    if (siteMapToSelect) {
      // Convert to Project format and select it
      const projectFromSiteMap: Project = {
        id: siteMapToSelect.id,
        name: siteMapToSelect.name,
        controllers: [],
        zones: [],
        zonesByController: {}
      };
      setSelectedProject(projectFromSiteMap);
      setActiveTab("viewer");
    }
  }, [siteMaps]);

  // Fetch controllers and zones for selected project
  const { data: controllers } = useQuery<Controller[]>({
    queryKey: [`/api/site-maps/${selectedProject?.id}/controllers`],
    enabled: !!selectedProject,
  });

  const { data: zones } = useQuery<IrrigationZone[]>({
    queryKey: [`/api/site-maps/${selectedProject?.id}/zones`],
    enabled: !!selectedProject,
  });

  // Transform data for map viewer - show map even if only controllers are available
  const project: Project | null = selectedProject && controllers ? {
    id: selectedProject.id,
    name: selectedProject.name,
    controllers: controllers || [],
    zones: (zones || []),
    zonesByController: (zones || []).reduce((acc, zone) => {
      // Use controller ID for proper grouping
      const controllerId = zone.controllerId?.toString() || 'unassigned';
      if (!acc[controllerId]) {
        acc[controllerId] = [];
      }
      acc[controllerId].push(zone);
      return acc;
    }, {} as Record<string, IrrigationZone[]>)
  } : null;

  // Debug logging
  console.log('CustomerSiteMaps Debug:', {
    selectedProject,
    controllers: controllers?.length || 0,
    zones: zones?.length || 0,
    project: project ? `${project.name} with ${project.controllers.length} controllers and ${project.zones.length} zones` : 'null'
  });

  const handleControllerKMLParsed = async (data: any) => {
    console.log("Controller KML parsed:", data);
    
    if (!selectedProject?.id) {
      toast({
        title: "Error",
        description: "No site map selected",
        variant: "destructive",
      });
      return;
    }

    try {
      // Save controllers to database
      const response = await fetch(`/api/site-maps/${selectedProject.id}/controllers`, {
        method: "POST",
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ controllers: data.controllers }),
      });

      if (!response.ok) {
        throw new Error(`Failed to save controllers: ${response.statusText}`);
      }

      // Refetch controllers data after upload
      queryClient.invalidateQueries({ queryKey: [`/api/site-maps/${selectedProject.id}/controllers`] });
      
      toast({
        title: "Success",
        description: `Saved ${data.controllers.length} controllers to database`,
      });
    } catch (error) {
      console.error("Error saving controllers:", error);
      toast({
        title: "Error",
        description: "Failed to save controllers to database",
        variant: "destructive",
      });
    }
    
    setUploadingControllersFor(null);
  };

  const handleZoneKMLParsed = async (data: any, controllerId: string) => {
    console.log("Zone KML parsed:", data, "for controller:", controllerId);
    
    if (!selectedProject?.id) {
      toast({
        title: "Error",
        description: "No site map selected",
        variant: "destructive",
      });
      return;
    }

    try {
      // Split zones into irrigation zones (with station numbers) and utility markers
      const irrigationZones = data.zones.filter((zone: any) => 
        zone.stationNumber && zone.stationNumber > 0
      );
      
      const utilityMarkers = data.zones.filter((zone: any) => 
        !zone.stationNumber || zone.stationNumber <= 0
      );

      // Save irrigation zones to database
      const validZones = irrigationZones;

      if (validZones.length === 0) {
        toast({
          title: "No Valid Zones Found",
          description: "The KML file contains no valid irrigation zones with station numbers",
          variant: "destructive",
        });
        setUploadingZonesFor(null);
        return;
      }

      // Add controller ID to each valid zone
      const zonesWithController = validZones.map((zone: any) => ({
        ...zone,
        controllerId: parseInt(controllerId)
      }));

      // Save zones to database
      const response = await fetch(`/api/site-maps/${selectedProject.id}/zones`, {
        method: "POST",
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ zones: zonesWithController }),
      });

      if (!response.ok) {
        throw new Error(`Failed to save zones: ${response.statusText}`);
      }

      // Refetch zones data after upload
      queryClient.invalidateQueries({ queryKey: [`/api/site-maps/${selectedProject.id}/zones`] });
      queryClient.invalidateQueries({ queryKey: [`/api/site-maps/${selectedProject.id}/controllers`] });
      
      const controllerName = project?.controllers.find(c => c.id === parseInt(controllerId))?.name || 'Controller';
      const totalFound = data.zones.length;
      const validSaved = zonesWithController.length;
      const utilityCount = utilityMarkers.length;
      
      toast({
        title: "Success",
        description: `Saved ${validSaved} irrigation zones to ${controllerName}${utilityCount > 0 ? ` (${utilityCount} utility markers will show on map)` : ''}`,
      });
    } catch (error) {
      console.error("Error saving zones:", error);
      toast({
        title: "Error",
        description: "Failed to save zones to database",
        variant: "destructive",
      });
    }
    
    setUploadingZonesFor(null);
  };

  const handleControllerFileSelected = (file: File) => {
    console.log("Controller file selected:", file.name);
  };

  const handleZoneFileSelected = (file: File) => {
    console.log("Zone file selected:", file.name);
  };

  const startControllerUpload = (projectId: number) => {
    setUploadingControllersFor(projectId);
  };

  const startZoneUpload = (projectId: number) => {
    setUploadingZonesFor(projectId);
  };

  // Create site map mutation
  const createSiteMapMutation = useMutation({
    mutationFn: async (data: { name: string; description: string }) => {
      const response = await fetch(`/api/customers/${customer.id}/site-maps`, {
        method: "POST",
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });
      
      if (!response.ok) {
        throw new Error(`Failed to create site map: ${response.statusText}`);
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/customers/${customer.id}/site-maps`] });
      setCreateDialogOpen(false);
      setNewSiteMapName("");
      setNewSiteMapDescription("");
      toast({
        title: "Success",
        description: "Site map created successfully",
      });
    },
    onError: (error: any) => {
      console.error("Site map creation error:", error);
      const errorMessage = error?.message || "Failed to create site map";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const handleCreateSiteMap = () => {
    if (!newSiteMapName.trim()) {
      toast({
        title: "Error",
        description: "Please enter a site map name",
        variant: "destructive",
      });
      return;
    }
    
    createSiteMapMutation.mutate({
      name: newSiteMapName.trim(),
      description: newSiteMapDescription.trim(),
    });
  };

  // Delete site map mutation
  const deleteSiteMapMutation = useMutation({
    mutationFn: async (siteMapId: number) => {
      const response = await fetch(`/api/site-maps/${siteMapId}`, {
        method: "DELETE",
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        throw new Error(`Failed to delete site map: ${response.statusText}`);
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/customers/${customer.id}/site-maps`] });
      toast({
        title: "Success",
        description: "Site map deleted successfully",
      });
    },
    onError: (error: any) => {
      console.error("Site map deletion error:", error);
      const errorMessage = error?.message || "Failed to delete site map";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const handleDeleteSiteMap = (siteMapId: number, siteMapName: string) => {
    if (confirm(`Are you sure you want to delete "${siteMapName}"? This action cannot be undone.`)) {
      deleteSiteMapMutation.mutate(siteMapId);
    }
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
                      onFileSelected={handleControllerFileSelected}
                    />

                    <ZoneUpload
                      controllers={project?.controllers?.map(c => ({
                        ...c,
                        id: c.id.toString(),
                        color: `hsl(${(c.id * 137.5) % 360}, 70%, 50%)`
                      })) || []}
                      onZoneKMLParsed={handleZoneKMLParsed}
                      uploadingFor={uploadingZonesFor?.toString() || null}
                      onStartUpload={(controllerId) => setUploadingZonesFor(parseInt(controllerId))}
                      zonesByController={Object.fromEntries(
                        Object.entries(project?.zonesByController || {}).map(([controllerId, zones]) => [
                          controllerId,
                          zones.length
                        ])
                      )}
                    />
                  </CardContent>
                </Card>
              </TabsContent>
            )}

            <TabsContent value="maps" className="space-y-6 mt-6">
              <ColorCodedMapViewer 
                project={{
                  controllers: (project?.controllers || []).map(c => ({
                    id: c.id.toString(),
                    name: c.name || 'Unknown Controller',
                    latitude: typeof c.latitude === 'string' ? parseFloat(c.latitude) : (c.latitude || 0),
                    longitude: typeof c.longitude === 'string' ? parseFloat(c.longitude) : (c.longitude || 0),
                    color: `hsl(${(c.id * 137.5) % 360}, 70%, 50%)`,
                    model: c.model || undefined,
                    serialNumber: c.serialNumber || undefined,
                    stationCount: c.stationCount || undefined,
                    description: c.notes || undefined
                  })),
                  zonesByController: Object.fromEntries(
                    Object.entries(project?.zonesByController || {}).map(([controllerId, zones]) => [
                      controllerId,
                      zones.map(zone => ({
                        name: zone.name || 'Unknown Zone',
                        controllerId: controllerId,
                        color: `hsl(${(parseInt(controllerId) * 137.5) % 360}, 70%, 50%)`,
                        boundaries: zone.boundaries ? parseBoundariesFromDB(zone.boundaries) : undefined,
                        stationNumber: zone.stationNumber || undefined,
                        zoneType: zone.zoneType || undefined,
                        coverage: zone.coverage || undefined,
                        description: zone.notes || undefined
                      }))
                    ])
                  ),
                  allZones: (project?.zones || []).map(zone => ({
                    name: zone.name || 'Unknown Zone',
                    controllerId: zone.controllerId?.toString() || 'unassigned',
                    color: `hsl(${((zone.controllerId || 0) * 137.5) % 360}, 70%, 50%)`,
                    boundaries: zone.boundaries ? parseBoundariesFromDB(zone.boundaries) : undefined,
                    stationNumber: zone.stationNumber || undefined,
                    zoneType: zone.zoneType || undefined,
                    coverage: zone.coverage || undefined,
                    description: zone.notes || undefined
                  }))
                }}
                showEditControls={canEdit}
              />
            </TabsContent>

            <TabsContent value="data" className="space-y-6 mt-6">
              <ZonesDataView 
                controllers={(project?.controllers || []).map(controller => {
                  const transformedController = {
                    ...controller,
                    // Ensure coordinates are numbers
                    latitude: typeof controller.latitude === 'string' ? parseFloat(controller.latitude) : (controller.latitude || 0),
                    longitude: typeof controller.longitude === 'string' ? parseFloat(controller.longitude) : (controller.longitude || 0),
                    zones: (project?.zonesByController[controller.id.toString()] || []).map(zone => ({
                      ...zone,
                      boundaries: zone.boundaries 
                        ? parseBoundariesFromDB(zone.boundaries)
                        : []
                    }))
                  };
                  console.log('Transformed controller for ZonesDataView:', transformedController);
                  return transformedController;
                })}
                onControllerClick={(controller) => console.log('Controller clicked:', controller)}
                onZoneClick={(zone) => console.log('Zone clicked:', zone)}
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
                  <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm">
                        <Plus className="w-4 h-4 mr-2" />
                        Create New Site Map
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[425px]" aria-describedby="create-site-map-header-desc">
                      <DialogHeader>
                        <DialogTitle>Create New Site Map</DialogTitle>
                      </DialogHeader>
                      <p id="create-site-map-header-desc" className="sr-only">Create a new site map for this customer's property</p>
                      <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                          <Label htmlFor="name">Site Map Name</Label>
                          <Input
                            id="name"
                            placeholder="Enter site map name"
                            value={newSiteMapName}
                            onChange={(e) => setNewSiteMapName(e.target.value)}
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="description">Description (Optional)</Label>
                          <Textarea
                            id="description"
                            placeholder="Enter description"
                            value={newSiteMapDescription}
                            onChange={(e) => setNewSiteMapDescription(e.target.value)}
                          />
                        </div>
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          onClick={() => setCreateDialogOpen(false)}
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={handleCreateSiteMap}
                          disabled={createSiteMapMutation.isPending}
                        >
                          {createSiteMapMutation.isPending ? "Creating..." : "Create Site Map"}
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
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
                          onClick={() => {
                            // Set the selected project to trigger data loading
                            setSelectedProject({
                              id: siteMap.id,
                              name: siteMap.name,
                              controllers: [],
                              zones: [],
                              zonesByController: {}
                            });
                            // Switch to map view tab immediately
                            setActiveTab("maps");
                          }}
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
                            <Button 
                              variant="outline" 
                              size="sm" 
                              className="text-red-600 hover:text-red-700"
                              onClick={() => handleDeleteSiteMap(siteMap.id, siteMap.name)}
                              disabled={deleteSiteMapMutation.isPending}
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              {deleteSiteMapMutation.isPending ? "Deleting..." : "Delete"}
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
                  <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
                    <DialogTrigger asChild>
                      <Button>
                        <Plus className="w-4 h-4 mr-2" />
                        Create First Site Map
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[425px]" aria-describedby="create-site-map-empty-desc">
                      <DialogHeader>
                        <DialogTitle>Create New Site Map</DialogTitle>
                      </DialogHeader>
                      <p id="create-site-map-empty-desc" className="sr-only">Create a new site map for this customer's property</p>
                      <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                          <Label htmlFor="name-empty">Site Map Name</Label>
                          <Input
                            id="name-empty"
                            placeholder="Enter site map name"
                            value={newSiteMapName}
                            onChange={(e) => setNewSiteMapName(e.target.value)}
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="description-empty">Description (Optional)</Label>
                          <Textarea
                            id="description-empty"
                            placeholder="Enter description"
                            value={newSiteMapDescription}
                            onChange={(e) => setNewSiteMapDescription(e.target.value)}
                          />
                        </div>
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          onClick={() => setCreateDialogOpen(false)}
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={handleCreateSiteMap}
                          disabled={createSiteMapMutation.isPending}
                        >
                          {createSiteMapMutation.isPending ? "Creating..." : "Create Site Map"}
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}