import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Upload, X, Image, FileText, Eye, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { safeGet } from "@/utils/safeStorage";
import { PhotoImage, usePhotoSignedUrls } from "@/components/ui/photo-image";
import imageCompression from "browser-image-compression";

// Best-effort client-side photo prep: HEIC → JPEG, then downscale & re-encode
// to keep uploads small enough to succeed on weak LTE. Falls back to the
// original file bytes if anything goes wrong.
async function preparePhotoForUpload(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<File> {
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
      onProgress: (pct: number) => {
        if (onProgress) onProgress(Math.max(0, Math.min(100, Math.round(pct))));
      },
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

// XMLHttpRequest-based PUT so we can report upload progress and support
// cancellation via AbortSignal. fetch() doesn't expose upload progress in
// any browser we target.
function xhrPut(
  url: string,
  body: Blob | File,
  opts: {
    contentType?: string;
    signal?: AbortSignal;
    onProgress?: (loaded: number, total: number) => void;
  } = {},
): Promise<{ ok: boolean; status: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    if (opts.contentType) xhr.setRequestHeader("Content-Type", opts.contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && opts.onProgress) opts.onProgress(e.loaded, e.total);
    };
    xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status });
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    if (opts.signal) {
      if (opts.signal.aborted) {
        xhr.abort();
        return;
      }
      opts.signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    xhr.send(body);
  });
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

type UploadJobStatus =
  | "queued"
  | "preparing"
  | "uploading"
  | "finalizing"
  | "done"
  | "error"
  | "cancelled";

interface UploadJob {
  id: string;
  name: string;
  status: UploadJobStatus;
  progress: number; // 0-100
  errorMessage?: string;
  controller: AbortController;
}

function statusLabel(j: UploadJob): string {
  switch (j.status) {
    case "queued":
      return "Queued";
    case "preparing":
      return j.progress > 0 ? `Preparing ${j.progress}%` : "Preparing…";
    case "uploading":
      return `Uploading ${j.progress}%`;
    case "finalizing":
      return "Finalizing…";
    case "done":
      return "Done";
    case "error":
      return j.errorMessage ? `Error: ${j.errorMessage}` : "Error";
    case "cancelled":
      return "Cancelled";
  }
}

export function FileUpload({ type, label, accept, multiple = true, files = [], onFilesChange }: FileUploadProps) {
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [lightboxName, setLightboxName] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const photoUrls = type === 'photo' && Array.isArray(files)
    ? files.filter(f => !f.previewUrl).map(f => f.url)
    : [];
  const { getUrl: getPhotoSignedUrl } = usePhotoSignedUrls(photoUrls, "thumb");

  const isUploading = jobs.some(j =>
    j.status === "queued" || j.status === "preparing" || j.status === "uploading" || j.status === "finalizing"
  );

  const updateJob = (id: string, patch: Partial<UploadJob>) => {
    setJobs(prev => prev.map(j => (j.id === id ? { ...j, ...patch } : j)));
  };

  const cancelJob = (id: string) => {
    setJobs(prev => prev.map(j => {
      if (j.id !== id) return j;
      if (j.status === "done" || j.status === "error" || j.status === "cancelled") return j;
      try { j.controller.abort(); } catch {}
      return { ...j, status: "cancelled" };
    }));
  };

  const dismissJob = (id: string) => {
    setJobs(prev => prev.filter(j => j.id !== id));
  };

  async function uploadPhoto(file: File, job: UploadJob): Promise<UploadedFile> {
    const previewUrl = URL.createObjectURL(file);
    try {
      // 1. Reserve signed upload URL
      updateJob(job.id, { status: "preparing", progress: 0 });
      const signUrlRes = await fetch(
        `/api/upload/photo?originalName=${encodeURIComponent(file.name)}`,
        {
          method: 'POST',
          headers: getAuthHeaders(),
          credentials: 'include',
          signal: job.controller.signal,
        },
      );
      if (!signUrlRes.ok) {
        const err = (await signUrlRes.json().catch(() => ({}))) as { message?: string };
        throw new Error(err.message || `Failed to get upload URL for ${file.name}`);
      }
      const { signedUrl, originalSignedUrl, url: canonicalUrl, originalName } = await signUrlRes.json();

      // 2. Compress + (optional) HEIC conversion. Reports its own progress.
      const prepared = await preparePhotoForUpload(file, (pct) => {
        updateJob(job.id, { status: "preparing", progress: pct });
      });

      if (job.controller.signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      // 3. Dual upload: untouched original to `originals/`, compressed display
      // variant to the canonical key. Report combined progress weighted by
      // bytes so users on slow LTE see steady forward motion.
      const totalBytes = file.size + prepared.size;
      let origLoaded = 0;
      let dispLoaded = 0;
      let lastPct = -1;
      const reportUpload = () => {
        const pct = totalBytes > 0
          ? Math.min(99, Math.round(((origLoaded + dispLoaded) / totalBytes) * 100))
          : 0;
        if (pct !== lastPct) {
          lastPct = pct;
          updateJob(job.id, { status: "uploading", progress: pct });
        }
      };
      updateJob(job.id, { status: "uploading", progress: 0 });

      const [originalPut, displayPut] = await Promise.all([
        originalSignedUrl
          ? xhrPut(originalSignedUrl, file, {
              contentType: file.type || 'application/octet-stream',
              signal: job.controller.signal,
              onProgress: (loaded) => { origLoaded = loaded; reportUpload(); },
            })
          : Promise.resolve({ ok: true, status: 200 }),
        xhrPut(signedUrl, prepared, {
          contentType: prepared.type || 'application/octet-stream',
          signal: job.controller.signal,
          onProgress: (loaded) => { dispLoaded = loaded; reportUpload(); },
        }),
      ]);

      if (!displayPut.ok) {
        throw new Error(`Failed to upload ${file.name} to storage`);
      }
      if (!originalPut.ok) {
        // Non-fatal: display variants will still be generated. Log so ops
        // can spot photos missing their preserved original.
        console.warn(`[file-upload] preserved-original PUT failed for ${file.name}`);
      }

      // 4. Finalize — server generates display variants in the background.
      // Fire-and-forget; we surface a brief "Finalizing…" so the user sees
      // a final transition before the row clears.
      updateJob(job.id, { status: "finalizing", progress: 100 });
      fetch('/api/upload/photo/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        credentials: 'include',
        body: JSON.stringify({ photoId: canonicalUrl }),
      }).catch((e) => console.warn('[file-upload] finalize call failed', e));

      return {
        url: canonicalUrl,
        fileName: canonicalUrl,
        originalName: originalName || file.name,
        previewUrl,
      };
    } catch (err) {
      URL.revokeObjectURL(previewUrl);
      throw err;
    }
  }

  async function uploadAttachment(file: File, job: UploadJob): Promise<UploadedFile> {
    updateJob(job.id, { status: "uploading", progress: 0 });
    return new Promise<UploadedFile>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/upload/${type}`);
      const headers = getAuthHeaders();
      Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
      xhr.withCredentials = true;
      let lastPct = -1;
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const pct = Math.min(99, Math.round((e.loaded / e.total) * 100));
        if (pct !== lastPct) {
          lastPct = pct;
          updateJob(job.id, { status: "uploading", progress: pct });
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); }
          catch { reject(new Error("Invalid response from server")); }
        } else {
          let msg = `Failed to upload ${file.name}`;
          try {
            const err = JSON.parse(xhr.responseText);
            if (err?.message) msg = err.message;
          } catch {}
          reject(new Error(msg));
        }
      };
      xhr.onerror = () => reject(new Error("Network error during upload"));
      xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));

      if (job.controller.signal.aborted) {
        xhr.abort();
        return;
      }
      job.controller.signal.addEventListener('abort', () => xhr.abort(), { once: true });

      const formData = new FormData();
      formData.append(type, file);
      xhr.send(formData);
    });
  }

  const handleFileSelect = async (selectedFiles: FileList | null) => {
    if (!selectedFiles?.length) return;

    const batchStart = Date.now();
    const newJobs: UploadJob[] = Array.from(selectedFiles).map((f, i) => ({
      id: `${batchStart}-${i}-${f.name}`,
      name: f.name,
      status: "queued",
      progress: 0,
      controller: new AbortController(),
    }));
    setJobs(prev => [...prev, ...newJobs]);

    const uploadedFiles: UploadedFile[] = [];
    let errorCount = 0;
    let cancelledCount = 0;
    const completedJobIds: string[] = [];

    try {
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        const job = newJobs[i];

        if (job.controller.signal.aborted) {
          updateJob(job.id, { status: "cancelled" });
          cancelledCount++;
          continue;
        }

        try {
          const result = type === 'photo'
            ? await uploadPhoto(file, job)
            : await uploadAttachment(file, job);
          uploadedFiles.push(result);
          updateJob(job.id, { status: "done", progress: 100 });
          completedJobIds.push(job.id);
        } catch (err: unknown) {
          const isAbortError =
            (err instanceof DOMException && err.name === 'AbortError')
            || (err instanceof Error && err.name === 'AbortError');
          if (job.controller.signal.aborted || isAbortError) {
            updateJob(job.id, { status: "cancelled" });
            cancelledCount++;
          } else {
            const message = err instanceof Error ? err.message : "Upload failed";
            updateJob(job.id, {
              status: "error",
              errorMessage: message,
            });
            errorCount++;
          }
        }
      }

      if (uploadedFiles.length > 0) {
        onFilesChange(multiple ? [...(Array.isArray(files) ? files : []), ...uploadedFiles] : uploadedFiles);
        toast({
          title: "Upload Successful",
          description: `${uploadedFiles.length} file${uploadedFiles.length > 1 ? 's' : ''} uploaded successfully`,
        });
      }
      if (errorCount > 0) {
        toast({
          title: "Some uploads failed",
          description: `${errorCount} file${errorCount > 1 ? 's' : ''} could not be uploaded`,
          variant: "destructive",
        });
      }
      if (cancelledCount > 0 && uploadedFiles.length === 0 && errorCount === 0) {
        toast({
          title: "Upload Cancelled",
          description: `${cancelledCount} file${cancelledCount > 1 ? 's' : ''} cancelled`,
        });
      }

      // Auto-clear successful rows shortly after completion. Errors and
      // cancellations stay visible until the user dismisses them.
      if (completedJobIds.length > 0) {
        const idsToClear = new Set(completedJobIds);
        setTimeout(() => {
          setJobs(prev => prev.filter(j => !idsToClear.has(j.id)));
        }, 1500);
      }
    } finally {
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
          data-testid={`button-add-${type}`}
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

      {jobs.length > 0 && (
        <div className="space-y-2" data-testid="upload-progress-list">
          {jobs.map(job => {
            const inFlight =
              job.status === "queued"
              || job.status === "preparing"
              || job.status === "uploading"
              || job.status === "finalizing";
            const showBar =
              job.status === "preparing"
              || job.status === "uploading"
              || job.status === "finalizing";
            return (
              <div
                key={job.id}
                className="border rounded-md p-3 bg-muted/30"
                data-testid={`upload-job-${job.id}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {inFlight && (
                      <Loader2 className="w-4 h-4 animate-spin text-blue-500 flex-shrink-0" />
                    )}
                    {job.status === "done" && (
                      <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                    )}
                    {(job.status === "error" || job.status === "cancelled") && (
                      <AlertCircle className={`w-4 h-4 flex-shrink-0 ${job.status === "error" ? "text-red-600" : "text-gray-500"}`} />
                    )}
                    <span className="text-sm truncate" title={job.name}>{job.name}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span
                      className={`text-xs whitespace-nowrap ${
                        job.status === "error" ? "text-red-600"
                          : job.status === "cancelled" ? "text-gray-500"
                          : job.status === "done" ? "text-green-600"
                          : "text-gray-600"
                      }`}
                      data-testid={`upload-job-status-${job.id}`}
                    >
                      {statusLabel(job)}
                    </span>
                    {inFlight && job.status !== "finalizing" && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => cancelJob(job.id)}
                        className="h-6 w-6 p-0"
                        title="Cancel upload"
                        data-testid={`button-cancel-upload-${job.id}`}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    )}
                    {(job.status === "error" || job.status === "cancelled") && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => dismissJob(job.id)}
                        className="h-6 w-6 p-0"
                        title="Dismiss"
                        data-testid={`button-dismiss-upload-${job.id}`}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                </div>
                {showBar && (
                  <Progress
                    value={job.status === "finalizing" ? 100 : job.progress}
                    className="mt-2 h-1.5"
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

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
