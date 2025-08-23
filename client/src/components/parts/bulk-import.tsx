import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Upload, Download, AlertCircle, CheckCircle2, FileText, Settings } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface ImportResult {
  success: boolean;
  imported: number;
  skipped: number;
  errors: Array<{
    row: number;
    field: string;
    message: string;
  }>;
}

interface ColumnMapping {
  csvColumn: string;
  dbField: string;
}

const DB_FIELDS = [
  { value: 'name', label: 'Part Name' },
  { value: 'category', label: 'Category' },
  { value: 'price', label: 'Price' },
  { value: 'cost', label: 'Cost' },
  { value: 'material', label: 'Material' },
  { value: 'size', label: 'Size' },
  { value: 'brand', label: 'Brand' },
  { value: 'fitting_type', label: 'Fitting Type' },
  { value: 'detail', label: 'Detail' },
  { value: 'description', label: 'Description' },
  { value: 'sku', label: 'SKU' },
  { value: 'laborHours', label: 'Labor Hours' },
  { value: 'skip', label: 'Skip Column' }
];

export function BulkImport({ onImportComplete }: { onImportComplete: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [csvText, setCsvText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [progress, setProgress] = useState(0);
  const [showColumnMapping, setShowColumnMapping] = useState(false);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [columnMappings, setColumnMappings] = useState<ColumnMapping[]>([]);
  const [csvPreview, setCsvPreview] = useState<string[][]>([]);
  const { toast } = useToast();

  const downloadTemplate = () => {
    const csvTemplate = `name,category,price,material,size,brand,fitting_type,detail,description
Sprinkler Head - Hunter PGP,Head,12.50,Brass,0.75,Hunter,Threaded,4 inch pop-up,Professional grade popup sprinkler head
Pressure Reducing Valve,Valve,45.00,Brass,1,Febco,Threaded,25-75 PSI,Adjustable pressure reducing valve
PVC Tee Fitting,Fitting,2.25,PVC,1,Charlotte,Slip,Schedule 40,Standard PVC tee fitting
Rain Sensor,Controller,85.00,Plastic,N/A,Rainbird,Wired,Wireless compatible,Automatic rain shut-off sensor
Drip Emitter,Head,0.85,Plastic,2GPH,NETAFIM,Barbed,Self-flushing,Pressure compensating drip emitter`;
    
    const blob = new Blob([csvTemplate], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'parts-import-template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const parseCSV = (csvData: string) => {
    const lines = csvData.trim().split('\n');
    if (lines.length === 0) return { headers: [], preview: [] };
    
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const preview = lines.slice(1, 6).map(line => 
      line.split(',').map(cell => cell.trim().replace(/"/g, ''))
    );
    
    return { headers, preview };
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile && selectedFile.type === 'text/csv') {
      setFile(selectedFile);
      // Read file content for preview
      const reader = new FileReader();
      reader.onload = (e) => {
        const csvData = e.target?.result as string;
        setCsvText(csvData);
        
        const { headers, preview } = parseCSV(csvData);
        setCsvHeaders(headers);
        setCsvPreview(preview);
        
        // Check if this is the enhanced CSV format
        const isEnhancedFormat = headers.includes('Part Type') && 
                                headers.includes('Product/Service Name') && 
                                headers.includes('Price');
        
        if (isEnhancedFormat) {
          // Skip column mapping for enhanced format - it will be processed automatically
          setShowColumnMapping(false);
          toast({
            title: "Enhanced format detected",
            description: "Your CSV will be processed automatically with intelligent categorization",
          });
        } else {
          // Auto-map columns based on common names for standard format
          const autoMappings = headers.map(header => {
            const lowerHeader = header.toLowerCase();
            let dbField = 'skip';
            
            if (lowerHeader.includes('name') || lowerHeader.includes('part')) dbField = 'name';
            else if (lowerHeader.includes('category')) dbField = 'category';
            else if (lowerHeader.includes('price') || lowerHeader.includes('cost')) dbField = 'price';
            else if (lowerHeader.includes('material')) dbField = 'material';
            else if (lowerHeader.includes('size')) dbField = 'size';
            else if (lowerHeader.includes('brand')) dbField = 'brand';
            else if (lowerHeader.includes('fitting')) dbField = 'fitting_type';
            else if (lowerHeader.includes('detail')) dbField = 'detail';
            else if (lowerHeader.includes('description')) dbField = 'description';
            else if (lowerHeader.includes('sku')) dbField = 'sku';
            else if (lowerHeader.includes('labor') || lowerHeader.includes('hour')) dbField = 'laborHours';
            
            return { csvColumn: header, dbField };
          });
          
          setColumnMappings(autoMappings);
          setShowColumnMapping(true);
        }
      };
      reader.readAsText(selectedFile);
    } else {
      toast({
        title: "Invalid file",
        description: "Please select a CSV file",
        variant: "destructive"
      });
    }
  };

  const updateColumnMapping = (csvColumn: string, dbField: string) => {
    setColumnMappings(prev => 
      prev.map(mapping => 
        mapping.csvColumn === csvColumn 
          ? { ...mapping, dbField }
          : mapping
      )
    );
  };

  const processImport = async (data: string, mappings?: ColumnMapping[]) => {
    setImporting(true);
    setProgress(0);
    setImportResult(null);

    try {
      // Simulate progress updates
      const progressInterval = setInterval(() => {
        setProgress((prev) => Math.min(prev + 10, 90));
      }, 200);

      const response = await apiRequest("/api/parts/bulk-import", "POST", { 
        csvData: data,
        columnMappings: mappings || columnMappings
      });

      clearInterval(progressInterval);
      setProgress(100);
      
      setImportResult(response);
      
      if (response.success) {
        toast({
          title: "Import completed",
          description: `Successfully imported ${response.imported} parts`,
        });
        onImportComplete();
      } else {
        toast({
          title: "Import completed with issues",
          description: `Imported ${response.imported} parts, ${response.skipped} skipped`,
          variant: "destructive"
        });
      }
    } catch (error) {
      toast({
        title: "Import failed",
        description: "Failed to import parts. Please check your data format.",
        variant: "destructive"
      });
      setImportResult({
        success: false,
        imported: 0,
        skipped: 0,
        errors: [{ row: 0, field: "general", message: "Failed to process import" }]
      });
    } finally {
      setImporting(false);
    }
  };

  const handleFileImport = () => {
    if (!csvText) {
      toast({
        title: "No data",
        description: "Please select a file or paste CSV data",
        variant: "destructive"
      });
      return;
    }
    processImport(csvText);
  };

  const handleTextImport = () => {
    if (!csvText.trim()) {
      toast({
        title: "No data",
        description: "Please paste CSV data",
        variant: "destructive"
      });
      return;
    }
    
    const { headers } = parseCSV(csvText);
    if (headers.length > 0) {
      setCsvHeaders(headers);
      const autoMappings = headers.map(header => ({ csvColumn: header, dbField: 'skip' }));
      setColumnMappings(autoMappings);
      setShowColumnMapping(true);
    } else {
      processImport(csvText);
    }
  };

  const proceedWithImport = () => {
    const validMappings = columnMappings.filter(m => m.dbField !== 'skip');
    if (validMappings.length === 0) {
      toast({
        title: "No columns mapped",
        description: "Please map at least one column to a database field",
        variant: "destructive"
      });
      return;
    }
    
    processImport(csvText, columnMappings);
    setShowColumnMapping(false);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Bulk Import Parts
          </CardTitle>
          <CardDescription>
            Import multiple parts from CSV file or paste data directly. Use our template format for best results.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Button 
              onClick={downloadTemplate} 
              variant="outline" 
              className="flex items-center gap-2"
            >
              <Download className="h-4 w-4" />
              Download CSV Template
            </Button>

            <Tabs defaultValue="file" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="file">Upload File</TabsTrigger>
                <TabsTrigger value="text">Paste Data</TabsTrigger>
              </TabsList>
              
              <TabsContent value="file" className="space-y-4">
                <div>
                  <Label htmlFor="csv-file">CSV File</Label>
                  <Input
                    id="csv-file"
                    type="file"
                    accept=".csv"
                    onChange={handleFileUpload}
                    className="mt-1"
                  />
                </div>
                
                {file && (
                  <Alert>
                    <FileText className="h-4 w-4" />
                    <AlertDescription>
                      File selected: {file.name} ({(file.size / 1024).toFixed(1)} KB)
                    </AlertDescription>
                  </Alert>
                )}
                
                <Button 
                  onClick={handleFileImport} 
                  disabled={!file || importing}
                  className="w-full"
                >
                  {importing ? "Importing..." : "Import from File"}
                </Button>
              </TabsContent>
              
              <TabsContent value="text" className="space-y-4">
                <div>
                  <Label htmlFor="csv-text">CSV Data</Label>
                  <Textarea
                    id="csv-text"
                    placeholder="Paste your CSV data here..."
                    value={csvText}
                    onChange={(e) => setCsvText(e.target.value)}
                    className="mt-1 min-h-[200px] font-mono text-sm"
                  />
                </div>
                
                <Button 
                  onClick={handleTextImport} 
                  disabled={!csvText.trim() || importing}
                  className="w-full"
                >
                  {importing ? "Importing..." : "Import from Text"}
                </Button>
              </TabsContent>
            </Tabs>

            {importing && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Processing...</span>
                  <span className="text-sm text-muted-foreground">{progress}%</span>
                </div>
                <Progress value={progress} className="w-full" />
              </div>
            )}

            {importResult && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {importResult.success ? (
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                    ) : (
                      <AlertCircle className="h-5 w-5 text-red-600" />
                    )}
                    Import Results
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-4">
                    <Badge variant="default">{importResult.imported} Imported</Badge>
                    {importResult.skipped > 0 && (
                      <Badge variant="secondary">{importResult.skipped} Skipped</Badge>
                    )}
                    {importResult.errors.length > 0 && (
                      <Badge variant="destructive">{importResult.errors.length} Errors</Badge>
                    )}
                  </div>

                  {importResult.errors.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="font-medium">Errors:</h4>
                      <div className="max-h-40 overflow-y-auto space-y-1">
                        {importResult.errors.map((error, index) => (
                          <Alert key={index} variant="destructive">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>
                              Row {error.row}, {error.field}: {error.message}
                            </AlertDescription>
                          </Alert>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Column Mapping Interface */}
      {showColumnMapping && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Map CSV Columns
            </CardTitle>
            <CardDescription>
              Map your CSV columns to database fields. Columns marked as "Skip" will be ignored during import.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Preview Table */}
            <div className="space-y-3">
              <h4 className="font-medium">CSV Preview (first 5 rows)</h4>
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      {csvHeaders.map((header, index) => (
                        <TableHead key={index} className="font-semibold">
                          {header}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {csvPreview.map((row, rowIndex) => (
                      <TableRow key={rowIndex}>
                        {row.map((cell, cellIndex) => (
                          <TableCell key={cellIndex} className="text-sm">
                            {cell || <span className="text-muted-foreground italic">empty</span>}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* Column Mapping */}
            <div className="space-y-3">
              <h4 className="font-medium">Column Mapping</h4>
              <div className="grid gap-3">
                {columnMappings.map((mapping, index) => (
                  <div key={index} className="flex items-center gap-3 p-3 border rounded-lg">
                    <div className="flex-1">
                      <Label className="text-sm font-medium">{mapping.csvColumn}</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">→</span>
                      <Select
                        value={mapping.dbField}
                        onValueChange={(value) => updateColumnMapping(mapping.csvColumn, value)}
                      >
                        <SelectTrigger className="w-48">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DB_FIELDS.map((field) => (
                            <SelectItem key={field.value} value={field.value}>
                              {field.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Import Controls */}
            <div className="flex gap-3 pt-4 border-t">
              <Button onClick={proceedWithImport} disabled={importing} className="flex-1">
                {importing ? "Importing..." : "Proceed with Import"}
              </Button>
              <Button 
                onClick={() => setShowColumnMapping(false)} 
                variant="outline"
                disabled={importing}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>CSV Format Requirements</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <p><strong>Required columns:</strong> name, category, price</p>
            <p><strong>Optional columns:</strong> material, size, brand, fitting_type, detail, description</p>
            <p><strong>Categories:</strong> Backflow, Bushing, Controller, Decoder, Filter, Fitting, Head, Irrigation Box, Labor, Misc, Module, Nipple, Nozzle, Pipe, Rental, Service, Valve, Wire</p>
            <p><strong>Materials:</strong> PVC, Copper, Brass, NETAFIM, Plastic, Steel, etc.</p>
            <p className="text-muted-foreground">Duplicate parts (same name) will be skipped automatically.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}