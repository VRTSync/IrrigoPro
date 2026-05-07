import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { FileSpreadsheet, Upload, Link2, CheckCircle, AlertCircle, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export function PartsIntegration() {
  const [sheetsUrl, setSheetsUrl] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const importFromSheets = useMutation({
    mutationFn: async (url: string) => {
      setIsProcessing(true);
      return await apiRequest("/api/parts/import/google-sheets", "POST", { 
        sheetsUrl: url 
      });
    },
    onSuccess: (result) => {
      toast({
        title: "Import Successful",
        description: `Successfully imported ${result.partsAdded} parts from Google Sheets.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/parts"] });
      setSheetsUrl("");
      setIsProcessing(false);
    },
    onError: (error: any) => {
      toast({
        title: "Import Failed",
        description: error.message || "Failed to import parts from Google Sheets",
        variant: "destructive",
      });
      setIsProcessing(false);
    },
  });

  const handleImport = () => {
    if (!sheetsUrl.trim()) {
      toast({
        title: "URL Required",
        description: "Please enter a Google Sheets URL",
        variant: "destructive",
      });
      return;
    }
    importFromSheets.mutate(sheetsUrl);
  };

  const sampleCsv = `name,description,price,laborHours,sku,category
Rain Bird 5004 Sprinkler,Pop-up spray head with adjustable pattern,18.50,0.50,RB-5004,Sprinklers
Hunter PGP-ADJ Rotor,Adjustable arc rotary sprinkler,42.75,0.75,HU-PGP-ADJ,Rotors
1" PVC Pipe (10ft),Schedule 40 PVC pipe for irrigation,12.25,0.25,PVC-1-10,Pipes`;

  return (
    <div className="space-y-6">
      {/* Google Sheets Integration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-green-600" />
            Google Sheets Import
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-blue-50 p-4 rounded-lg">
            <h4 className="font-medium text-blue-900 mb-2">How to prepare your Google Sheets:</h4>
            <ol className="text-sm text-blue-800 space-y-1 list-decimal list-inside">
              <li>Make sure your sheet has these column headers: <code>name, description, price, laborHours, sku, category</code></li>
              <li>Set sharing to "Anyone with the link can view"</li>
              <li>Copy the sheet URL and paste it below</li>
            </ol>
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium text-gray-700">Google Sheets URL</label>
            <Input
              placeholder="https://docs.google.com/spreadsheets/d/..."
              value={sheetsUrl}
              onChange={(e) => setSheetsUrl(e.target.value)}
              className="w-full"
            />
            <Button 
              onClick={handleImport}
              disabled={isProcessing}
              className="w-full bg-green-600 hover:bg-green-700 text-white"
            >
              {isProcessing ? (
                <>
                  <Upload className="w-4 h-4 mr-2 animate-spin" />
                  Importing Parts...
                </>
              ) : (
                <>
                  <FileSpreadsheet className="w-4 h-4 mr-2" />
                  Import from Google Sheets
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* CSV Upload Alternative */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5 text-blue-600" />
            CSV Upload
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-gray-600">
            If you can't use Google Sheets, export your data as CSV and upload it here.
          </p>
          
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
            <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
            <p className="text-sm text-gray-600 mb-2">Drop your CSV file here or click to upload</p>
            <Button variant="outline" size="sm">
              Choose File
            </Button>
          </div>

          <div className="bg-gray-50 p-4 rounded-lg">
            <h4 className="font-medium text-gray-900 mb-2">Sample CSV Format:</h4>
            <pre className="text-xs text-gray-700 bg-white p-3 rounded border overflow-x-auto">
              {sampleCsv}
            </pre>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => {
                const blob = new Blob([sampleCsv], { type: 'text/csv' });
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'parts-template.csv';
                a.click();
              }}
            >
              <Download className="w-4 h-4 mr-2" />
              Download Template
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Integration Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 className="w-5 h-5 text-gray-600" />
            Integration Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div className="flex items-center gap-3">
                <FileSpreadsheet className="w-5 h-5 text-green-600" />
                <div>
                  <p className="font-medium text-gray-900">Google Sheets</p>
                  <p className="text-sm text-gray-600">Ready for import</p>
                </div>
              </div>
              <Badge variant="outline" className="text-green-600 border-green-600">
                <CheckCircle className="w-3 h-3 mr-1" />
                Available
              </Badge>
            </div>

            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div className="flex items-center gap-3">
                <Upload className="w-5 h-5 text-blue-600" />
                <div>
                  <p className="font-medium text-gray-900">CSV Upload</p>
                  <p className="text-sm text-gray-600">Manual file upload</p>
                </div>
              </div>
              <Badge variant="outline" className="text-blue-600 border-blue-600">
                <CheckCircle className="w-3 h-3 mr-1" />
                Available
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}