import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Clock, MapPin, Plus, Trash2, Wrench, LogOut, Play, Square, CheckCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import companyLogo from "@assets/LOGO - SPREAD-05_1752764989944.png";

interface User {
  id: string;
  name: string;
  role: "admin" | "field_tech";
  isActive: boolean;
}

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

interface WorkSession {
  id: string;
  propertyId: string;
  zoneId: string;
  workDescription: string;
  startTime: string;
  endTime?: string;
  status: "in-progress" | "completed";
  items: { partName: string; quantity: number }[];
}

export default function FieldPortal() {
  const [user, setUser] = useState<User | null>(null);
  const [selectedProperty, setSelectedProperty] = useState<string>("");
  const [selectedZone, setSelectedZone] = useState<string>("");
  const [workDescription, setWorkDescription] = useState("");
  const [activeSession, setActiveSession] = useState<WorkSession | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Check authentication and redirect if not field tech
  useEffect(() => {
    const savedUser = localStorage.getItem("user");
    if (savedUser) {
      const userData = JSON.parse(savedUser);
      if (userData.role === "field_tech") {
        setUser(userData);
      } else {
        window.location.href = "/login";
      }
    } else {
      window.location.href = "/login";
    }
  }, []);

  // Fetch property zones
  const { data: propertyZones } = useQuery<PropertyZone[]>({
    queryKey: ["/api/property-zones"],
    enabled: !!user,
  });

  // Fetch active work sessions
  const { data: workSessions } = useQuery<WorkSession[]>({
    queryKey: ["/api/field-work-sessions"],
    enabled: !!user,
  });

  // Start work session
  const startSession = useMutation({
    mutationFn: async (sessionData: { propertyId: string; zoneId: string; workDescription: string }) => {
      return apiRequest("/api/field-work-sessions", {
        method: "POST",
        body: {
          ...sessionData,
          technicianId: user?.id,
          technicianName: user?.name,
          startTime: new Date().toISOString(),
          status: "in-progress",
        },
      });
    },
    onSuccess: (data) => {
      setActiveSession(data);
      toast({
        title: "Work Session Started",
        description: "You have clocked in for this zone.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/field-work-sessions"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to start work session",
        variant: "destructive",
      });
    },
  });

  // Complete work session
  const completeSession = useMutation({
    mutationFn: async (sessionId: string) => {
      return apiRequest(`/api/field-work-sessions/${sessionId}/complete`, {
        method: "POST",
      });
    },
    onSuccess: () => {
      setActiveSession(null);
      toast({
        title: "Work Session Completed",
        description: "You have successfully clocked out.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/field-work-sessions"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to complete work session",
        variant: "destructive",
      });
    },
  });

  const handleLogout = () => {
    localStorage.removeItem("user");
    window.location.href = "/login";
  };

  const handleStartWork = () => {
    if (!selectedProperty || !selectedZone || !workDescription) {
      toast({
        title: "Missing Information",
        description: "Please select a property, zone, and enter work description.",
        variant: "destructive",
      });
      return;
    }

    startSession.mutate({
      propertyId: selectedProperty,
      zoneId: selectedZone,
      workDescription,
    });
  };

  const selectedPropertyData = propertyZones?.find((p) => p.id === selectedProperty);

  if (!user) {
    return null; // Will redirect to login
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <img 
                src={companyLogo} 
                alt="Company Logo" 
                className="h-8 w-auto mr-4"
              />
              <Badge variant="outline" className="mr-4">
                <Wrench className="w-4 h-4 mr-2" />
                Field Tech Portal
              </Badge>
              <h1 className="text-2xl font-bold text-gray-900">Welcome, {user.name}</h1>
            </div>
            <Button variant="outline" onClick={handleLogout}>
              <LogOut className="w-4 h-4 mr-2" />
              Logout
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Active Session Status */}
        {activeSession ? (
          <Card className="mb-6 bg-green-50 border-green-200">
            <CardHeader>
              <CardTitle className="text-green-800 flex items-center">
                <Play className="w-5 h-5 mr-2" />
                Active Work Session
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="text-sm text-green-700">
                  <strong>Property:</strong> {selectedPropertyData?.propertyName}
                </div>
                <div className="text-sm text-green-700">
                  <strong>Zone:</strong> {selectedPropertyData?.zones.find(z => z.id === activeSession.zoneId)?.name}
                </div>
                <div className="text-sm text-green-700">
                  <strong>Started:</strong> {new Date(activeSession.startTime).toLocaleString()}
                </div>
                <div className="text-sm text-green-700">
                  <strong>Description:</strong> {activeSession.workDescription}
                </div>
                <Button 
                  onClick={() => completeSession.mutate(activeSession.id)}
                  disabled={completeSession.isPending}
                  className="mt-4"
                >
                  <Square className="w-4 h-4 mr-2" />
                  Complete Work Session
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          /* Start New Session */
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center">
                <Clock className="w-5 h-5 mr-2" />
                Start New Work Session
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Select Property</Label>
                <Select value={selectedProperty} onValueChange={setSelectedProperty}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a property" />
                  </SelectTrigger>
                  <SelectContent>
                    {propertyZones?.map((property) => (
                      <SelectItem key={property.id} value={property.id}>
                        {property.propertyName} - {property.propertyAddress}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedProperty && (
                <div className="space-y-2">
                  <Label>Select Zone</Label>
                  <Select value={selectedZone} onValueChange={setSelectedZone}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a zone" />
                    </SelectTrigger>
                    <SelectContent>
                      {selectedPropertyData?.zones.map((zone) => (
                        <SelectItem key={zone.id} value={zone.id}>
                          {zone.name} - Clock #{zone.clockNumber}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-2">
                <Label>Work Description</Label>
                <Textarea
                  placeholder="Describe the work to be performed..."
                  value={workDescription}
                  onChange={(e) => setWorkDescription(e.target.value)}
                  rows={3}
                />
              </div>

              <Button 
                onClick={handleStartWork}
                disabled={!selectedProperty || !selectedZone || !workDescription || startSession.isPending}
                className="w-full"
              >
                <Play className="w-4 h-4 mr-2" />
                Start Work Session
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Recent Work Sessions */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Work Sessions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {workSessions?.slice(0, 10).map((session) => (
                <div key={session.id} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <MapPin className="w-4 h-4 mr-2 text-gray-500" />
                      <div>
                        <div className="font-medium">{session.workDescription}</div>
                        <div className="text-sm text-gray-500">
                          {new Date(session.startTime).toLocaleDateString()} - 
                          {session.endTime ? new Date(session.endTime).toLocaleDateString() : "In Progress"}
                        </div>
                      </div>
                    </div>
                    <Badge variant={session.status === "completed" ? "default" : "secondary"}>
                      {session.status === "completed" ? (
                        <CheckCircle className="w-4 h-4 mr-1" />
                      ) : (
                        <Clock className="w-4 h-4 mr-1" />
                      )}
                      {session.status}
                    </Badge>
                  </div>
                </div>
              ))}
              {(!workSessions || workSessions.length === 0) && (
                <div className="text-center py-8 text-gray-500">
                  No work sessions found. Start your first session above!
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}