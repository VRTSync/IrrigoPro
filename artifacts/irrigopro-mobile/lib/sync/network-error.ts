// Pure helper — no React Native imports. Extracted so engine.ts can
// import it without pulling @react-native-community/netinfo into the
// tsx/esbuild test runner chain.

/**
 * True when the thrown error looks like a transport-level failure
 * (DNS, no signal, fetch aborted) rather than an HTTP error response.
 * apiRequest only throws ApiError for HTTP 4xx/5xx; everything else
 * is a raw fetch rejection.
 */
export function isNetworkError(err: unknown): boolean {
  if (err == null) return false;
  if (err instanceof Error && err.name === "ApiError") return false;
  if (typeof err === "object" && (err as { status?: unknown }).status != null) {
    return false;
  }
  if (err instanceof TypeError) return true;
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes("network request failed") ||
      msg.includes("failed to fetch") ||
      msg.includes("network error") ||
      msg.includes("timeout") ||
      msg.includes("aborted")
    );
  }
  return false;
}
