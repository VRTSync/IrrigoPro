// Thin service wrapper that generates an estimate PDF buffer for use in
// the estimate email flow (Task #1791 — "Attach PDF when sending
// estimates"). The heavy lifting is done by `renderEstimatePdf` from
// `estimate-pdf.ts`; this module only resolves the estimate + company
// records and assembles the opts.
//
// Usage:
//   const { buffer, filename } = await generateEstimatePdfForEmail(storage, estimateId);
//   // Then attach as base64 in the SendGrid payload.

import type { IStorage } from './storage';
import { renderEstimatePdf } from './estimate-pdf';
import { formatEstimateNumber } from '@workspace/shared';
import type { Company, EstimateWithItems } from '@workspace/db';

export interface EstimatePdfResult {
  buffer: Buffer;
  filename: string;
}

export function estimatePdfAttachmentFilename(estimateNumber: string): string {
  return `Estimate-${formatEstimateNumber(estimateNumber)}.pdf`;
}

export function estimatePdfForPendingSend(
  estimate: EstimateWithItems,
  company: Company | null | undefined,
  sentAt: Date,
  resetEstimateDate: boolean,
) {
  return {
    sentAt,
    company,
    estimate: resetEstimateDate ? { ...estimate, estimateDate: new Date(sentAt) } : estimate,
  };
}

/**
 * Generate an estimate PDF buffer suitable for email attachment.
 * Returns null if the estimate cannot be loaded or the render fails.
 */
export async function generateEstimatePdfForEmail(
  storage: Pick<IStorage, 'getEstimate' | 'getCompany'>,
  estimateId: number,
  // Task #1955 — the send flow renders this attachment before it persists
  // the new send timestamp (email-first ordering), so the reloaded row
  // still carries the previous send time. Callers pass the pending send
  // time so the attached PDF's "Valid Until" matches the 30-day window
  // the customer is being given right now.
  opts: { sentAt?: Date | null; estimate?: EstimateWithItems; company?: Company | null } = {},
): Promise<EstimatePdfResult | null> {
  try {
    const estimate = opts.estimate ?? await storage.getEstimate(estimateId);
    if (!estimate) {
      console.warn(`[estimate-pdf-service] Estimate ${estimateId} not found — skipping PDF attachment`);
      return null;
    }

    let company = opts.company;
    if (company === undefined && estimate.companyId) {
      try {
        company = await storage.getCompany(estimate.companyId);
      } catch {
        // Non-fatal — renderEstimatePdf works without company info.
      }
    }

    const buffer = await renderEstimatePdf(estimate, {
      company: company ?? undefined,
      sentAt: opts.sentAt ?? null,
    });

    return { buffer, filename: estimatePdfAttachmentFilename(estimate.estimateNumber) };
  } catch (err) {
    console.error('[estimate-pdf-service] Failed to generate PDF for attachment:', err instanceof Error ? err.message : err);
    return null;
  }
}
