import { AlertCircle } from "lucide-react";

interface RowValidationError {
  recordType: string;
  recordId: number;
  partsSubtotal: number;
  laborSubtotal: number;
  computedTotal: number;
  storedTotal: number;
  delta: number;
}

interface ValidationFailure {
  validationFailed: boolean;
  rowErrors: RowValidationError[];
  totalsError?: {
    computedGrandTotal: number;
    storedTotal: number;
    delta: number;
  };
}

export interface PdfErrorDetail {
  message: string;
  validationFailure?: unknown;
}

function isValidationFailure(value: unknown): value is ValidationFailure {
  return !!value && typeof value === "object" && "validationFailed" in value && value.validationFailed === true &&
    "rowErrors" in value && Array.isArray(value.rowErrors);
}

export function PdfValidationErrorPanel({ detail }: { detail: PdfErrorDetail }) {
  const vf = isValidationFailure(detail.validationFailure) ? detail.validationFailure : null;
  return (
    <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4" role="alert">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
        <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          <h4 className="mb-1 font-medium text-red-900">PDF Cannot Be Generated</h4>
          <p className="mb-2 text-sm text-red-700">{detail.message}</p>
          {!!vf?.rowErrors.length && (
            <div className="mt-2">
              <p className="mb-1 text-sm font-medium text-red-800">Data integrity issues found:</p>
              <ul className="list-inside list-disc space-y-1 text-sm text-red-700">
                {vf.rowErrors.map((err, i) => (
                  <li key={i}>
                    {err.recordType === "work_order" ? "Work Order" : "Billing Sheet"} #{err.recordId}: parts ${err.partsSubtotal.toFixed(2)} + labor ${err.laborSubtotal.toFixed(2)} = ${err.computedTotal.toFixed(2)}, but the stored total is ${err.storedTotal.toFixed(2)} (off by ${err.delta.toFixed(2)})
                  </li>
                ))}
              </ul>
            </div>
          )}
          {vf?.totalsError && (
            <div className="mt-2">
              <p className="mb-1 text-sm font-medium text-red-800">Invoice total mismatch:</p>
              <p className="text-sm text-red-700">
                Line items sum to ${vf.totalsError.computedGrandTotal.toFixed(2)}, but the invoice stored total is ${vf.totalsError.storedTotal.toFixed(2)} (off by ${vf.totalsError.delta.toFixed(2)}).
              </p>
            </div>
          )}
          {vf && <p className="mt-2 text-xs text-red-600">Please contact support to repair these records before generating the PDF.</p>}
        </div>
      </div>
    </div>
  );
}
