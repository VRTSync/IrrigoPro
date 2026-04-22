import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Upload, X, Image, FileText, Eye } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { safeGet } from "@/utils/safeStorage";
import { PhotoImage, usePhotoSignedUrls } from "@/components/ui/photo-image";
import imageCompression from "browser-image-compression";

// Best-effort client-side photo prep: HEIC → JPEG, then downscale & re-encode
// to keep uploads small enough to succeed on weak LTE. Falls back to the
// original file bytes if anything goes wrong.
async function preparePhotoForUpload(file: File): Promise<File> {
  let working: File = file;
  const lowerName = file.name.toLowerCase();
  const looksHeic = file.type === "image/heic" || file.type === "image/heif"
    || lowerName.endsWith(".heic") || lowerName.endsWith(".heif");

  if (looksHeic) {
    try {
      // heic2any is browser-only and has a heavy WASM payload — load it lazily.
      const heic2any = (await import("heic2any")).default;
      const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
      const blob = Array.isArray(converted) ? converted[0] : converted;
      working = new File([blob], file.name.replace(/\.(heic|heif)$/i, ".jpg"), { type: "image/jpeg" });
    } catch (err) {
      console.warn("[file-upload] HEIC conversion failed, falling back to original bytes", err);
      // Fall through with the original file — the server will still handle HEIC.
    }
  }

  try {
    const compressed = await imageCompression(working, {
      maxSizeMB: 0.5,
      maxWidthOrHeight: 2048,
      useWebWorker: true,
      initialQuality: 0.85,
      fileType: working.type === "image/png" ? "image/jpeg" : undefined,
    });
    if (compressed instanceof File) return compressed;
    return new File([compressed], working.name, { type: compressed.type || working.type });
  } catch (err) {
    console.warn("[file-upload] image compression failed, uploading original bytes", err);
    return working;
  }
}

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
  const photoUrls = type === 'photo' && Array.isArray(files)
    ? files.filter(f => !f.previewUrl).map(f => f.url)
    : [];
  const { getUrl: getPhotoSignedUrl } = usePhotoSignedUrls(photoUrls, "thumb");

  const handleFileSelect = async (selectedFiles: FileList | null) => {
    if (!selectedFiles?.length) return;

    setIsUploading(true);
    const uploadedFiles: UploadedFile[] = [];

    try {
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];

        if (type === 'photo') {
          // Instant local preview from the original picked file.
          const previewUrl = URL.createObjectURL(file);

          const signUrlRes = await fetch(
            `/api/upload/photo?originalName=${encodeURIComponent(file.name)}`,
            { method: 'POST', headers: getAuthHeaders(), credentials: 'include' }
          );
          if (!signUrlRes.ok) {
            URL.revokeObjectURL(previewUrl);
            const err = await signUrlRes.json();
            throw new Error(err.message || `Failed to get upload URL for ${file.name}`);
          }
          const { signedUrl, originalSignedUrl, url: canonicalUrl, originalName } = await signUrlRes.json();

          // Dual-upload: untouched original bytes go to `originals/` so the
          // preserved copy is exactly what the camera produced (EXIF/GPS
          // intact, no re-encode). The display source is the compressed +
          // HEIC-converted variant — used only for fast transfer and
          // server-side thumb/medium generation.
          const prepared = await preparePhotoForUpload(file);

          const [originalPut, displayPut] = await Promise.all([
            originalSignedUrl
              ? fetch(originalSignedUrl, {
                  method: 'PUT',
                  body: file,
                  headers: { 'Content-Type': file.type || 'application/octet-stream' },
                })
              : Promise.resolve({ ok: true } as Response),
            fetch(signedUrl, {
              method: 'PUT',
              body: prepared,
              headers: { 'Content-Type': prepared.type || 'application/octet-stream' },
            }),
          ]);
          if (!displayPut.ok) {
            URL.revokeObjectURL(previewUrl);
            throw new Error(`Failed to upload ${file.name} to storage`);
          }
          if (!originalPut.ok) {
            // Non-fatal: display variants will still be generated. Log so
            // ops can spot photos missing their preserved original.
            console.warn(`[file-upload] preserved-original PUT failed for ${file.name}`);
          }

          // Fire-and-forget: ask the server to generate display variants.
          // Variant generation runs in the background on the server too —
          // we never block the UX.
          fetch('/api/upload/photo/finalize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            credentials: 'include',
            body: JSON.stringify({ photoId: canonicalUrl }),
          }).catch((e) => console.warn('[file-upload] finalize call failed', e));

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
                        variant="thumb"
                        batchManaged
                        signedUrlOverride={getPhotoSignedUrl(file.url)}
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
