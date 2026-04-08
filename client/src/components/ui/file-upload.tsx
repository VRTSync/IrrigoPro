import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Upload, X, Image, FileText, Eye } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { safeGet } from "@/utils/safeStorage";
import { PhotoImage } from "@/components/ui/photo-image";

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  try {
    const saved = safeGet("user");
    if (saved) {
      const user = JSON.parse(saved);
      if (user?.role) {
        headers["x-user-role"] = user.role;
        headers["x-user-id"] = user.id?.toString() || "";
        headers["x-user-name"] = user.name || "";
        headers["x-user-company-id"] = user.companyId?.toString() || "";
      }
    }
  } catch {
  }
  return headers;
}

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
  previewUrl?: string;
}

export function FileUpload({ type, label, accept, multiple = true, files = [], onFilesChange }: FileUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [lightboxName, setLightboxName] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFileSelect = async (selectedFiles: FileList | null) => {
    if (!selectedFiles?.length) return;

    setIsUploading(true);
    const uploadedFiles: UploadedFile[] = [];

    try {
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];

        if (type === 'photo') {
          // Create a blob URL immediately for instant preview
          const previewUrl = URL.createObjectURL(file);

          // GCS-backed flow: request a signed PUT URL, then PUT directly to GCS
          const signUrlRes = await fetch(
            `/api/upload/photo?originalName=${encodeURIComponent(file.name)}`,
            { method: 'POST', headers: getAuthHeaders(), credentials: 'include' }
          );
          if (!signUrlRes.ok) {
            URL.revokeObjectURL(previewUrl);
            const err = await signUrlRes.json();
            throw new Error(err.message || `Failed to get upload URL for ${file.name}`);
          }
          const { signedUrl, url: canonicalUrl, originalName } = await signUrlRes.json();

          // PUT the file directly to GCS
          const putRes = await fetch(signedUrl, {
            method: 'PUT',
            body: file,
            headers: { 'Content-Type': file.type || 'application/octet-stream' },
          });
          if (!putRes.ok) {
            URL.revokeObjectURL(previewUrl);
            throw new Error(`Failed to upload ${file.name} to storage`);
          }

          uploadedFiles.push({
            url: canonicalUrl,
            fileName: canonicalUrl,
            originalName: originalName || file.name,
            previewUrl,
          });
        } else {
          // Attachment: use existing multipart upload route
          const formData = new FormData();
          formData.append(type, file);

          const response = await fetch(`/api/upload/${type}`, {
            method: 'POST',
            body: formData,
            headers: getAuthHeaders(),
            credentials: 'include',
          });

          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || `Failed to upload ${file.name}`);
          }

          const uploadedFile = await response.json();
          uploadedFiles.push(uploadedFile);
        }
      }

      onFilesChange(multiple ? [...(Array.isArray(files) ? files : []), ...uploadedFiles] : uploadedFiles);
      
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
    const fileArray = Array.isArray(files) ? files : [];
    const fileToRemove = fileArray[index];
    if (fileToRemove?.previewUrl) {
      URL.revokeObjectURL(fileToRemove.previewUrl);
    }
    const updatedFiles = fileArray.filter((_, i) => i !== index);
    onFilesChange(updatedFiles);
  };

  const openFile = (file: UploadedFile) => {
    if (type === 'photo') {
      setLightboxUrl(file.previewUrl || file.url);
      setLightboxName(file.originalName);
    } else {
      window.open(file.url, '_blank');
    }
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

      {Array.isArray(files) && files.length > 0 && (
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
                      onClick={() => openFile(file)}
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
                  <div className="mt-2 cursor-pointer" onClick={() => openFile(file)}>
                    {file.previewUrl ? (
                      <img
                        src={file.previewUrl}
                        alt={file.originalName}
                        className="w-full h-24 object-cover rounded border"
                      />
                    ) : (
                      <PhotoImage
                        photoUrl={file.url}
                        alt={file.originalName}
                        className="w-full h-24 object-cover rounded border"
                      />
                    )}
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

      <Dialog open={!!lightboxUrl} onOpenChange={() => setLightboxUrl(null)}>
        <DialogContent className="max-w-3xl w-[95vw] p-4">
          <DialogHeader>
            <DialogTitle className="text-sm font-medium truncate pr-8">{lightboxName}</DialogTitle>
          </DialogHeader>
          {lightboxUrl && (
            <div className="flex items-center justify-center">
              {lightboxUrl.startsWith('blob:') ? (
                <img
                  src={lightboxUrl}
                  alt={lightboxName}
                  className="max-w-full max-h-[75vh] object-contain rounded"
                />
              ) : (
                <PhotoImage
                  photoUrl={lightboxUrl}
                  alt={lightboxName}
                  className="max-w-full max-h-[75vh] object-contain rounded"
                />
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
