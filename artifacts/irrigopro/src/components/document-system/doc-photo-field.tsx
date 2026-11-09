import { useEffect, useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { uploadPhotoToStorage } from "@/pages/wet-checks/helpers";
import { serverMessage } from "./constants";

export type PhotoUploadState = "idle" | "uploading" | "failed";

export interface DocPhotoFieldProps {
  /** Saved or freshly uploaded photo id. */
  photoId: string | null;
  onUploaded: (photoId: string) => void;
  /** Lets the flow block navigation while an upload is in flight or failed. */
  onStateChange?: (state: PhotoUploadState) => void;
  label?: string;
  testId?: string;
}

export function DocPhotoField({ photoId, onUploaded, onStateChange, label = "Clock photo", testId = "doc-photo" }: DocPhotoFieldProps) {
  // Local preview of the latest capture; forId is set once its upload succeeds.
  const [preview, setPreview] = useState<{ url: string | null; forId: string | null } | null>(null);
  const [state, setState] = useState<PhotoUploadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<File | null>(null);
  const urlRef = useRef<string | null>(null);
  const stateCb = useRef(onStateChange);
  stateCb.current = onStateChange;

  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);
  useEffect(() => { stateCb.current?.(state); }, [state]);

  const upload = async () => {
    const file = fileRef.current;
    if (!file) return;
    setError(null);
    setState("uploading");
    try {
      const id = await uploadPhotoToStorage(file);
      setPreview((p) => (p ? { ...p, forId: id } : p));
      fileRef.current = null;
      setState("idle");
      onUploaded(id);
    } catch (e) {
      setError(`Couldn't upload: ${serverMessage(e)}`);
      setState("failed");
    }
  };

  const select = (file: File | undefined) => {
    if (!file || state === "uploading") return;
    let local: string | null = null;
    try { local = URL.createObjectURL(file); } catch { local = null; }
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = local;
    fileRef.current = file;
    setPreview({ url: local, forId: null });
    void upload();
  };

  const discard = () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    fileRef.current = null;
    setPreview(null);
    setError(null);
    setState("idle");
  };

  const pending = state !== "idle";
  const src = pending && preview?.url
    ? preview.url
    : photoId
      ? (preview?.url && preview.forId === photoId ? preview.url : `/api/photos/${photoId}?variant=medium`)
      : null;

  return (
    <div className="flex flex-col gap-2">
      <label
        className="relative flex h-[320px] w-full cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 text-slate-600"
        data-testid={testId}
        aria-label={label}
      >
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          disabled={state === "uploading"}
          data-testid={`${testId}-input`}
          onChange={(e) => { select(e.target.files?.[0]); e.target.value = ""; }}
        />
        {src && <img src={src} alt={label} className="absolute inset-0 h-full w-full object-cover" data-testid={`${testId}-preview`} />}
        <span
          className={
            src
              ? "absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-slate-900/70 px-4 py-2 text-sm font-medium text-white"
              : "flex flex-col items-center gap-2 text-[15px] font-medium"
          }
        >
          {!src && <Camera className="h-9 w-9 text-primary" aria-hidden />}
          {src ? "Tap to retake" : "Tap to take photo"}
        </span>
        {state === "uploading" && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/75" data-testid={`${testId}-uploading`}>
            <Loader2 className="h-8 w-8 animate-spin text-primary" aria-label="Uploading" />
          </div>
        )}
      </label>
      {state === "failed" && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800" data-testid={`${testId}-error`}>
          <span className="min-w-0">{error}</span>
          <span className="flex gap-2">
            <Button type="button" size="sm" variant="outline" className="h-9" onClick={discard} data-testid={`${testId}-discard`}>Discard</Button>
            <Button type="button" size="sm" variant="outline" className="h-9 border-red-300 text-red-800" onClick={() => void upload()} data-testid={`${testId}-retry`}>Retry upload</Button>
          </span>
        </div>
      )}
    </div>
  );
}
