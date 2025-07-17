import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Upload, FileText, CheckCircle, AlertCircle, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface CsvUploadResult {
  success: boolean;
  imported: number;
  errors: string[];
  duplicates: number;
}

export function CustomerCsvUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadResult, setUploadResult] = useState<CsvUploadResult | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const uploadMutation = useMutation({
    mutationFn: async (csvFile: File) => {
      const formData = new FormData();
      formData.append('file', csvFile);
      
      return apiRequest('/api/customers/import-csv', {
        method: 'POST',
        body: formData,
      });
    },
    onSuccess: (result: CsvUploadResult) => {
      setUploadResult(result);
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      
      if (result.success) {
        toast({
          title: "CSV Import Successful",
          description: `Imported ${result.imported} customers successfully.`,
        });
      } else {
        toast({
          title: "CSV Import Completed with Errors",
          description: `Imported ${result.imported} customers with ${result.errors.length} errors.`,
          variant: "destructive",
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to upload CSV file",
        variant: "destructive",
      });
    },
  });

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
      if (selectedFile.type === 'text/csv' || selectedFile.name.endsWith('.csv')) {
        setFile(selectedFile);
        setUploadResult(null);
      } else {
        toast({
          title: "Invalid File Type",
          description: "Please select a CSV file (.csv)",
          variant: "destructive",
        });
      }
    }
  };

  const handleUpload = () => {
    if (!file) return;
    
    setUploadProgress(0);
    uploadMutation.mutate(file);
  };

  const downloadTemplate = () => {
    const csvContent = [
      'name,email,phone,address,contractType,laborRate,markupPercent,taxPercent,discountPercent,paymentTerms,notes',
      'Johnson Family,johnson@example.com,(555) 123-4567,"123 Oak Street, Springfield, IL 62701",residential,42.00,18.00,8.25,0.00,net_30,"Preferred residential customer"',
      'Office Complex Management,manager@officecomplex.com,(555) 234-5678,"456 Business Ave, Springfield, IL 62702",commercial,55.00,25.00,8.25,5.00,net_15,"Commercial contract with bulk pricing"'
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', 'customer_template.csv');
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center">
          <Upload className="w-5 h-5 mr-2" />
          CSV Import
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <div className="text-sm text-gray-600">
            Import customer data from a CSV file. Download the template below to see the required format.
          </div>
          
          <Button 
            variant="outline" 
            onClick={downloadTemplate}
            className="w-full"
          >
            <Download className="w-4 h-4 mr-2" />
            Download CSV Template
          </Button>
        </div>

        <div className="space-y-4">
          <Label htmlFor="csv-file">Select CSV File</Label>
          <Input
            id="csv-file"
            type="file"
            accept=".csv"
            onChange={handleFileSelect}
            className="cursor-pointer"
          />
          
          {file && (
            <div className="flex items-center space-x-2 text-sm text-gray-600">
              <FileText className="w-4 h-4" />
              <span>{file.name} ({(file.size / 1024).toFixed(1)} KB)</span>
            </div>
          )}
        </div>

        {uploadMutation.isPending && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Uploading...</span>
              <span>{uploadProgress}%</span>
            </div>
            <Progress value={uploadProgress} className="w-full" />
          </div>
        )}

        {uploadResult && (
          <Alert className={uploadResult.success ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}>
            <div className="flex items-center">
              {uploadResult.success ? (
                <CheckCircle className="w-4 h-4 text-green-600 mr-2" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-600 mr-2" />
              )}
              <AlertDescription>
                <div className="space-y-2">
                  <div>
                    <strong>Import Summary:</strong>
                  </div>
                  <ul className="text-sm space-y-1">
                    <li>✓ {uploadResult.imported} customers imported successfully</li>
                    {uploadResult.duplicates > 0 && (
                      <li>⚠ {uploadResult.duplicates} duplicates skipped</li>
                    )}
                    {uploadResult.errors.length > 0 && (
                      <li>✗ {uploadResult.errors.length} errors encountered</li>
                    )}
                  </ul>
                  {uploadResult.errors.length > 0 && (
                    <div className="mt-2">
                      <strong>Errors:</strong>
                      <ul className="text-sm mt-1 space-y-1">
                        {uploadResult.errors.slice(0, 5).map((error, index) => (
                          <li key={index} className="text-red-600">• {error}</li>
                        ))}
                        {uploadResult.errors.length > 5 && (
                          <li className="text-gray-500">... and {uploadResult.errors.length - 5} more</li>
                        )}
                      </ul>
                    </div>
                  )}
                </div>
              </AlertDescription>
            </div>
          </Alert>
        )}

        <Button 
          onClick={handleUpload}
          disabled={!file || uploadMutation.isPending}
          className="w-full"
        >
          {uploadMutation.isPending ? (
            <>
              <Upload className="w-4 h-4 mr-2 animate-spin" />
              Importing...
            </>
          ) : (
            <>
              <Upload className="w-4 h-4 mr-2" />
              Import CSV
            </>
          )}
        </Button>

        <div className="text-sm text-gray-500 space-y-2">
          <div><strong>CSV Format Requirements:</strong></div>
          <ul className="text-xs space-y-1">
            <li>• Required fields: name, email</li>
            <li>• Optional fields: phone, address, contractType, laborRate, markupPercent, taxPercent, discountPercent, paymentTerms, notes</li>
            <li>• Contract types: standard, premium, commercial, residential</li>
            <li>• Payment terms: net_30, net_15, due_on_receipt</li>
            <li>• Rates should be in decimal format (e.g., 45.00)</li>
            <li>• Percentages should be in decimal format (e.g., 8.25 for 8.25%)</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}