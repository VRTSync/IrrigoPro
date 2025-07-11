import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { 
  ExternalLink, 
  RefreshCw, 
  CheckCircle, 
  XCircle, 
  AlertCircle,
  Download,
  Upload,
  Building2
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { quickbooksService } from "@/lib/quickbooks";
import type { Estimate } from "@shared/schema";

interface QuickBooksIntegrationProps {
  estimates?: Estimate[];
}

export function QuickBooksIntegration({ estimates = [] }: QuickBooksIntegrationProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Get QuickBooks connection status
  const { data: connectionStatus, isLoading: loadingConnection } = useQuery({
    queryKey: ["/api/quickbooks/connection-status"],
    queryFn: () => quickbooksService.getConnectionStatus(),
  });

  // Get sync statuses
  const { data: syncStatuses = [], isLoading: loadingSyncStatuses } = useQuery({
    queryKey: ["/api/quickbooks/sync-statuses"],
    queryFn: () => quickbooksService.getAllSyncStatuses(),
    enabled: connectionStatus?.isConnected,
  });

  // Connect to QuickBooks
  const connectMutation = useMutation({
    mutationFn: async () => {
      setIsConnecting(true);
      const authData = await quickbooksService.getAuthUrl();
      window.location.href = authData.authUrl;
    },
    onError: () => {
      setIsConnecting(false);
      toast({
        title: "Connection Failed",
        description: "Failed to connect to QuickBooks. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Disconnect from QuickBooks
  const disconnectMutation = useMutation({
    mutationFn: () => quickbooksService.disconnect(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quickbooks/connection-status"] });
      toast({
        title: "Disconnected",
        description: "Successfully disconnected from QuickBooks Online",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to disconnect from QuickBooks",
        variant: "destructive",
      });
    },
  });

  // Sync single estimate
  const syncEstimateMutation = useMutation({
    mutationFn: (estimateId: number) => quickbooksService.syncEstimate(estimateId),
    onSuccess: (data, estimateId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/quickbooks/sync-statuses"] });
      if (data.success) {
        toast({
          title: "Sync Successful",
          description: `Estimate #${estimateId} synced to QuickBooks`,
        });
      } else {
        toast({
          title: "Sync Failed",
          description: data.error || "Failed to sync estimate",
          variant: "destructive",
        });
      }
    },
    onError: () => {
      toast({
        title: "Sync Error",
        description: "Failed to sync estimate to QuickBooks",
        variant: "destructive",
      });
    },
  });

  // Sync all estimates
  const syncAllMutation = useMutation({
    mutationFn: () => quickbooksService.syncAllEstimates(),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/quickbooks/sync-statuses"] });
      toast({
        title: "Bulk Sync Complete",
        description: `Synced ${data.synced} estimates. ${data.failed} failed.`,
      });
    },
    onError: () => {
      toast({
        title: "Bulk Sync Error",
        description: "Failed to sync estimates to QuickBooks",
        variant: "destructive",
      });
    },
  });

  const getSyncStatusBadge = (status: string) => {
    switch (status) {
      case "synced":
        return <Badge variant="default" className="bg-green-100 text-green-800"><CheckCircle className="w-3 h-3 mr-1" />Synced</Badge>;
      case "failed":
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Failed</Badge>;
      case "pending":
        return <Badge variant="secondary"><AlertCircle className="w-3 h-3 mr-1" />Pending</Badge>;
      default:
        return <Badge variant="outline">Not Synced</Badge>;
    }
  };

  const syncedCount = syncStatuses.filter(s => s.syncStatus === "synced").length;
  const pendingCount = syncStatuses.filter(s => s.syncStatus === "pending").length;
  const failedCount = syncStatuses.filter(s => s.syncStatus === "failed").length;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            QuickBooks Online Integration
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingConnection ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="w-6 h-6 animate-spin mr-2" />
              <span>Checking connection...</span>
            </div>
          ) : (
            <div className="space-y-4">
              {connectionStatus?.isConnected ? (
                <div className="space-y-4">
                  <Alert className="bg-green-50 border-green-200">
                    <CheckCircle className="w-4 h-4 text-green-600" />
                    <AlertDescription className="text-green-800">
                      Connected to <strong>{connectionStatus.companyName}</strong>
                      {connectionStatus.lastSync && (
                        <span className="ml-2 text-sm text-green-600">
                          Last sync: {new Date(connectionStatus.lastSync).toLocaleString()}
                        </span>
                      )}
                    </AlertDescription>
                  </Alert>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-green-600">{syncedCount}</div>
                      <div className="text-sm text-gray-600">Synced</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-yellow-600">{pendingCount}</div>
                      <div className="text-sm text-gray-600">Pending</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-red-600">{failedCount}</div>
                      <div className="text-sm text-gray-600">Failed</div>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      onClick={() => syncAllMutation.mutate()}
                      disabled={syncAllMutation.isPending || estimates.length === 0}
                      className="flex-1"
                    >
                      {syncAllMutation.isPending ? (
                        <>
                          <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                          Syncing All...
                        </>
                      ) : (
                        <>
                          <Upload className="w-4 h-4 mr-2" />
                          Sync All Estimates
                        </>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => disconnectMutation.mutate()}
                      disabled={disconnectMutation.isPending}
                    >
                      Disconnect
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <Alert>
                    <AlertCircle className="w-4 h-4" />
                    <AlertDescription>
                      Connect to QuickBooks Online to sync your estimates and streamline your accounting workflow.
                    </AlertDescription>
                  </Alert>

                  <div className="bg-gray-50 p-4 rounded-lg">
                    <h4 className="font-medium mb-2">Benefits of QuickBooks Integration:</h4>
                    <ul className="text-sm text-gray-600 space-y-1">
                      <li>• Automatically sync estimates to QuickBooks</li>
                      <li>• Convert estimates to invoices with one click</li>
                      <li>• Keep customer data synchronized</li>
                      <li>• Track project profitability</li>
                    </ul>
                  </div>

                  <Button
                    onClick={() => connectMutation.mutate()}
                    disabled={isConnecting || connectMutation.isPending}
                    className="w-full"
                  >
                    {isConnecting || connectMutation.isPending ? (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                        Connecting...
                      </>
                    ) : (
                      <>
                        <ExternalLink className="w-4 h-4 mr-2" />
                        Connect to QuickBooks Online
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Individual Estimate Sync Status */}
      {connectionStatus?.isConnected && estimates.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Estimate Sync Status</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingSyncStatuses ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="w-6 h-6 animate-spin mr-2" />
                <span>Loading sync status...</span>
              </div>
            ) : (
              <div className="space-y-3">
                {estimates.map((estimate) => {
                  const syncStatus = syncStatuses.find(s => s.estimateId === estimate.id);
                  return (
                    <div key={estimate.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div className="flex-1">
                        <div className="flex items-center gap-3">
                          <span className="font-medium">Estimate #{estimate.id}</span>
                          <span className="text-sm text-gray-600">{estimate.customerName}</span>
                          {getSyncStatusBadge(syncStatus?.syncStatus || "not-synced")}
                        </div>
                        {syncStatus?.error && (
                          <div className="text-sm text-red-600 mt-1">{syncStatus.error}</div>
                        )}
                        {syncStatus?.lastSyncDate && (
                          <div className="text-sm text-gray-500 mt-1">
                            Last synced: {new Date(syncStatus.lastSyncDate).toLocaleString()}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">${estimate.totalAmount}</span>
                        {syncStatus?.syncStatus !== "synced" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => syncEstimateMutation.mutate(estimate.id)}
                            disabled={syncEstimateMutation.isPending}
                          >
                            {syncEstimateMutation.isPending ? (
                              <RefreshCw className="w-4 h-4 animate-spin" />
                            ) : (
                              <Upload className="w-4 h-4" />
                            )}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}