import { readQbCustomTxnNumbers, type QbMakeRequestFn } from "./qb-invoice-ops";

export const QB_CUSTOM_TXN_DISABLED = "Turn on Custom transaction numbers in QuickBooks (Gear → Account and settings → Sales) before pushing invoices.";
export const QB_SESSION_EXPIRED = "QuickBooks session expired. Please reconnect QuickBooks and retry.";
export type QbPreferenceCheck = { ok: true } | { ok: false; status: 401 | 409; message: string };

/** True-only, realm-keyed cache; failures never extend the permission window. */
export async function checkQbCustomTxnNumbersCached(
  makeRequest: QbMakeRequestFn,
  apiBase: string,
  integration: { realmId: string; accessToken: string },
  okUntil: Map<string, number>,
  now: () => number = Date.now,
): Promise<QbPreferenceCheck> {
  if ((okUntil.get(integration.realmId) ?? 0) > now()) return { ok: true };
  okUntil.delete(integration.realmId);
  const enabled = await readQbCustomTxnNumbers(makeRequest, apiBase, integration);
  if (enabled === "auth_error") return { ok: false, status: 401, message: QB_SESSION_EXPIRED };
  if (!enabled) return { ok: false, status: 409, message: QB_CUSTOM_TXN_DISABLED };
  okUntil.set(integration.realmId, now() + 10 * 60 * 1000);
  return { ok: true };
}
