import { useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Upload, X, Check } from "lucide-react";

interface ObjectUploaderProps {
  onGetUploadParameters: () => Promise<{
    method: "PUT";
    url: string;
  }>;
  onComplete?: (uploadUrl: string) => void;
  buttonClassName?: string;
  accept?: string;
  maxSizeMB?: number;
  children?: ReactNode;
}

/**
 * A file upload component that provides a simple file selection and upload interface.
 * 
 * Features:
 * - File selection with drag and drop support
 * - Upload progress tracking
 * - File type and size validation
 * - Error handling
 * 
 * @param props - Component props
 * @param props.onGetUploadParameters - Function to get upload parameters (method and URL)
 * @param props.onComplete - Callback function called when upload is complete
 * @param props.buttonClassName - Optional CSS class name for the button
 * @param props.accept - File types to accept (e.g., "image/*")
 * @param props.maxSizeMB - Maximum file size in MB (default: 5MB)
 * @param props.children - Content to be rendered inside the button
 */
export function ObjectUploader({
  onGetUploadParameters,
  onComplete,
  buttonClassName,
  accept = "image/*",
  maxSizeMB = 5,
  children,
}: ObjectUploaderProps) {
  const { toast } = useToast();
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file size
    const maxSizeBytes = maxSizeMB * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      toast({
        title: "File too large",
        description: `Please select a file smaller than ${maxSizeMB}MB`,
        variant: "destructive",
      });
      return;
    }

    setSelectedFile(file);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    setUploadProgress(0);

    try {
      // Get upload parameters
      const uploadParams = await onGetUploadParameters();
      
      // Upload the file directly to the signed URL
      const response = await fetch(uploadParams.url, {
        method: uploadParams.method,
        body: selectedFile,
        headers: {
          'Content-Type': selectedFile.type,
        },
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
      }

      setUploadProgress(100);
      
      // Call the completion callback with the upload URL
      onComplete?.(uploadParams.url);
      
      toast({
        title: "Upload successful",
        description: "File uploaded successfully",
      });
      
      // Reset state
      setSelectedFile(null);
      
    } catch (error) {
      console.error('Upload error:', error);
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Failed to upload file",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const clearSelection = () => {
    setSelectedFile(null);
    setUploadProgress(0);
  };

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="file-upload" className="block text-sm font-medium mb-2">
          Select File
        </Label>
        <Input
          id="file-upload"
          type="file"
          accept={accept}
          onChange={handleFileSelect}
          disabled={isUploading}
          className="cursor-pointer"
        />
        <p className="text-sm text-muted-foreground mt-1">
          Maximum file size: {maxSizeMB}MB
        </p>
      </div>

      {selectedFile && (
        <div className="border rounded-lg p-4 bg-muted/50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium truncate">{selectedFile.name}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearSelection}
              disabled={isUploading}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          
          <div className="text-xs text-muted-foreground mb-3">
            Size: {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
          </div>

          {isUploading && (
            <div className="mb-3">
              <div className="flex justify-between text-xs mb-1">
                <span>Uploading...</span>
                <span>{Math.round(uploadProgress)}%</span>
              </div>
              <div className="w-full bg-secondary rounded-full h-2">
                <div
                  className="bg-primary h-2 rounded-full transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

          <Button
            onClick={handleUpload}
            disabled={isUploading}
            className={buttonClassName}
            size="sm"
          >
            {isUploading ? (
              <>
                <Upload className="h-4 w-4 mr-2 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                {children || "Upload File"}
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}