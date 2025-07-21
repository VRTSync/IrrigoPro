import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Upload, X, Image, FileText, Eye } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface FileUploadProps {
  type: 'photo' | 'attachment';
  label: string;
  accept?: string;
  multiple?: boolean;
  files: UploadedFile[];
  onFilesChange: (files: UploadedFile[]) => void;
}

export interface UploadedFile {
  url: string;
  fileName: string;
  originalName: string;
}

export function FileUpload({ type, label, accept, multiple = true, files, onFilesChange }: FileUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFileSelect = async (selectedFiles: FileList | null) => {
    if (!selectedFiles?.length) return;

    setIsUploading(true);
    const uploadedFiles: UploadedFile[] = [];

    try {
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        const formData = new FormData();
        formData.append(type, file);

        const response = await fetch(`/api/upload/${type}`, {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.message || `Failed to upload ${file.name}`);
        }

        const uploadedFile = await response.json();
        uploadedFiles.push(uploadedFile);
      }

      onFilesChange(multiple ? [...files, ...uploadedFiles] : uploadedFiles);
      
      toast({
        title: "Upload Successful",
        description: `${uploadedFiles.length} file${uploadedFiles.length > 1 ? 's' : ''} uploaded successfully`,
      });
    } catch (error: any) {
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to upload files",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const removeFile = (index: number) => {
    const updatedFiles = files.filter((_, i) => i !== index);
    onFilesChange(updatedFiles);
  };

  const openFile = (url: string) => {
    window.open(url, '_blank');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="flex items-center gap-2"
        >
          <Upload className="w-4 h-4" />
          {isUploading ? "Uploading..." : `Add ${label}`}
        </Button>
        {type === 'photo' && (
          <span className="text-sm text-gray-500">Accepted: JPG, PNG, GIF</span>
        )}
        {type === 'attachment' && (
          <span className="text-sm text-gray-500">Landscape plans, documents, etc.</span>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={(e) => handleFileSelect(e.target.files)}
        className="hidden"
      />

      {files.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {files.map((file, index) => (
            <Card key={index} className="relative">
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {type === 'photo' ? (
                      <Image className="w-4 h-4 text-blue-500 flex-shrink-0" />
                    ) : (
                      <FileText className="w-4 h-4 text-green-500 flex-shrink-0" />
                    )}
                    <span className="text-sm truncate" title={file.originalName}>
                      {file.originalName}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => openFile(file.url)}
                      className="h-6 w-6 p-0"
                    >
                      <Eye className="w-3 h-3" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeFile(index)}
                      className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
                {type === 'photo' && (
                  <div className="mt-2">
                    <img
                      src={file.url}
                      alt={file.originalName}
                      className="w-full h-24 object-cover rounded border"
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {files.length > 0 && (
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Badge variant="outline">
            {files.length} {type === 'photo' ? 'photo' : 'attachment'}{files.length > 1 ? 's' : ''}
          </Badge>
          {type === 'photo' && <span>Photos will be displayed in estimate/work order details</span>}
          {type === 'attachment' && <span>Attachments available for download and reference</span>}
        </div>
      )}
    </div>
  );
}