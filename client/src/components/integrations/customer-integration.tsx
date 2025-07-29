import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Sheet, Users, Download, Upload, RefreshCw, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CustomerCsvUpload } from "@/components/customer-csv-upload";

interface GoogleSheetsSync {
  isConnected: boolean;
  lastSync?: string;
  sheetUrl?: string;
  customerCount?: number;
}

interface QuickBooksConnection {
  isConnected: boolean;
  companyName?: string;
  lastSync?: string;
  customerCount?: number;
}

export function CustomerIntegration() {
  const [googleSheetsUrl, setGoogleSheetsUrl] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Google Sheets sync status
  const { data: googleSheetsStatus } = useQuery<GoogleSheetsSync>({
    queryKey: ['/api/integrations/google-sheets/customers/status'],
  });

  // QuickBooks connection status
  const { data: quickbooksStatus } = useQuery<QuickBooksConnection>({
    queryKey: ['/api/integrations/quickbooks/customers/status'],
  });

  // Google Sheets mutations
  const connectGoogleSheets = useMutation({
    mutationFn: async (url: string) => {
      return apiRequest('/api/integrations/google-sheets/customers/connect', {
        method: 'POST',
        body: { sheetUrl: url }
      });
    },
    onSuccess: () => {
      toast({
        title: "Google Sheets Connected",
        description: "Customer data sync has been set up successfully."
      });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/google-sheets'] });
      queryClient.invalidateQueries({ queryKey: ['/api/customers'] });
    },
    onError: (error: any) => {
      toast({
        title: "Connection Failed",
        description: error.message || "Failed to connect to Google Sheets",
        variant: "destructive"
      });
    }
  });

  const syncGoogleSheets = useMutation({
    mutationFn: async () => {
      return apiRequest('/api/integrations/google-sheets/customers/sync', {
        method: 'POST'
      });
    },
    onSuccess: (data: any) => {
      toast({
        title: "Sync Complete",
        description: `Successfully synced ${data.customersAdded} customers from Google Sheets.`
      });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/google-sheets'] });
      queryClient.invalidateQueries({ queryKey: ['/api/customers'] });
    },
    onError: (error: any) => {
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to sync customer data",
        variant: "destructive"
      });
    }
  });

  const disconnectGoogleSheets = useMutation({
    mutationFn: async () => {
      return apiRequest('/api/integrations/google-sheets/customers/disconnect', {
        method: 'POST'
      });
    },
    onSuccess: () => {
      toast({
        title: "Disconnected",
        description: "Google Sheets integration has been disconnected."
      });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/google-sheets'] });
    }
  });

  // QuickBooks mutations
  const connectQuickBooks = useMutation({
    mutationFn: async () => {
      // For demo purposes, directly connect
      return apiRequest('/api/integrations/quickbooks/customers/connect', {
        method: 'POST'
      });
    },
    onSuccess: () => {
      toast({
        title: "QuickBooks Connected",
        description: "Successfully connected to QuickBooks Online. You can now sync customer data."
      });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/quickbooks'] });
    },
    onError: (error: any) => {
      toast({
        title: "Connection Failed",
        description: error.message || "Failed to connect to QuickBooks",
        variant: "destructive"
      });
    }
  });

  const syncQuickBooks = useMutation({
    mutationFn: async () => {
      return apiRequest('/api/integrations/quickbooks/customers/sync', {
        method: 'POST'
      });
    },
    onSuccess: (data: any) => {
      toast({
        title: "Sync Complete",
        description: `Successfully synced ${data.customersAdded} customers from QuickBooks.`
      });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/quickbooks'] });
      queryClient.invalidateQueries({ queryKey: ['/api/customers'] });
    },
    onError: (error: any) => {
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to sync customer data",
        variant: "destructive"
      });
    }
  });

  const disconnectQuickBooks = useMutation({
    mutationFn: async () => {
      return apiRequest('/api/integrations/quickbooks/customers/disconnect', {
        method: 'POST'
      });
    },
    onSuccess: () => {
      toast({
        title: "Disconnected",
        description: "QuickBooks integration has been disconnected."
      });
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/quickbooks'] });
    }
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Customer Integration</h2>
        <Badge variant="outline" className="text-sm">
          <Users className="w-4 h-4 mr-2" />
          Customer Sync
        </Badge>
      </div>

      <Tabs defaultValue="csv-upload" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="csv-upload">CSV Upload</TabsTrigger>
          <TabsTrigger value="google-sheets">Google Sheets</TabsTrigger>
          <TabsTrigger value="quickbooks">QuickBooks Online</TabsTrigger>
        </TabsList>

        <TabsContent value="csv-upload" className="space-y-4">
          <CustomerCsvUpload />
        </TabsContent>

        <TabsContent value="google-sheets" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sheet className="w-5 h-5" />
                Google Sheets Integration
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {googleSheetsStatus?.isConnected ? (
                <div className="space-y-4">
                  <Alert>
                    <AlertDescription>
                      Connected to Google Sheets. Last sync: {googleSheetsStatus.lastSync ? new Date(googleSheetsStatus.lastSync).toLocaleString() : 'Never'}
                    </AlertDescription>
                  </Alert>
                  
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">
                      {googleSheetsStatus.customerCount || 0} customers
                    </Badge>
                    {googleSheetsStatus.sheetUrl && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => window.open(googleSheetsStatus.sheetUrl, '_blank')}
                      >
                        <ExternalLink className="w-4 h-4 mr-2" />
                        View Sheet
                      </Button>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <Button
                      onClick={() => syncGoogleSheets.mutate()}
                      disabled={syncGoogleSheets.isPending}
                    >
                      {syncGoogleSheets.isPending ? (
                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Download className="w-4 h-4 mr-2" />
                      )}
                      Sync Now
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => disconnectGoogleSheets.mutate()}
                      disabled={disconnectGoogleSheets.isPending}
                    >
                      Disconnect
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <Alert>
                    <AlertDescription>
                      Connect your Google Sheets to automatically sync customer data. Your sheet should have columns: Name, Email, Phone, Address.
                    </AlertDescription>
                  </Alert>
                  
                  <div className="space-y-2">
                    <Label htmlFor="sheets-url">Google Sheets URL</Label>
                    <Input
                      id="sheets-url"
                      type="url"
                      placeholder="https://docs.google.com/spreadsheets/d/..."
                      value={googleSheetsUrl}
                      onChange={(e) => setGoogleSheetsUrl(e.target.value)}
                    />
                  </div>
                  
                  <Button
                    onClick={() => connectGoogleSheets.mutate(googleSheetsUrl)}
                    disabled={!googleSheetsUrl || connectGoogleSheets.isPending}
                  >
                    {connectGoogleSheets.isPending ? (
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4 mr-2" />
                    )}
                    Connect Google Sheets
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="quickbooks" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5" />
                QuickBooks Online Integration
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {quickbooksStatus?.isConnected ? (
                <div className="space-y-4">
                  <Alert>
                    <AlertDescription>
                      Connected to QuickBooks Online ({quickbooksStatus.companyName}). Last sync: {quickbooksStatus.lastSync ? new Date(quickbooksStatus.lastSync).toLocaleString() : 'Never'}
                    </AlertDescription>
                  </Alert>
                  
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">
                      {quickbooksStatus.customerCount || 0} customers
                    </Badge>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      onClick={() => syncQuickBooks.mutate()}
                      disabled={syncQuickBooks.isPending}
                    >
                      {syncQuickBooks.isPending ? (
                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Download className="w-4 h-4 mr-2" />
                      )}
                      Sync Now
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => disconnectQuickBooks.mutate()}
                      disabled={disconnectQuickBooks.isPending}
                    >
                      Disconnect
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <Alert>
                    <AlertDescription>
                      Connect your QuickBooks Online account to automatically sync customer data. This will import all customers from your QuickBooks company file.
                    </AlertDescription>
                  </Alert>
                  
                  <Button
                    onClick={() => connectQuickBooks.mutate()}
                    disabled={connectQuickBooks.isPending}
                  >
                    {connectQuickBooks.isPending ? (
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <ExternalLink className="w-4 h-4 mr-2" />
                    )}
                    Connect QuickBooks Online
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}