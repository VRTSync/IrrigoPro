import { getImpersonationToken } from "@/lib/impersonation";

type PdfOpenResult = { ok: true } | { ok: false; message: string; validationFailure?: unknown };

export async function openAuthedPdf(url: string): Promise<PdfOpenResult> {
  // This must run inside the user gesture, before the first await.
  const tab = window.open("", "_blank");
  if (tab) tab.opener = null;
  try {
    const target = new URL(url, window.location.origin);
    if (target.origin !== window.location.origin) throw new Error("PDF must use the app's origin");
    const token = getImpersonationToken();
    const response = await fetch(target.pathname + target.search, {
      credentials: "include",
      cache: "no-store",
      headers: token ? { "x-impersonation-token": token } : undefined,
    });
    if (!response.ok || !response.headers.get("content-type")?.includes("application/pdf")) {
      tab?.close();
      const data = await response.json().catch(() => null);
      return {
        ok: false,
        message: typeof data?.message === "string" ? data.message : "Failed to generate PDF",
        validationFailure: data?.validationFailure,
      };
    }
    const objectUrl = URL.createObjectURL(await response.blob());
    if (tab) {
      tab.location.href = objectUrl;
    } else {
      const link = document.createElement("a");
      link.href = objectUrl;
      link.target = "_blank";
      link.rel = "noopener";
      link.click();
    }
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
    return { ok: true };
  } catch {
    tab?.close();
    return { ok: false, message: "A network error occurred while loading the PDF. Please try again." };
  }
}
