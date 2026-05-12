import { Alert, Platform, ToastAndroid } from "react-native";

/**
 * Tiny cross-platform toast helper.
 *
 * Android: native `ToastAndroid.SHORT`.
 * iOS / web: a chrome-less `Alert` with a single OK button — the same
 * pattern used across the M5–M8 screens, lifted into one place so
 * every screen ships an identical UX (M9 polish).
 */
export function showToast(message: string): void {
  if (!message) return;
  if (Platform.OS === "android") {
    ToastAndroid.show(message, ToastAndroid.SHORT);
  } else {
    Alert.alert("", message);
  }
}

/**
 * Map an arbitrary thrown value to a friendly user-facing message.
 *
 * Field techs should never see a raw "Network request failed" string —
 * if we don't recognise the error shape, fall back to a calm generic
 * message and let the engineer dig into logs.
 */
export function friendlyErrorMessage(
  err: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  if (!err) return fallback;
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "";
  if (!raw) return fallback;
  if (/network request failed/i.test(raw)) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  if (/abort|timed out|timeout/i.test(raw)) {
    return "The request timed out. Please try again.";
  }
  return raw;
}
