import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload, FileText, AlertCircle, CheckCircle } from "lucide-react";
import { KMLParser, type ParsedKMLData } from "@/lib/kml-parser";
import { useToast } from "@/hooks/use-toast";

interface KMLUploadProps {
  onKMLParsed: (data: ParsedKMLData) => void;
  onFileSelected: (file: File) => void;
}

export function KMLUpload({ onKMLParsed, onFileSelected }: KMLUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseStatus, setParseStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [parseResults, setParseResults] = useState<ParsedKMLData | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFileSelect = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.kml')) {
      toast({
        title: "Invalid File Type",
        description: "Please select a KML file (.kml extension)",
        variant: "destructive",
      });
      return;
    }

    setFileName(file.name);
    setIsProcessing(true);
    setParseStatus('idle');
    onFileSelected(file);

    try {
      const parsedData = await KMLParser.parseKMLFile(file);
      setParseResults(parsedData);
      setParseStatus('success');
      onKMLParsed(parsedData);
      
      toast({
        title: "KML File Processed",
        description: `Found ${parsedData.controllers.length} controllers and ${parsedData.zones.length} zones`,
      });
    } catch (error) {
      setParseStatus('error');
      toast({
        title: "KML Processing Failed",
        description: error instanceof Error ? error.message : "Failed to parse KML file",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileSelect(e.target.files[0]);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="w-5 h-5 text-blue-600" />
          Import KML File
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
            isDragging
              ? 'border-blue-500 bg-blue-50'
              : 'border-gray-300 hover:border-gray-400'
          }`}
          onDrop={handleDrop}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".kml"
            onChange={handleFileInputChange}
            className="hidden"
          />
          
          {!fileName ? (
            <div className="space-y-4">
              <div className="flex justify-center">
                <Upload className="w-12 h-12 text-gray-400" />
              </div>
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  Upload KML File
                </h3>
                <p className="text-gray-600 mb-4">
                  Drag and drop your KML file here, or click to browse
                </p>
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isProcessing}
                >
                  Select KML File
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-center gap-2">
                <FileText className="w-8 h-8 text-blue-600" />
                <div className="text-left">
                  <div className="font-medium text-gray-900">{fileName}</div>
                  <div className="flex items-center gap-2 mt-1">
                    {isProcessing && (
                      <>
                        <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                        <span className="text-sm text-gray-600">Processing...</span>
                      </>
                    )}
                    {parseStatus === 'success' && (
                      <>
                        <CheckCircle className="w-4 h-4 text-green-600" />
                        <span className="text-sm text-green-600">Successfully parsed</span>
                      </>
                    )}
                    {parseStatus === 'error' && (
                      <>
                        <AlertCircle className="w-4 h-4 text-red-600" />
                        <span className="text-sm text-red-600">Parse failed</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {parseResults && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 mt-4">
                  <h4 className="font-medium text-green-800 mb-2">Parse Results:</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm text-green-700">
                    <div>
                      <span className="font-medium">Controllers:</span> {parseResults.controllers.length}
                    </div>
                    <div>
                      <span className="font-medium">Zones:</span> {parseResults.zones.length}
                    </div>
                  </div>
                </div>
              )}

              <Button
                variant="outline"
                onClick={() => {
                  setFileName(null);
                  setParseStatus('idle');
                  setParseResults(null);
                  if (fileInputRef.current) {
                    fileInputRef.current.value = '';
                  }
                }}
                disabled={isProcessing}
              >
                Upload Different File
              </Button>
            </div>
          )}
        </div>

        <div className="mt-6 text-xs text-gray-500 space-y-2">
          <p><strong>Supported KML Features:</strong></p>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li>Point markers for irrigation controllers</li>
            <li>Polygon/LineString shapes for irrigation zones</li>
            <li>Placemark descriptions with controller/zone details</li>
            <li>Folder organization and nested structures</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}