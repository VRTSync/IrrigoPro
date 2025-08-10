import { useState } from "react";
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

  // Fetch QuickBooks connection status
  const { data: connectionStatus, isLoading: loadingConnection } = useQuery({
    queryKey: ["/api/quickbooks/connection"],
    enabled: true,
  });

  // Fetch estimates for sync status
  const { data: estimates = [] } = useQuery({
    queryKey: ["/api/estimates"],
    enabled: true,
  });

  // Connect to QuickBooks
  const connectMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("GET", "/api/quickbooks/auth", {});
      const data = await response.json();
      
      if (!data.authUrl) {
        throw new Error("No authorization URL received");
      }
      
      // Open QuickBooks OAuth flow in a new window
      const popup = window.open(
        data.authUrl, 
        "quickbooks-oauth", 
        "width=600,height=700,scrollbars=yes,resizable=yes"
      );
      
      if (!popup) {
        throw new Error("Popup blocked. Please allow popups for this site.");
      }
      
      setIsConnecting(true);
      
      // Listen for the popup to close (indicating OAuth completion)
      const checkClosed = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkClosed);
          setIsConnecting(false);
          
          // Check connection status after popup closes
          setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: ["/api/quickbooks/connection"] });
          }, 1000);
        }
      }, 1000);
      
      return { success: true };
    },
    onError: (error: any) => {
      setIsConnecting(false);
      toast({
        title: "Connection Failed",
        description: error.message || "Failed to connect to QuickBooks. Please try again.",
        variant: "destructive"
      });
    }
  });

  // Sync estimate to QuickBooks
  const syncEstimateMutation = useMutation({
    mutationFn: async (estimateId: number) => {
      const response = await apiRequest("POST", `/api/quickbooks/sync-estimate/${estimateId}`, {});
      return response.json();
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
                <Button 
                  onClick={() => connectMutation.mutate()}
                  disabled={isConnecting}
                  className="w-full"
                >
                  {isConnecting ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      Connecting...
                    </>
                  ) : (
                    <>
                      <ExternalLink className="w-4 h-4 mr-2" />
                      Connect to QuickBooks
                    </>
                  )}
                </Button>
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