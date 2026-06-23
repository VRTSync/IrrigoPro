import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  CheckCircle,
  XCircle,
  AlertCircle,
  Paperclip,
  ImageOff,
  Loader2,
  PenLine,
  Type,
  Trash2,
} from "lucide-react";
import { formatEstimateNumber } from "@workspace/shared";

function attachmentDisplayName(url: string): string {
  if (!url) return "attachment";
  try {
    const u = new URL(url, window.location.origin);
    const last = u.pathname.split("/").filter(Boolean).pop();
    if (last) return decodeURIComponent(last);
  } catch {
    // fall through
  }
  const last = url.split("/").filter(Boolean).pop();
  return last ? decodeURIComponent(last) : url;
}

function isLinkableUrl(url: string): boolean {
  if (!url) return false;
  try {
    const u = new URL(url, window.location.origin);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

type SignedPhoto = { photoId: string; url: string | null };

type EstimateView = {
  alreadyResponded: boolean;
  status: string;
  companyName?: string;
  approvalSignerName?: string | null;
  approvalSignedAt?: string | null;
  estimate: {
    id: number;
    estimateNumber: string;
    projectName: string;
    projectAddress: string | null;
    customerName: string;
    customerEmail: string;
    customerPhone: string | null;
    estimateDate: string | Date;
    workDescription: string | null;
    locationNotes: string | null;
    accessInstructions: string | null;
    totalAmount: string | number;
    totalLaborHours: string | number | null;
    laborRate: string | number | null;
    items: Array<{
      id: number;
      partName: string;
      description: string | null;
      quantity: string | number;
      partPrice: string | number;
      laborHours: string | number;
      totalPrice: string | number;
    }>;
  };
  photos: SignedPhoto[];
  attachments: string[];
};

type LoadState =
  | { kind: "loading" }
  | { kind: "not-found" }
  | { kind: "expired"; estimateNumber?: string }
  | { kind: "error"; message?: string }
  | { kind: "ready"; data: EstimateView };

type ActionState =
  | { kind: "idle" }
  | { kind: "sign-sheet-open" }
  | { kind: "pending"; action: "approve" | "reject" }
  | { kind: "approved"; estimateNumber: string; customerEmail: string; signerName?: string; signatureType?: string; signatureData?: string }
  | { kind: "rejected"; estimateNumber: string }
  | { kind: "already-approved"; signerName?: string; signedAt?: string }
  | { kind: "action-error"; message?: string };

function fmtCurrency(amount: string | number) {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Number.isFinite(n) ? n : 0,
  );
}
function fmtDate(d: string | Date) {
  try {
    return new Date(d).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return String(d);
  }
}

function buildConsentText(
  estimateNumber: string,
  total: string | number,
  companyName: string,
): string {
  const formattedTotal = fmtCurrency(total);
  const formattedNumber = formatEstimateNumber(estimateNumber);
  return (
    `I, the undersigned, authorize ${companyName} to proceed with the work described in ` +
    `Estimate ${formattedNumber} for a total estimated amount of ${formattedTotal}. ` +
    `I understand that additional findings discovered on site may adjust the final invoice. ` +
    `This approval constitutes a binding agreement to pay for the described services upon completion.`
  );
}

// ── Draw-mode canvas signature pad ───────────────────────────────────────────
function SignaturePad({
  onSigned,
  onClear,
}: {
  onSigned: (dataUrl: string) => void;
  onClear: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const hasStrokes = useRef(false);

  const getPos = (e: MouseEvent | TouchEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    if ("touches" in e) {
      const t = e.touches[0];
      return { x: t.clientX - rect.left, y: t.clientY - rect.top };
    }
    return { x: (e as MouseEvent).clientX - rect.left, y: (e as MouseEvent).clientY - rect.top };
  };

  const startDraw = useCallback((e: MouseEvent | TouchEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawing.current = true;
    const ctx = canvas.getContext("2d")!;
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  }, []);

  const draw = useCallback(
    (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      if (!drawing.current) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d")!;
      const pos = getPos(e, canvas);
      ctx.lineTo(pos.x, pos.y);
      ctx.strokeStyle = "#1f2937";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
      hasStrokes.current = true;
    },
    [],
  );

  const endDraw = useCallback(() => {
    if (!drawing.current) return;
    drawing.current = false;
    const canvas = canvasRef.current;
    if (!canvas || !hasStrokes.current) return;
    onSigned(canvas.toDataURL("image/png"));
  }, [onSigned]);

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasStrokes.current = false;
    onClear();
  }, [onClear]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const opts = { passive: false } as AddEventListenerOptions;
    canvas.addEventListener("mousedown", startDraw, opts);
    canvas.addEventListener("mousemove", draw, opts);
    canvas.addEventListener("mouseup", endDraw);
    canvas.addEventListener("mouseleave", endDraw);
    canvas.addEventListener("touchstart", startDraw, opts);
    canvas.addEventListener("touchmove", draw, opts);
    canvas.addEventListener("touchend", endDraw);
    return () => {
      canvas.removeEventListener("mousedown", startDraw);
      canvas.removeEventListener("mousemove", draw);
      canvas.removeEventListener("mouseup", endDraw);
      canvas.removeEventListener("mouseleave", endDraw);
      canvas.removeEventListener("touchstart", startDraw);
      canvas.removeEventListener("touchmove", draw);
      canvas.removeEventListener("touchend", endDraw);
    };
  }, [startDraw, draw, endDraw]);

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        width={520}
        height={160}
        className="w-full border-2 border-dashed border-gray-300 rounded-lg bg-white touch-none cursor-crosshair"
        style={{ height: 160 }}
        data-testid="signature-canvas"
      />
      <p className="text-xs text-gray-400 mt-1 text-center">Draw your signature above</p>
      <button
        type="button"
        onClick={clear}
        className="absolute top-2 right-2 text-gray-400 hover:text-gray-600 flex items-center gap-1 text-xs"
        data-testid="signature-clear-btn"
      >
        <Trash2 className="w-3.5 h-3.5" /> Clear
      </button>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function EstimateApproval() {
  const token = useMemo(() => {
    const pathParts = window.location.pathname.split("/");
    const t = pathParts[pathParts.length - 1];
    return !t || t === "estimate-approval" ? null : t;
  }, []);

  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [action, setAction] = useState<ActionState>({ kind: "idle" });

  // Signature sheet state
  const [sigMode, setSigMode] = useState<"draw" | "type">("draw");
  const [drawnData, setDrawnData] = useState<string | null>(null);
  const [typedName, setTypedName] = useState("");
  const [printedName, setPrintedName] = useState("");
  const [consentChecked, setConsentChecked] = useState(false);

  useEffect(() => {
    if (!token) {
      setLoad({ kind: "not-found" });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/estimates/view-by-token/${token}`, {
          method: "GET",
        });
        if (cancelled) return;
        if (res.status === 404) {
          setLoad({ kind: "not-found" });
          return;
        }
        if (res.status === 410) {
          const j = await res.json().catch(() => ({}));
          setLoad({ kind: "expired", estimateNumber: j?.estimateNumber });
          return;
        }
        if (!res.ok) {
          setLoad({ kind: "error" });
          return;
        }
        const data = (await res.json()) as EstimateView;
        setLoad({ kind: "ready", data });
      } catch (err) {
        if (!cancelled) setLoad({ kind: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const openSignSheet = () => {
    // Pre-fill printed name from typed mode if available
    setAction({ kind: "sign-sheet-open" });
  };

  // Prefill printed name from typed signature when in type mode.
  // Only syncs while the user hasn't manually overridden the field
  // (we track this via a flag stored in the ref below).
  const printedNameManuallyEdited = useRef(false);
  useEffect(() => {
    if (sigMode === "type" && !printedNameManuallyEdited.current) {
      setPrintedName(typedName);
    }
  }, [sigMode, typedName]);

  const signatureData = sigMode === "draw" ? drawnData : typedName.trim() || null;
  const canSubmit =
    !!signatureData &&
    printedName.trim().length > 0 &&
    consentChecked;

  const submitApprove = async () => {
    if (!token || !canSubmit || load.kind !== "ready") return;
    const { estimate, companyName } = load.data;

    // Build verbatim consent text using the real company name from the API
    const consentText = buildConsentText(
      estimate.estimateNumber,
      estimate.totalAmount,
      companyName ?? "IrrigoPro",
    );

    setAction({ kind: "pending", action: "approve" });
    try {
      const res = await fetch(`/api/estimates/approve-via-token/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signatureType: sigMode === "draw" ? "drawn" : "typed",
          signatureData: signatureData!,
          signerName: printedName.trim(),
          consentAccepted: true,
          consentText,
        }),
      });
      if (res.status === 409) {
        const j = await res.json().catch(() => ({}));
        setAction({
          kind: "already-approved",
          signerName: j?.signerName ?? printedName.trim() ?? undefined,
          signedAt: j?.signedAt ?? undefined,
        });
        return;
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setAction({ kind: "action-error", message: j?.message });
        return;
      }
      const j = await res.json();
      setAction({
        kind: "approved",
        estimateNumber: j?.estimateNumber ?? "",
        customerEmail: j?.customerEmail ?? "",
        signerName: printedName.trim(),
        signatureType: sigMode === "draw" ? "drawn" : "typed",
        signatureData: signatureData ?? undefined,
      });
    } catch {
      setAction({ kind: "action-error" });
    }
  };

  const submitReject = async () => {
    if (!token) return;
    setAction({ kind: "pending", action: "reject" });
    try {
      const res = await fetch(`/api/estimates/reject-via-token/${token}`, { method: "GET" });
      if (!res.ok) {
        setAction({ kind: "action-error" });
        return;
      }
      const est = load.kind === "ready" ? load.data.estimate.estimateNumber : "";
      setAction({ kind: "rejected", estimateNumber: est });
    } catch {
      setAction({ kind: "action-error" });
    }
  };

  const renderBody = () => {
    // ─── Action-result terminal states ────────────────────────────────
    if (action.kind === "approved") {
      return (
        <div className="text-center">
          <CheckCircle className="h-16 w-16 text-green-600 mx-auto mb-4" />
          <h1 className="text-3xl font-bold text-green-600 mb-4">Estimate Approved!</h1>
          {action.estimateNumber && (
            <p className="text-lg text-gray-700 mb-3">
              Thank you for approving estimate{" "}
              <strong>{formatEstimateNumber(action.estimateNumber)}</strong>.
            </p>
          )}
          {/* Echo signature back to customer */}
          {action.signerName && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4 text-left">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Your Signature</p>
              {action.signatureType === "drawn" && action.signatureData ? (
                <img
                  src={action.signatureData}
                  alt="Your signature"
                  className="max-h-20 border border-gray-200 rounded bg-white mb-2"
                />
              ) : (
                <p
                  className="text-2xl text-gray-800 mb-2"
                  style={{ fontFamily: "'Dancing Script', cursive, serif" }}
                  data-testid="typed-sig-echo"
                >
                  {action.signatureData ?? action.signerName}
                </p>
              )}
              <p className="text-sm text-gray-600">
                Signed by: <strong>{action.signerName}</strong>
              </p>
            </div>
          )}
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
            <p className="text-green-800 font-medium mb-2">What happens next?</p>
            <ul className="text-green-700 text-sm space-y-1 text-left">
              <li>• We will contact you soon with scheduling details</li>
              <li>• A work order will be created for your project</li>
              <li>• You'll receive confirmation via email</li>
            </ul>
          </div>
          {action.customerEmail && (
            <p className="text-gray-500 text-sm">
              A confirmation email has been sent to {action.customerEmail}
            </p>
          )}
        </div>
      );
    }
    if (action.kind === "rejected") {
      return (
        <div className="text-center">
          <XCircle className="h-16 w-16 text-gray-600 mx-auto mb-4" />
          <h1 className="text-3xl font-bold text-gray-700 mb-4">Estimate Declined</h1>
          {action.estimateNumber && (
            <p className="text-lg text-gray-700 mb-3">
              You declined estimate{" "}
              <strong>{formatEstimateNumber(action.estimateNumber)}</strong>. We have notified
              our team.
            </p>
          )}
        </div>
      );
    }
    if (action.kind === "already-approved") {
      return (
        <div className="text-center">
          <CheckCircle className="h-16 w-16 text-green-600 mx-auto mb-4" />
          <h1 className="text-3xl font-bold text-green-600 mb-4">Already Approved</h1>
          <p className="text-gray-700 mb-2">This estimate has already been approved.</p>
          {(action.signerName || action.signedAt) && (
            <p className="text-gray-500 text-sm">
              {action.signerName && (
                <>Signed by <strong>{action.signerName}</strong></>
              )}
              {action.signerName && action.signedAt && " on "}
              {action.signedAt && fmtDate(action.signedAt)}
            </p>
          )}
        </div>
      );
    }
    if (action.kind === "action-error") {
      return (
        <div className="text-center">
          <XCircle className="h-16 w-16 text-red-600 mx-auto mb-4" />
          <h1 className="text-3xl font-bold text-red-600 mb-4">Something went wrong</h1>
          <p className="text-gray-700">
            {action.message ?? "We couldn't record your response. Please contact us directly."}
          </p>
        </div>
      );
    }

    // ─── Load-state terminal screens ──────────────────────────────────
    if (load.kind === "loading") {
      return (
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Loading Your Estimate</h1>
          <p className="text-gray-600">Please wait…</p>
        </div>
      );
    }
    if (load.kind === "not-found") {
      return (
        <div className="text-center">
          <AlertCircle className="h-16 w-16 text-yellow-600 mx-auto mb-4" />
          <h1 className="text-3xl font-bold text-yellow-600 mb-4">Invalid Link</h1>
          <p className="text-gray-700">
            This approval link appears to be invalid. Please contact us if you need a new link.
          </p>
        </div>
      );
    }
    if (load.kind === "expired") {
      return (
        <div className="text-center">
          <AlertCircle className="h-16 w-16 text-yellow-600 mx-auto mb-4" />
          <h1 className="text-3xl font-bold text-yellow-600 mb-4">Link Expired</h1>
          <p className="text-gray-700">
            {load.estimateNumber
              ? `Estimate ${formatEstimateNumber(load.estimateNumber)} is no longer available for approval. `
              : ""}
            Please contact us to request a new estimate.
          </p>
        </div>
      );
    }
    if (load.kind === "error") {
      return (
        <div className="text-center">
          <XCircle className="h-16 w-16 text-red-600 mx-auto mb-4" />
          <h1 className="text-3xl font-bold text-red-600 mb-4">Error</h1>
          <p className="text-gray-700">
            We couldn't load your estimate. Please try the link again or contact us.
          </p>
        </div>
      );
    }

    // ─── Ready: render details + Approve/Reject ──────────────────────
    const { estimate, photos, attachments, alreadyResponded, status, companyName, approvalSignerName, approvalSignedAt } = load.data;
    const responseLabel =
      status === "approved" ? "approved" : status === "rejected" ? "declined" : "responded to";

    const consentText = buildConsentText(
      estimate.estimateNumber,
      estimate.totalAmount,
      companyName ?? "IrrigoPro",
    );

    return (
      <div className="space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">
            Estimate {formatEstimateNumber(estimate.estimateNumber)}
          </h1>
          <p className="text-gray-600">
            for {estimate.customerName} · {fmtDate(estimate.estimateDate)}
          </p>
        </div>

        {alreadyResponded && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
            You have already {responseLabel} this estimate.
            {status === "approved" && approvalSignerName && (
              <span className="block mt-1 text-blue-700">
                Signed by <strong>{approvalSignerName}</strong>
                {approvalSignedAt && <> on {fmtDate(approvalSignedAt)}</>}
              </span>
            )}
          </div>
        )}

        {/* Project */}
        <section>
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">
            Project
          </h2>
          <div className="text-gray-900 font-medium">{estimate.projectName}</div>
          {estimate.projectAddress && (
            <div className="text-gray-600 text-sm">{estimate.projectAddress}</div>
          )}
          {estimate.workDescription && (
            <p className="text-sm text-gray-700 mt-2 whitespace-pre-wrap">
              {estimate.workDescription}
            </p>
          )}
        </section>

        {/* Line items */}
        {estimate.items.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">
              Line Items
            </h2>
            <div className="overflow-x-auto border border-gray-200 rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-gray-700">
                    <th className="px-3 py-2">Part</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    <th className="px-3 py-2 text-right">Unit $</th>
                    <th className="px-3 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {estimate.items.map((it) => (
                    <tr key={it.id} className="border-t border-gray-100 align-top">
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-900">{it.partName}</div>
                        {it.description && (
                          <div className="text-xs text-gray-600 mt-0.5">{it.description}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">{it.quantity}</td>
                      <td className="px-3 py-2 text-right">{fmtCurrency(it.partPrice)}</td>
                      <td className="px-3 py-2 text-right font-medium">
                        {fmtCurrency(it.totalPrice)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end mt-3 text-base font-semibold text-gray-900">
              Total {fmtCurrency(estimate.totalAmount)}
            </div>
          </section>
        )}

        {/* Site photos */}
        {photos.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">
              Site Photos
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {photos.map((p, i) => (
                <a
                  key={`${p.photoId}-${i}`}
                  href={p.url ?? "#"}
                  target={p.url ? "_blank" : undefined}
                  rel={p.url ? "noopener noreferrer" : undefined}
                  onClick={(e) => {
                    if (!p.url) e.preventDefault();
                  }}
                  className="aspect-square rounded-md border border-gray-200 bg-gray-50 overflow-hidden flex items-center justify-center hover:ring-2 hover:ring-blue-300"
                  data-testid={`approval-photo-${i}`}
                >
                  {p.url ? (
                    <img
                      src={p.url}
                      alt={`Site photo ${i + 1}`}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <ImageOff className="w-5 h-5 text-gray-400" />
                  )}
                </a>
              ))}
            </div>
          </section>
        )}

        {/* Attachments */}
        {attachments.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">
              Attachments
            </h2>
            <ul className="space-y-1">
              {attachments.map((url, i) => {
                const name = attachmentDisplayName(url);
                const linkable = isLinkableUrl(url);
                return (
                  <li
                    key={`${url}-${i}`}
                    className="flex items-center gap-2 text-sm"
                    data-testid={`approval-attachment-${i}`}
                  >
                    <Paperclip className="w-4 h-4 text-gray-500 flex-shrink-0" />
                    {linkable ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline break-all"
                      >
                        {name}
                      </a>
                    ) : (
                      <span className="text-gray-700 break-all">{name}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Notes / terms */}
        {(estimate.locationNotes || estimate.accessInstructions) && (
          <section className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-1">
            {estimate.locationNotes && (
              <div>
                <span className="font-medium text-gray-800">Location notes:</span>{" "}
                {estimate.locationNotes}
              </div>
            )}
            {estimate.accessInstructions && (
              <div>
                <span className="font-medium text-gray-800">Access:</span>{" "}
                {estimate.accessInstructions}
              </div>
            )}
          </section>
        )}

        {/* Action buttons */}
        {!alreadyResponded && (
          <div className="flex flex-col-reverse sm:flex-row gap-3 pt-3 border-t border-gray-200">
            <Button
              variant="outline"
              className="w-full sm:flex-1 text-red-600 border-red-200 hover:bg-red-50"
              disabled={action.kind === "pending"}
              onClick={submitReject}
              data-testid="approval-reject-btn"
            >
              {action.kind === "pending" && action.action === "reject" ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <XCircle className="w-4 h-4 mr-2" />
              )}
              Decline Estimate
            </Button>
            <Button
              className="w-full sm:flex-1 bg-green-600 hover:bg-green-700 text-white"
              disabled={action.kind === "pending"}
              onClick={openSignSheet}
              data-testid="approval-approve-btn"
            >
              <CheckCircle className="w-4 h-4 mr-2" />
              Approve Estimate
            </Button>
          </div>
        )}

        {/* ── Sign-to-approve sheet ─────────────────────────────────── */}
        <Sheet
          open={action.kind === "sign-sheet-open"}
          onOpenChange={(open) => {
            if (!open) setAction({ kind: "idle" });
          }}
        >
          <SheetContent
            side="bottom"
            className="h-auto max-h-[95vh] overflow-y-auto rounded-t-2xl px-4 pt-4 pb-8"
          >
            <SheetHeader className="mb-4">
              <SheetTitle className="text-lg font-bold text-gray-900">
                Sign to Approve
              </SheetTitle>
              <p className="text-sm text-gray-500">
                Approve Estimate {formatEstimateNumber(estimate.estimateNumber)} for{" "}
                {fmtCurrency(estimate.totalAmount)}
              </p>
            </SheetHeader>

            {/* Draw / Type toggle */}
            <div className="flex gap-2 mb-4">
              <button
                type="button"
                onClick={() => setSigMode("draw")}
                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border text-sm font-medium transition-colors ${
                  sigMode === "draw"
                    ? "bg-blue-50 border-blue-400 text-blue-700"
                    : "border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
                data-testid="sig-mode-draw"
              >
                <PenLine className="w-4 h-4" /> Draw
              </button>
              <button
                type="button"
                onClick={() => setSigMode("type")}
                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border text-sm font-medium transition-colors ${
                  sigMode === "type"
                    ? "bg-blue-50 border-blue-400 text-blue-700"
                    : "border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
                data-testid="sig-mode-type"
              >
                <Type className="w-4 h-4" /> Type
              </button>
            </div>

            {/* Signature input area */}
            <div className="mb-4">
              {sigMode === "draw" ? (
                <SignaturePad
                  onSigned={(d) => setDrawnData(d)}
                  onClear={() => setDrawnData(null)}
                />
              ) : (
                <div>
                  <Input
                    placeholder="Type your name to sign"
                    value={typedName}
                    onChange={(e) => setTypedName(e.target.value)}
                    className="text-xl mb-1"
                    style={{ fontFamily: "'Dancing Script', cursive, serif" }}
                    data-testid="typed-signature-input"
                  />
                  {typedName && (
                    <p className="text-xs text-gray-400">
                      Preview:{" "}
                      <span style={{ fontFamily: "'Dancing Script', cursive, serif" }}>
                        {typedName}
                      </span>
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Printed name */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Printed Name <span className="text-red-500">*</span>
              </label>
              <Input
                placeholder="Your full name"
                value={printedName}
                onChange={(e) => {
                  printedNameManuallyEdited.current = true;
                  setPrintedName(e.target.value);
                }}
                data-testid="printed-name-input"
              />
            </div>

            {/* Consent checkbox */}
            <div className="flex items-start gap-3 mb-6 bg-gray-50 border border-gray-200 rounded-lg p-3">
              <Checkbox
                id="consent-check"
                checked={consentChecked}
                onCheckedChange={(v) => setConsentChecked(!!v)}
                className="mt-0.5 flex-shrink-0"
                data-testid="consent-checkbox"
              />
              <label
                htmlFor="consent-check"
                className="text-xs text-gray-700 leading-relaxed cursor-pointer"
              >
                {consentText}
              </label>
            </div>

            {/* Submit button */}
            <Button
              className="w-full bg-green-600 hover:bg-green-700 text-white"
              disabled={!canSubmit || action.kind === "pending"}
              onClick={submitApprove}
              data-testid="approve-submit-btn"
            >
              {action.kind === "pending" && action.action === "approve" ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle className="w-4 h-4 mr-2" />
              )}
              Approve &amp; Submit
            </Button>
          </SheetContent>
        </Sheet>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-start sm:items-center justify-center px-4 py-8">
      <Card className="w-full max-w-2xl bg-white shadow-lg">
        <CardContent className="p-6 sm:p-8">{renderBody()}</CardContent>
      </Card>
    </div>
  );
}
