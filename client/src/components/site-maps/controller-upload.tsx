import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload, FileText, AlertCircle, CheckCircle, Settings } from "lucide-react";
import { KMLParser, type ParsedKMLData } from "@/lib/kml-parser";
import { useToast } from "@/hooks/use-toast";

interface ControllerUploadProps {
  onKMLParsed: (data: ParsedKMLData) => void;
  onFileSelected: (file: File) => void;
}

export function ControllerUpload({ onKMLParsed, onFileSelected }: ControllerUploadProps) {
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
        title: "Controller KML Processed",
        description: `Found ${parsedData.controllers.length} controllers`,
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
          <Settings className="w-5 h-5 text-blue-600" />
          Step 1: Upload Controllers KML
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
                <Settings className="w-12 h-12 text-blue-400" />
              </div>
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  Upload Controllers KML File
                </h3>
                <p className="text-gray-600 mb-4">
                  Start by uploading a KML file containing all irrigation controller locations
                </p>
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isProcessing}
                >
                  Select Controllers KML
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
                        <span className="text-sm text-green-600">Successfully processed</span>
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
                  <h4 className="font-medium text-green-800 mb-2">Controllers Found:</h4>
                  <div className="text-sm text-green-700">
                    <span className="font-medium">{parseResults.controllers.length}</span> irrigation controllers ready for zone assignment
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

        <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <h4 className="font-medium text-blue-800 mb-2">Controller KML Requirements:</h4>
          <ul className="text-sm text-blue-700 space-y-1">
            <li>• Use Point placemarks to mark each controller location</li>
            <li>• Name each controller clearly (e.g., "Main Controller", "Back Yard Controller")</li>
            <li>• Include details in description: Model, Serial Number, Station Count</li>
            <li>• Example: "Model: Rain Bird ESP-6TM, Serial: 12345, Stations: 8"</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}