import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Upload, X, Image, FileText, Eye, Loader2, CheckCircle2, AlertCircle, RotateCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { safeGet } from "@/utils/safeStorage";
import { PhotoImage, usePhotoSignedUrls } from "@/components/ui/photo-image";
import { preparePhotoForUpload, type PreparedPhoto } from "@/lib/photo-prep";

// `preparePhotoForUpload` lives in `@/lib/photo-prep` so the same display
// prep is shared with the billing-sheet upload path.

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
  capture?: 'user' | 'environment';
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
  | "retrying"
  | "done"
  | "error"
  | "cancelled";

// Reuse a previously minted signed URL on retry only while it is still
// comfortably within its server-side TTL (currently 900s — see
// ObjectStorageService.getPhotoUploadURL). 12 minutes leaves a 3-minute
// safety margin for slow networks finishing the actual PUT.
const SIGNED_URL_REUSE_MS = 12 * 60 * 1000;

interface PhotoSignedUrlData {
  signedUrl: string;
  canonicalUrl: string;
  originalName: string;
  mintedAt: number;
}

interface UploadJob {
  id: string;
  name: string;
  status: UploadJobStatus;
  progress: number; // 0-100
  errorMessage?: string;
  controller: AbortController;
  // --- Retry-support state ---
  kind: "photo" | "attachment";
  file: File;
  // Cached compressed/HEIC-converted bytes so retries don't re-prep.
  // Holds the single tight display copy that gets PUT to storage.
  prepared?: PreparedPhoto;
  // Cached signed-URL response so retries reuse the same canonical URL
  // (and skip a /api/upload/photo round-trip) while still fresh.
  signedUrlData?: PhotoSignedUrlData;
  // Persistent blob URL for photo previews — created once per job so the
  // gallery thumbnail stays stable across retries.
  previewUrl?: string;
  retryCount: number;
  // We auto-retry network failures at most once per job to avoid hammering
  // a still-flaky link. Manual "Retry" button clicks bypass this guard.
  autoRetried: boolean;
  // True when the last error was a network/connectivity failure (vs a
  // server 4xx/5xx). Drives the auto-retry-on-online behavior.
  wasNetworkError: boolean;
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
    case "retrying":
      return "Retrying…";
    case "done":
      return "Done";
    case "error":
      return j.errorMessage ? `Error: ${j.errorMessage}` : "Error";
    case "cancelled":
      return "Cancelled";
  }
}

function classifyAsNetworkError(err: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (err instanceof Error) {
    const m = err.message.toLowerCase();
    if (m.includes("network error") || m.includes("failed to fetch") || m.includes("networkerror")) {
      return true;
    }
  }
  return false;
}

export function FileUpload({ type, label, accept, multiple = true, capture, files = [], onFilesChange }: FileUploadProps) {
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [lightboxName, setLightboxName] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const photoUrls = type === 'photo' && Array.isArray(files)
    ? files.filter(f => !f.previewUrl).map(f => f.url)
    : [];
  const { getUrl: getPhotoSignedUrl } = usePhotoSignedUrls(photoUrls, "thumb");

  // jobsRef is the source of truth read by async upload pipelines and the
  // 'online' listener — they need the freshest list synchronously, before
  // React commits a setState. Every mutation goes through `mutateJobs` so
  // the ref and React state stay perfectly in sync.
  const jobsRef = useRef<UploadJob[]>([]);
  const filesRef = useRef<UploadedFile[]>(Array.isArray(files) ? files : []);
  useEffect(() => { filesRef.current = Array.isArray(files) ? files : []; }, [files]);
  const onFilesChangeRef = useRef(onFilesChange);
  useEffect(() => { onFilesChangeRef.current = onFilesChange; }, [onFilesChange]);
  const multipleRef = useRef(multiple);
  useEffect(() => { multipleRef.current = multiple; }, [multiple]);

  const mutateJobs = (updater: (prev: UploadJob[]) => UploadJob[]) => {
    const next = updater(jobsRef.current);
    jobsRef.current = next;
    setJobs(next);
  };

  // Unmount cleanup: revoke any preview blobs still attached to live jobs.
  useEffect(() => {
    return () => {
      for (const j of jobsRef.current) {
        if (j.previewUrl) {
          try { URL.revokeObjectURL(j.previewUrl); } catch {}
        }
      }
    };
  }, []);

  const isUploading = jobs.some(j =>
    j.status === "queued" || j.status === "preparing" || j.status === "uploading"
    || j.status === "finalizing" || j.status === "retrying"
  );

  const updateJob = (id: string, patch: Partial<UploadJob>) => {
    mutateJobs(prev => prev.map(j => (j.id === id ? { ...j, ...patch } : j)));
  };

  const cancelJob = (id: string) => {
    mutateJobs(prev => prev.map(j => {
      if (j.id !== id) return j;
      if (j.status === "done" || j.status === "error" || j.status === "cancelled") return j;
      try { j.controller.abort(); } catch {}
      return { ...j, status: "cancelled" };
    }));
  };

  const dismissJob = (id: string) => {
    // Free the preview blob URL we created during the failed/cancelled
    // attempt. The persistent thumbnail used by the gallery for completed
    // uploads is never routed through this path.
    const job = jobsRef.current.find(j => j.id === id);
    if (job?.previewUrl) {
      try { URL.revokeObjectURL(job.previewUrl); } catch {}
    }
    mutateJobs(prev => prev.filter(j => j.id !== id));
  };

  // Runs the photo upload pipeline against a job, reusing any cached
  // prepared bytes / signed URL the job already has from a prior attempt.
  async function uploadPhoto(jobId: string): Promise<UploadedFile> {
    const startJob = jobsRef.current.find(j => j.id === jobId);
    if (!startJob) throw new Error("Job not found");
    const file = startJob.file;
    const controller = startJob.controller;

    // Persistent preview blob: created once per job so retries don't churn
    // the gallery thumbnail. We DO NOT revoke on error — the job (and its
    // preview) survives until the user dismisses or upload succeeds.
    let previewUrl = startJob.previewUrl;
    if (!previewUrl) {
      previewUrl = URL.createObjectURL(file);
      updateJob(jobId, { previewUrl });
    }

    // 1. Reserve (or reuse) signed upload URL.
    let signedData = startJob.signedUrlData;
    const stale = !signedData || (Date.now() - signedData.mintedAt) > SIGNED_URL_REUSE_MS;
    if (!signedData || stale) {
      updateJob(jobId, { status: "preparing", progress: 0 });
      const signUrlRes = await fetch(
        `/api/upload/photo?originalName=${encodeURIComponent(file.name)}`,
        {
          method: 'POST',
          headers: getAuthHeaders(),
          credentials: 'include',
          signal: controller.signal,
        },
      );
      if (!signUrlRes.ok) {
        const err = (await signUrlRes.json().catch(() => ({}))) as { message?: string };
        throw new Error(err.message || `Failed to get upload URL for ${file.name}`);
      }
      const body = await signUrlRes.json();
      signedData = {
        signedUrl: body.signedUrl,
        canonicalUrl: body.url,
        originalName: body.originalName || file.name,
        mintedAt: Date.now(),
      };
      updateJob(jobId, { signedUrlData: signedData });
    }

    // 2. Compress + (optional) HEIC conversion (cached on the job).
    let prepared = startJob.prepared;
    if (!prepared) {
      updateJob(jobId, { status: "preparing", progress: 0 });
      prepared = await preparePhotoForUpload(file, (pct) => {
        updateJob(jobId, { status: "preparing", progress: pct });
      });
      updateJob(jobId, { prepared });
    }

    if (controller.signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    // 3. Single upload: tight display copy to the canonical key. The
    // server generates `thumb`/`medium` from this in the finalize step.
    const { displayFile } = prepared;
    const totalBytes = displayFile.size;
    let lastPct = -1;
    const reportUpload = (loaded: number) => {
      const pct = totalBytes > 0
        ? Math.min(99, Math.round((loaded / totalBytes) * 100))
        : 0;
      if (pct !== lastPct) {
        lastPct = pct;
        updateJob(jobId, { status: "uploading", progress: pct });
      }
    };
    updateJob(jobId, { status: "uploading", progress: 0 });

    const displayPut = await xhrPut(signedData.signedUrl, displayFile, {
      contentType: displayFile.type || 'application/octet-stream',
      signal: controller.signal,
      onProgress: (loaded) => reportUpload(loaded),
    });

    if (!displayPut.ok) {
      throw new Error(`Failed to upload ${file.name} to storage`);
    }

    // 4. Finalize — server generates display variants in the background.
    // Fire-and-forget; we surface a brief "Finalizing…" so the user sees
    // a final transition before the row clears.
    updateJob(jobId, { status: "finalizing", progress: 100 });
    fetch('/api/upload/photo/finalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      credentials: 'include',
      body: JSON.stringify({ photoId: signedData.canonicalUrl }),
    }).catch((e) => console.warn('[file-upload] finalize call failed', e));

    return {
      url: signedData.canonicalUrl,
      fileName: signedData.canonicalUrl,
      originalName: signedData.originalName,
      previewUrl,
    };
  }

  async function uploadAttachment(jobId: string): Promise<UploadedFile> {
    const job = jobsRef.current.find(j => j.id === jobId);
    if (!job) throw new Error("Job not found");
    const file = job.file;
    const controller = job.controller;
    updateJob(jobId, { status: "uploading", progress: 0 });
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
          updateJob(jobId, { status: "uploading", progress: pct });
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

      if (controller.signal.aborted) {
        xhr.abort();
        return;
      }
      controller.signal.addEventListener('abort', () => xhr.abort(), { once: true });

      const formData = new FormData();
      formData.append(type, file);
      xhr.send(formData);
    });
  }

  // Run a single upload for the given job. Centralized so both initial
  // submission and retries share the same success/error/cancel handling.
  async function runUploadJob(jobId: string, opts: { isRetry?: boolean } = {}): Promise<"done" | "error" | "cancelled"> {
    const job = jobsRef.current.find(j => j.id === jobId);
    if (!job) return "cancelled";

    try {
      const result = job.kind === 'photo'
        ? await uploadPhoto(jobId)
        : await uploadAttachment(jobId);

      updateJob(jobId, {
        status: "done",
        progress: 100,
        errorMessage: undefined,
        wasNetworkError: false,
      });

      // Append to the parent's files list using the freshest snapshot so
      // a retry that lands minutes later doesn't clobber other uploads.
      const current = Array.isArray(filesRef.current) ? filesRef.current : [];
      onFilesChangeRef.current(multipleRef.current ? [...current, result] : [result]);

      if (opts.isRetry) {
        toast({
          title: "Retry succeeded",
          description: `${result.originalName} uploaded`,
        });
      }

      // Auto-clear the row shortly after success.
      setTimeout(() => {
        mutateJobs(prev => prev.filter(j => j.id !== jobId));
      }, 1500);
      return "done";
    } catch (err: unknown) {
      const isAbortError =
        (err instanceof DOMException && err.name === 'AbortError')
        || (err instanceof Error && err.name === 'AbortError');
      const latest = jobsRef.current.find(j => j.id === jobId);
      const aborted = latest?.controller.signal.aborted || isAbortError;
      if (aborted) {
        updateJob(jobId, { status: "cancelled" });
        return "cancelled";
      }
      const message = err instanceof Error ? err.message : "Upload failed";
      const networkError = classifyAsNetworkError(err);
      updateJob(jobId, {
        status: "error",
        errorMessage: message,
        wasNetworkError: networkError,
      });
      return "error";
    }
  }

  // Manual or programmatic retry for a single job. Resets the abort
  // controller (the previous one may have fired) and reuses cached
  // prepared bytes + signed URL when still fresh.
  async function retryJob(jobId: string): Promise<void> {
    const job = jobsRef.current.find(j => j.id === jobId);
    if (!job) return;
    if (job.status !== "error" && job.status !== "cancelled") return;
    // If the cached signed URL has aged out, drop it so uploadPhoto mints
    // a fresh one on this attempt.
    const stillFresh = job.signedUrlData
      && (Date.now() - job.signedUrlData.mintedAt) <= SIGNED_URL_REUSE_MS;
    updateJob(jobId, {
      status: "retrying",
      progress: 0,
      errorMessage: undefined,
      controller: new AbortController(),
      retryCount: job.retryCount + 1,
      signedUrlData: stillFresh ? job.signedUrlData : undefined,
    });
    await runUploadJob(jobId, { isRetry: true });
  }

  // Auto-retry once when the browser reports it's back online. We only
  // touch jobs whose last failure was a network error AND that haven't
  // already been auto-retried, so manual retries remain the user's lever
  // for repeated failures.
  useEffect(() => {
    const handleOnline = () => {
      const candidates = jobsRef.current.filter(j =>
        j.status === "error" && j.wasNetworkError && !j.autoRetried
      );
      if (candidates.length === 0) return;
      // Mark first so a flapping connection doesn't trigger duplicate retries.
      const ids = new Set(candidates.map(c => c.id));
      mutateJobs(prev => prev.map(j =>
        ids.has(j.id) ? { ...j, autoRetried: true } : j
      ));
      candidates.forEach(c => { void retryJob(c.id); });
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFileSelect = async (selectedFiles: FileList | null) => {
    if (!selectedFiles?.length) return;

    const batchStart = Date.now();
    const newJobs: UploadJob[] = Array.from(selectedFiles).map((f, i) => ({
      id: `${batchStart}-${i}-${f.name}`,
      name: f.name,
      status: "queued" as UploadJobStatus,
      progress: 0,
      controller: new AbortController(),
      kind: type,
      file: f,
      retryCount: 0,
      autoRetried: false,
      wasNetworkError: false,
    }));
    mutateJobs(prev => [...prev, ...newJobs]);

    let successCount = 0;
    let errorCount = 0;
    let cancelledCount = 0;

    try {
      for (const job of newJobs) {
        if (job.controller.signal.aborted) {
          updateJob(job.id, { status: "cancelled" });
          cancelledCount++;
          continue;
        }
        const outcome = await runUploadJob(job.id);
        if (outcome === "done") successCount++;
        else if (outcome === "error") errorCount++;
        else cancelledCount++;
      }

      if (successCount > 0) {
        toast({
          title: "Upload Successful",
          description: `${successCount} file${successCount > 1 ? 's' : ''} uploaded successfully`,
        });
      }
      if (errorCount > 0) {
        toast({
          title: "Some uploads failed",
          description: `${errorCount} file${errorCount > 1 ? 's' : ''} could not be uploaded — tap Retry to try again`,
          variant: "destructive",
        });
      }
      if (cancelledCount > 0 && successCount === 0 && errorCount === 0) {
        toast({
          title: "Upload Cancelled",
          description: `${cancelledCount} file${cancelledCount > 1 ? 's' : ''} cancelled`,
        });
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
        capture={capture}
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
              || job.status === "finalizing"
              || job.status === "retrying";
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
                          : job.status === "retrying" ? "text-blue-600"
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
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => { void retryJob(job.id); }}
                          className="h-6 px-2 text-xs gap-1"
                          title="Retry upload"
                          data-testid={`button-retry-upload-${job.id}`}
                        >
                          <RotateCw className="w-3 h-3" />
                          Retry
                        </Button>
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
                      </>
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
