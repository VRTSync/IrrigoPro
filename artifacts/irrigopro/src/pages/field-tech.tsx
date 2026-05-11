import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Clock, MapPin, Plus, Trash2, Wrench, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { PartsSearchModal } from "@/components/estimates/parts-search-modal";
import type { Part } from "@workspace/db/schema";

interface PropertyZone {
  id: string;
  propertyName: string;
  propertyAddress: string;
  zones: {
    id: string;
    name: string;
    description: string;
    clockNumber: string;
  }[];
}

interface FieldWorkItem {
  part: Part;
  quantity: number;
}

interface FieldWorkSession {
  id: string;
  propertyId: string;
  zoneId: string;
  clockNumber: string;
  workDescription: string;
  startTime: string;
  endTime?: string;
  items: FieldWorkItem[];
  status: "in-progress" | "completed";
}

export default function FieldTech() {
  const [selectedProperty, setSelectedProperty] = useState<string>("");
  const [selectedZone, setSelectedZone] = useState<string>("");
  const [currentSession, setCurrentSession] = useState<FieldWorkSession | null>(null);
  const [workDescription, setWorkDescription] = useState("");
  const [showPartsModal, setShowPartsModal] = useState(false);
  const [googleSheetsUrl, setGoogleSheetsUrl] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch property zones
  const { data: propertyZones = [], isLoading: loadingZones } = useQuery<PropertyZone[]>({
    queryKey: ["/api/property-zones"],
    enabled: true,
  });

  // Fetch parts for selection (without prices for field techs)
  const { data: parts = [] } = useQuery({
    queryKey: ["/api/parts/field-tech"],
    enabled: true,
  });

  // Sync Google Sheets
  const syncGoogleSheetsMutation = useMutation({
    mutationFn: async (sheetsUrl: string) => {
      const response = await apiRequest("POST", "/api/property-zones/sync-google-sheets", { sheetsUrl });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/property-zones"] });
      toast({
        title: "Success",
        description: "Property zones synced from Google Sheets",
      });
      setGoogleSheetsUrl("");
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to sync property zones",
        variant: "destructive",
      });
    },
  });

  // Start work session
  const startSessionMutation = useMutation({
    mutationFn: async (sessionData: Partial<FieldWorkSession>) => {
      const response = await apiRequest("POST", "/api/field-work-sessions", sessionData);
      return response.json();
    },
    onSuccess: (session) => {
      setCurrentSession(session);
      toast({
        title: "Work Session Started",
        description: "You can now add parts and track your work",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to start work session",
        variant: "destructive",
      });
    },
  });

  // Complete work session
  const completeSessionMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const response = await apiRequest("PATCH", `/api/field-work-sessions/${sessionId}/complete`, {
        endTime: new Date().toISOString(),
      });
      return response.json();
    },
    onSuccess: () => {
      setCurrentSession(null);
      setSelectedProperty("");
      setSelectedZone("");
      setWorkDescription("");
      toast({
        title: "Work Session Completed",
        description: "Your work has been recorded",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to complete work session",
        variant: "destructive",
      });
    },
  });

  const selectedPropertyData = propertyZones.find((p: PropertyZone) => p.id === selectedProperty);
  const selectedZoneData = selectedPropertyData?.zones.find((z: any) => z.id === selectedZone);

  const startWorkSession = () => {
    if (!selectedProperty || !selectedZone || !workDescription) {
      toast({
        title: "Missing Information",
        description: "Please select property, zone, and add work description",
        variant: "destructive",
      });
      return;
    }

    const sessionData = {
      propertyId: selectedProperty,
      zoneId: selectedZone,
      clockNumber: selectedZoneData?.clockNumber || "",
      workDescription,
      startTime: new Date().toISOString(),
      items: [],
      status: "in-progress" as const,
    };

    startSessionMutation.mutate(sessionData);
  };

  const addPartToSession = (part: Part, quantity: number = 1) => {
    if (!currentSession) return;

    const existingIndex = currentSession.items.findIndex(item => item.part.id === part.id);
    
    if (existingIndex >= 0) {
      const updatedItems = [...currentSession.items];
      updatedItems[existingIndex].quantity += quantity;
      setCurrentSession({ ...currentSession, items: updatedItems });
    } else {
      const newItem: FieldWorkItem = { part, quantity };
      setCurrentSession({ ...currentSession, items: [...currentSession.items, newItem] });
    }
  };

  const updatePartQuantity = (partId: number, quantity: number) => {
    if (!currentSession) return;

    const updatedItems = currentSession.items.map(item =>
      item.part.id === partId ? { ...item, quantity: Math.max(0, quantity) } : item
    ).filter(item => item.quantity > 0);

    setCurrentSession({ ...currentSession, items: updatedItems });
  };

  const removePartFromSession = (partId: number) => {
    if (!currentSession) return;

    const updatedItems = currentSession.items.filter(item => item.part.id !== partId);
    setCurrentSession({ ...currentSession, items: updatedItems });
  };

  const syncGoogleSheets = () => {
    if (!googleSheetsUrl) {
      toast({
        title: "Missing URL",
        description: "Please enter Google Sheets URL",
        variant: "destructive",
      });
      return;
    }

    syncGoogleSheetsMutation.mutate(googleSheetsUrl);
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900">Field Tech Area</h1>
        <Badge variant="outline" className="text-sm">
          <Wrench className="w-4 h-4 mr-2" />
          Field Operations
        </Badge>
      </div>

      {/* Google Sheets Sync */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="w-5 h-5" />
            Sync Property Zones
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder="Enter Google Sheets URL for property zones"
              value={googleSheetsUrl}
              onChange={(e) => setGoogleSheetsUrl(e.target.value)}
              className="flex-1"
            />
            <Button 
              onClick={syncGoogleSheets}
              disabled={syncGoogleSheetsMutation.isPending}
            >
              {syncGoogleSheetsMutation.isPending ? "Syncing..." : "Sync"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Work Session Setup */}
      {!currentSession && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5" />
              Start Work Session
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="property">Select Property</Label>
              <Select value={selectedProperty} onValueChange={setSelectedProperty}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose property" />
                </SelectTrigger>
                <SelectContent>
                  {propertyZones.map((property: PropertyZone) => (
                    <SelectItem key={property.id} value={property.id}>
                      {property.propertyName} - {property.propertyAddress}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedProperty && (
              <div>
                <Label htmlFor="zone">Select Zone</Label>
                <Select value={selectedZone} onValueChange={setSelectedZone}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose zone" />
                  </SelectTrigger>
                  <SelectContent>
                    {selectedPropertyData?.zones.map((zone: any) => (
                      <SelectItem key={zone.id} value={zone.id}>
                        Clock {zone.clockNumber} - {zone.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {selectedZone && (
              <div>
                <Label htmlFor="description">Work Description</Label>
                <Textarea
                  id="description"
                  placeholder="Describe the work to be performed..."
                  value={workDescription}
                  onChange={(e) => setWorkDescription(e.target.value)}
                  className="min-h-20"
                />
              </div>
            )}

            <Button 
              onClick={startWorkSession} 
              disabled={!selectedProperty || !selectedZone || !workDescription || startSessionMutation.isPending}
              className="w-full"
            >
              {startSessionMutation.isPending ? "Starting..." : "Start Work Session"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Active Work Session */}
      {currentSession && (
        <div className="space-y-4">
          {/* Session Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="w-5 h-5" />
                Active Work Session
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm font-medium">Property</Label>
                  <p className="text-sm text-gray-600">{selectedPropertyData?.propertyName}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium">Zone</Label>
                  <p className="text-sm text-gray-600">Clock {selectedZoneData?.clockNumber} - {selectedZoneData?.name}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium">Started</Label>
                  <p className="text-sm text-gray-600">{new Date(currentSession.startTime).toLocaleTimeString()}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium">Work Description</Label>
                  <p className="text-sm text-gray-600">{currentSession.workDescription}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Parts Used */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Parts Used</CardTitle>
                <Button onClick={() => setShowPartsModal(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Part
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {currentSession.items.length > 0 ? (
                <div className="space-y-3">
                  {currentSession.items.map((item) => (
                    <div key={item.part.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div className="flex-1">
                        <p className="font-medium">{item.part.name}</p>
                        <p className="text-sm text-gray-600">{item.part.description}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(e) => updatePartQuantity(item.part.id, parseInt(e.target.value) || 0)}
                          className="w-16 text-center"
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removePartFromSession(item.part.id)}
                          className="text-red-600 hover:text-red-700"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 text-center py-8">No parts added yet</p>
              )}
            </CardContent>
          </Card>

          {/* Complete Session */}
          <Card>
            <CardContent className="pt-6">
              <Button 
                onClick={() => completeSessionMutation.mutate(currentSession.id)}
                disabled={completeSessionMutation.isPending}
                className="w-full bg-green-600 hover:bg-green-700"
              >
                {completeSessionMutation.isPending ? "Completing..." : "Complete Work Session"}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Parts Search Modal */}
      <PartsSearchModal
        open={showPartsModal}
        onOpenChange={setShowPartsModal}
        onSelectPart={addPartToSession}
      />
    </div>
  );
}