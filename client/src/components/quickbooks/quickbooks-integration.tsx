import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  ExternalLink, 
  CheckCircle, 
  Clock, 
  AlertTriangle, 
  RefreshCw,
  Building,
  Calendar,
  DollarSign
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { format } from "date-fns";

interface QuickBooksConnectionProps {
  className?: string;
}

export function QuickBooksIntegration({ className }: QuickBooksConnectionProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  // Force console logging on every render
  console.log("🔵 QUICKBOOKS COMPONENT RENDER - isConnecting:", isConnecting);
  console.log("🔵 Component mounted in customer billing page");
  
  // Component loaded successfully
  React.useEffect(() => {
    console.log("🔵 QuickBooks component useEffect fired");
    console.log("🔵 QuickBooks Integration component loaded successfully!");
  }, []);
  
  // Component mount logging
  useEffect(() => {
    console.log("🔵 QuickBooks Integration component mounted");
    console.log("🔵 Component props:", { className });
    console.log("🔵 isConnecting state:", isConnecting);
    
    // Test basic functionality with XHR
    console.log("🔵 Testing basic XHR...");
    const testXhr = new XMLHttpRequest();
    testXhr.open('GET', '/api/quickbooks/auth');
    testXhr.onload = () => console.log("🟢 Basic XHR test success:", testXhr.status, testXhr.responseText);
    testXhr.onerror = (err) => console.error("🔴 Basic XHR test failed:", err);
    testXhr.send();
    
    // Check if the component is actually rendering
    console.log("🔵 Checking if button exists in DOM...");
    setTimeout(() => {
      const button = document.querySelector('[data-testid="quickbooks-connect-btn"]');
      console.log("🔵 QuickBooks button found:", !!button);
      if (button) {
        console.log("🔵 Button element:", button);
        console.log("🔵 Button disabled:", button.disabled);
      }
    }, 1000);
  }, [className]);

  // Fetch QuickBooks connection status
  const { data: connectionStatus, isLoading: loadingConnection, error: connectionError } = useQuery<{
    companyId: string | null;
    companyName: string | null;
    isConnected: boolean;
    lastSync: string | null;
    error?: string;
  }>({
    queryKey: ["/api/quickbooks/connection"],
    enabled: true,
    retry: false,
    throwOnError: false
  });

  // Fetch estimates for sync status
  const { data: estimates = [], error: estimatesError } = useQuery<any[]>({
    queryKey: ["/api/estimates"],
    enabled: true,
    retry: false,
    throwOnError: false
  });

  // Simple and direct QuickBooks connection handler
  const handleQuickBooksConnect = () => {
    console.log("🔵 ==========================================================");
    console.log("🔵 BUTTON CLICKED - QuickBooks connection started");
    console.log("🔵 Current isConnecting state:", isConnecting);
    console.log("🔵 ==========================================================");
    
    // Prevent double clicks
    if (isConnecting) {
      console.log("🔵 Already connecting, ignoring click");
      return;
    }
    
    setIsConnecting(true);
    
    console.log("🔵 Creating XHR request...");
    const xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/quickbooks/auth');
    
    xhr.onreadystatechange = function() {
      console.log("🔵 XHR State changed:", xhr.readyState, xhr.status);
      
      if (xhr.readyState === 4) {
        if (xhr.status === 200) {
          try {
            const data = JSON.parse(xhr.responseText);
            console.log("🟢 Success! Auth data:", data);
            
            if (data?.authUrl) {
              console.log("🟢 Redirecting to:", data.authUrl);
              // Direct redirect without delay
              window.location.href = data.authUrl;
            } else {
              throw new Error("No authUrl in response");
            }
          } catch (error) {
            console.error("🔴 Parse error:", error);
            setIsConnecting(false);
            toast({
              title: "Error",
              description: "Failed to parse server response",
              variant: "destructive"
            });
          }
        } else {
          console.error("🔴 HTTP error:", xhr.status, xhr.responseText);
          setIsConnecting(false);
          toast({
            title: "Connection Failed", 
            description: `HTTP ${xhr.status}: ${xhr.statusText}`,
            variant: "destructive"
          });
        }
      }
    };
    
    xhr.onerror = function() {
      console.error("🔴 Network error occurred");
      setIsConnecting(false);
      toast({
        title: "Network Error",
        description: "Could not connect to server",
        variant: "destructive"
      });
    };
    
    console.log("🔵 Sending XHR request...");
    xhr.send();
  };

  // Sync estimate to QuickBooks
  const syncEstimateMutation = useMutation({
    mutationFn: async (estimateId: number) => {
      const data = await apiRequest(`/api/quickbooks/sync-estimate/${estimateId}`, "POST");
      return data;
    },
    onSuccess: (data) => {
      toast({
        title: "Estimate Synced",
        description: `Estimate has been synchronized with QuickBooks. QB ID: ${data.quickbooksId}`
      });
      queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
    },
    onError: () => {
      toast({
        title: "Sync Failed",
        description: "Failed to sync estimate to QuickBooks. Please try again.",
        variant: "destructive"
      });
    }
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case "synced": return "bg-green-100 text-green-800";
      case "pending": return "bg-yellow-100 text-yellow-800";
      case "failed": return "bg-red-100 text-red-800";
      default: return "bg-gray-100 text-gray-800";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "synced": return <CheckCircle className="w-4 h-4 text-green-600" />;
      case "pending": return <Clock className="w-4 h-4 text-yellow-600" />;
      case "failed": return <AlertTriangle className="w-4 h-4 text-red-600" />;
      default: return <RefreshCw className="w-4 h-4 text-gray-600" />;
    }
  };

  return (
    <div className={className}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ExternalLink className="w-5 h-5" />
            QuickBooks Online Integration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Connection Status */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Connection Status</h3>
              {connectionStatus?.isConnected ? (
                <Badge className="bg-green-100 text-green-800">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  Connected
                </Badge>
              ) : (
                <Badge variant="outline">
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  Not Connected
                </Badge>
              )}
            </div>

            {connectionStatus?.isConnected ? (
              <div className="p-4 bg-green-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <Building className="w-5 h-5 text-green-600" />
                  <div>
                    <p className="font-medium text-green-900">{connectionStatus.companyName}</p>
                    <p className="text-sm text-green-700">Company ID: {connectionStatus.companyId}</p>
                  </div>
                </div>
                {connectionStatus.lastSync && (
                  <div className="mt-2 flex items-center gap-2 text-sm text-green-700">
                    <Calendar className="w-4 h-4" />
                    Last sync: {format(new Date(connectionStatus.lastSync), "PPP")}
                  </div>
                )}
              </div>
            ) : (
              <div className="p-4 bg-blue-50 rounded-lg">
                <p className="text-blue-900 mb-3">
                  Connect your QuickBooks Online account to automatically sync estimates, invoices, and customer data.
                </p>
                <button 
                  onClick={() => {
                    console.log("QuickBooks button clicked - starting connection");
                    setIsConnecting(true);
                    
                    fetch('/api/quickbooks/auth')
                      .then(response => {
                        console.log('QuickBooks auth response:', response.status);
                        if (!response.ok) {
                          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                        }
                        return response.json();
                      })
                      .then(data => {
                        console.log('QuickBooks auth success:', data);
                        window.location.href = data.authUrl;
                      })
                      .catch(error => {
                        console.error('QuickBooks connection failed:', error);
                        toast({
                          title: "Connection Failed",
                          description: "Unable to connect to QuickBooks. Please try again.",
                          variant: "destructive"
                        });
                        setIsConnecting(false);
                      });
                  }}
                  disabled={isConnecting}
                  className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
                  data-testid="quickbooks-connect-btn"
                  type="button"
                >
                  {isConnecting ? "Connecting..." : "Connect to QuickBooks"}
                </button>
                
                {/* Debug button for testing */}
                <button
                  onClick={() => {
                    console.log("🔵 DEBUG: Direct button clicked");
                    window.location.href = 'https://appcenter.intuit.com/connect/oauth2?client_id=ABYzg2dYpmUlNblvzAAgHjWIcgfxHeGyHJxdrrCkKRYIkGgKPS&scope=com.intuit.quickbooks.accounting&redirect_uri=http%3A%2F%2Flocalhost%3A5000%2Fapi%2Fquickbooks%2Fcallback&response_type=code&access_type=offline&state=debug123';
                  }}
                  className="mt-2 px-4 py-2 bg-red-500 text-white text-sm rounded"
                >
                  DEBUG: Direct Link Test
                </button>
              </div>
            )}
          </div>

          <Separator />

          {/* Sync Status */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Sync Status</h3>
            
            {estimates.length === 0 ? (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  No estimates available to sync. Create an estimate to get started.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-3">
                {estimates.map((estimate: any) => (
                  <div key={estimate.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-3">
                      {getStatusIcon("not-synced")}
                      <div>
                        <p className="font-medium">{estimate.estimateNumber}</p>
                        <p className="text-sm text-muted-foreground">
                          {estimate.customerName} - ${estimate.totalAmount}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={getStatusColor("not-synced")}>
                        Not Synced
                      </Badge>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => syncEstimateMutation.mutate(estimate.id)}
                        disabled={!connectionStatus?.isConnected || syncEstimateMutation.isPending}
                      >
                        {syncEstimateMutation.isPending ? (
                          <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : (
                          "Sync"
                        )}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Features */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Integration Features</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-3 bg-gray-50 rounded-lg">
                <h4 className="font-medium mb-2">Automatic Sync</h4>
                <p className="text-sm text-muted-foreground">
                  Estimates and invoices are automatically synchronized with QuickBooks Online
                </p>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <h4 className="font-medium mb-2">Customer Management</h4>
                <p className="text-sm text-muted-foreground">
                  Customer data is synchronized between both systems
                </p>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <h4 className="font-medium mb-2">Real-time Updates</h4>
                <p className="text-sm text-muted-foreground">
                  Payment status and invoice updates are reflected in real-time
                </p>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <h4 className="font-medium mb-2">Detailed Reporting</h4>
                <p className="text-sm text-muted-foreground">
                  Generate comprehensive reports combining field and financial data
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}