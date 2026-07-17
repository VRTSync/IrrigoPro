import { apiRequest } from "./queryClient";

// Task #616 — `/api/estimates/:id/email` now actually delivers a
// Postmark email through the shared approval-email flow. The legacy
// helper signature (customer info on the payload) was unused on the
// server, so we keep this helper minimal: pass the optional recipient
// overrides + note and let the server resolve the customer's
// on-file email when `to` is omitted.
export interface SendEstimateEmailInput {
  to?: string;
  cc?: string[];
  bcc?: string[];
  note?: string;
  // Task #1791 — when true, the server generates a PDF and attaches it
  // to the outgoing estimate email.
  attachPdf?: boolean;
}

export const sendEstimateEmail = async (
  estimateId: number,
  input: SendEstimateEmailInput = {},
): Promise<void> => {
  await apiRequest(`/api/estimates/${estimateId}/email`, "POST", input);
};

// Task #348 — `/api/estimates/:id/pdf` now streams a real `application/pdf`
// binary instead of a JSON `{ downloadUrl }` placeholder. This helper hands
// the caller a blob URL they can open in a new tab or wire to a download
// link. The blob URL is owned by the caller; revoke it when done.
export const generateEstimatePDF = async (estimateId: number): Promise<{ downloadUrl: string; blob: Blob }> => {
  const response = await apiRequest(`/api/estimates/${estimateId}/pdf`, "POST");
  const blob = await response.blob();
  return { downloadUrl: URL.createObjectURL(blob), blob };
};
