import { apiRequest } from "./queryClient";

// Task #348 — `/api/estimates/:id/pdf` now streams a real `application/pdf`
// binary instead of a JSON `{ downloadUrl }` placeholder. This helper hands
// the caller a blob URL they can open in a new tab or wire to a download
// link. The blob URL is owned by the caller; revoke it when done.
export const generateEstimatePDF = async (estimateId: number): Promise<{ downloadUrl: string; blob: Blob }> => {
  const response = await apiRequest(`/api/estimates/${estimateId}/pdf`, "POST");
  const blob = await response.blob();
  return { downloadUrl: URL.createObjectURL(blob), blob };
};
