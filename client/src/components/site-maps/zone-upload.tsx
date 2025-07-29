import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Upload, FileText, AlertCircle, CheckCircle, Droplets, Plus } from "lucide-react";
import { KMLParser, type ParsedKMLData } from "@/lib/kml-parser";
import { useToast } from "@/hooks/use-toast";

interface ColoredController {
  id: string;
  name: string;
  color: string;
  model?: string;
  stationCount?: number;
}

interface ZoneUploadProps {
  controllers: ColoredController[];
  onZoneKMLParsed: (data: ParsedKMLData, controllerId: string) => void;
  uploadingFor: string | null;
  onStartUpload: (controllerId: string) => void;
  zonesByController: { [controllerId: string]: any[] };
}

export function ZoneUpload({ 
  controllers, 
  onZoneKMLParsed, 
  uploadingFor, 
  onStartUpload,
  zonesByController 
}: ZoneUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseStatus, setParseStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [parseResults, setParseResults] = useState<ParsedKMLData | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const uploadingController = controllers.find(c => c.id === uploadingFor);

  const handleFileSelect = async (file: File) => {
    if (!uploadingFor) {
      toast({
        title: "No Controller Selected",
        description: "Please select a controller first",
        variant: "destructive",
      });
      return;
    }

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

    try {
      const parsedData = await KMLParser.parseKMLFile(file);
      setParseResults(parsedData);
      setParseStatus('success');
      onZoneKMLParsed(parsedData, uploadingFor);
      
      toast({
        title: "Zone KML Processed",
        description: `Added ${parsedData.zones.length} zones to ${uploadingController?.name}`,
      });
    } catch (error) {
      setParseStatus('error');
      console.error("Full zone KML processing error:", error);
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

  if (controllers.length === 0) {
    return (
      <Card className="opacity-60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-gray-500">
            <Droplets className="w-5 h-5" />
            Step 2: Upload Zone KML Files
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-gray-500">Upload controllers first to enable zone uploads</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Droplets className="w-5 h-5 text-green-600" />
          Step 2: Upload Zone KML Files
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Controller Selection */}
        <div className="mb-6">
          <h4 className="font-medium text-gray-900 mb-3">Select Controller for Zone Upload:</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {controllers.map((controller) => {
              const zoneCount = zonesByController[controller.id]?.length || 0;
              const isSelected = uploadingFor === controller.id;
              
              return (
                <div
                  key={controller.id}
                  className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                    isSelected
                      ? 'border-blue-500 bg-blue-50 shadow-md'
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                  onClick={() => onStartUpload(controller.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-4 h-4 rounded-full border-2 border-white shadow-sm"
                        style={{ backgroundColor: controller.color }}
                      />
                      <div>
                        <div className="font-medium text-gray-900">{controller.name}</div>
                        {controller.model && (
                          <div className="text-xs text-gray-500">{controller.model}</div>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge variant="outline" className="text-xs">
                        {zoneCount} zones
                      </Badge>
                      {zoneCount === 0 && (
                        <div className="text-xs text-orange-600 mt-1">No zones</div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Upload Area */}
        {uploadingFor ? (
          <div>
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: uploadingController?.color }}
                />
                <span className="text-sm font-medium text-blue-800">
                  Uploading zones for: {uploadingController?.name}
                </span>
              </div>
            </div>

            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                isDragging
                  ? 'border-green-500 bg-green-50'
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
                    <Droplets className="w-12 h-12 text-green-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">
                      Upload Zones KML
                    </h3>
                    <p className="text-gray-600 mb-4">
                      Upload zones for {uploadingController?.name}
                    </p>
                    <Button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isProcessing}
                      style={{ backgroundColor: uploadingController?.color }}
                      className="text-white hover:opacity-90"
                    >
                      Select Zone KML File
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-center gap-2">
                    <FileText className="w-8 h-8 text-green-600" />
                    <div className="text-left">
                      <div className="font-medium text-gray-900">{fileName}</div>
                      <div className="flex items-center gap-2 mt-1">
                        {isProcessing && (
                          <>
                            <div className="w-4 h-4 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
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
                      <h4 className="font-medium text-green-800 mb-2">Zones Added:</h4>
                      <div className="text-sm text-green-700">
                        <span className="font-medium">{parseResults.zones.length}</span> zones added to {uploadingController?.name}
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
          </div>
        ) : (
          <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-lg">
            <Plus className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500">Select a controller above to upload its zone KML file</p>
          </div>
        )}

        <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
          <h4 className="font-medium text-green-800 mb-2">Zone KML Requirements:</h4>
          <ul className="text-sm text-green-700 space-y-1">
            <li>• Upload separate KML files for each controller's zones</li>
            <li>• Use Point placemarks to mark zone locations</li>
            <li>• Include zone details: Station number, Zone type, Coverage area</li>
            <li>• Example: "Station: 1, Type: Sprinkler, Coverage: Front lawn"</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}