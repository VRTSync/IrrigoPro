import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  CheckCircle,
  XCircle,
  AlertCircle,
  Paperclip,
  ImageOff,
  Loader2,
} from "lucide-react";

// Task #666 — derive a human-readable filename from an attachment URL.
// Used both to label list rows and to decide whether the URL is safe
// to surface as a clickable link (we only render a link when the URL
// parses to http(s)).
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
  | { kind: "pending"; action: "approve" | "reject" }
  | { kind: "approved"; estimateNumber: string; customerEmail: string }
  | { kind: "rejected"; estimateNumber: string }
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

export default function EstimateApproval() {
  const token = useMemo(() => {
    const pathParts = window.location.pathname.split("/");
    const t = pathParts[pathParts.length - 1];
    return !t || t === "estimate-approval" ? null : t;
  }, []);

  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [action, setAction] = useState<ActionState>({ kind: "idle" });

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

  const submit = async (kind: "approve" | "reject") => {
    if (!token) return;
    setAction({ kind: "pending", action: kind });
    try {
      const path = kind === "approve" ? "approve-via-token" : "reject-via-token";
      const res = await fetch(`/api/estimates/${path}/${token}`, { method: "GET" });
      const ct = res.headers.get("content-type") || "";
      if (!res.ok) {
        setAction({ kind: "action-error" });
        return;
      }
      if (kind === "approve" && ct.includes("application/json")) {
        const j = await res.json();
        setAction({
          kind: "approved",
          estimateNumber: j?.estimateNumber ?? "",
          customerEmail: j?.customerEmail ?? "",
        });
      } else if (kind === "reject") {
        const est =
          load.kind === "ready" ? load.data.estimate.estimateNumber : "";
        setAction({ kind: "rejected", estimateNumber: est });
      } else {
        setAction({ kind: "approved", estimateNumber: "", customerEmail: "" });
      }
    } catch {
      setAction({ kind: "action-error" });
    }
  };

  const renderBody = () => {
    // ─── Action-result terminal states (override the view) ────────────
    if (action.kind === "approved") {
      return (
        <div className="text-center">
          <CheckCircle className="h-16 w-16 text-green-600 mx-auto mb-4" />
          <h1 className="text-3xl font-bold text-green-600 mb-4">Estimate Approved!</h1>
          {action.estimateNumber && (
            <p className="text-lg text-gray-700 mb-3">
              Thank you for approving estimate <strong>{action.estimateNumber}</strong>.
            </p>
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
              You declined estimate <strong>{action.estimateNumber}</strong>. We have
              notified our team.
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
            We couldn't record your response. Please contact us directly.
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
            This approval link appears to be invalid. Please contact us if you need a new
            link.
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
              ? `Estimate ${load.estimateNumber} is no longer available for approval. `
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
    const { estimate, photos, attachments, alreadyResponded, status } = load.data;
    const responseLabel =
      status === "approved"
        ? "approved"
        : status === "rejected"
          ? "declined"
          : "responded to";

    return (
      <div className="space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">
            Estimate {estimate.estimateNumber}
          </h1>
          <p className="text-gray-600">
            for {estimate.customerName} · {fmtDate(estimate.estimateDate)}
          </p>
        </div>

        {alreadyResponded && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
            You have already {responseLabel} this estimate.
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
                          <div className="text-xs text-gray-600 mt-0.5">
                            {it.description}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">{it.quantity}</td>
                      <td className="px-3 py-2 text-right">
                        {fmtCurrency(it.partPrice)}
                      </td>
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
              onClick={() => submit("reject")}
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
              onClick={() => submit("approve")}
              data-testid="approval-approve-btn"
            >
              {action.kind === "pending" && action.action === "approve" ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle className="w-4 h-4 mr-2" />
              )}
              Approve Estimate
            </Button>
          </div>
        )}
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
