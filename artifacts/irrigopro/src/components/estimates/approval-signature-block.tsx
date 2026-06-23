import { format } from "date-fns";
import { ShieldCheck } from "lucide-react";

export interface ApprovalSignatureBlockProps {
  approvalSignatureType?: string | null;
  approvalSignatureData?: string | null;
  approvalSignerName?: string | null;
  approvalSignedAt?: string | Date | null;
  approvalSignerIp?: string | null;
  approvalConsentText?: string | null;
  approvalConsentAcceptedAt?: string | Date | null;
}

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  try {
    return format(new Date(d as string | Date), "MMM d, yyyy h:mm a");
  } catch {
    return "—";
  }
}

export function ApprovalSignatureBlock({
  approvalSignatureType,
  approvalSignatureData,
  approvalSignerName,
  approvalSignedAt,
  approvalSignerIp,
  approvalConsentText,
}: ApprovalSignatureBlockProps) {
  if (!approvalSignatureData) return null;

  const isDrawn = approvalSignatureType === "drawn";

  return (
    <div
      className="rounded-xl border border-green-200 bg-green-50 p-4 space-y-3"
      data-testid="approval-signature-block"
    >
      <div className="flex items-center gap-2 mb-1">
        <ShieldCheck className="w-4 h-4 text-green-600 flex-shrink-0" />
        <span className="text-sm font-semibold text-green-800">
          Customer Approved — Signature on File
        </span>
      </div>

      {isDrawn ? (
        <div
          className="rounded-lg border border-green-200 bg-white p-3 inline-block"
          data-testid="signature-image-wrapper"
        >
          <img
            src={approvalSignatureData}
            alt="Customer signature"
            className="max-h-24 max-w-xs object-contain"
            data-testid="signature-image"
          />
        </div>
      ) : (
        <div
          className="rounded-lg border border-green-200 bg-white px-4 py-3"
          data-testid="signature-typed-wrapper"
        >
          <span
            className="text-2xl text-gray-800"
            style={{ fontFamily: "'Dancing Script', 'Brush Script MT', cursive" }}
            data-testid="signature-typed-name"
          >
            {approvalSignatureData}
          </span>
        </div>
      )}

      <div className="text-xs text-green-800 space-y-1 pl-1">
        {approvalSignerName && (
          <div data-testid="signature-signer-name">
            <span className="font-medium">Signed by:</span>{" "}
            {approvalSignerName}
          </div>
        )}
        {approvalSignedAt && (
          <div data-testid="signature-signed-at">
            <span className="font-medium">Date:</span>{" "}
            {fmtDate(approvalSignedAt)}
          </div>
        )}
        {approvalSignerIp && (
          <div data-testid="signature-signer-ip">
            <span className="font-medium">IP:</span>{" "}
            {approvalSignerIp}
          </div>
        )}
      </div>

      {approvalConsentText && (
        <p
          className="text-[11px] text-green-700 border-t border-green-200 pt-2 leading-relaxed italic"
          data-testid="signature-consent-text"
        >
          {approvalConsentText}
        </p>
      )}
    </div>
  );
}
