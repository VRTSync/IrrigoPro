import { safeGet, safeSet } from "@/utils/safeStorage";
import { runWithOfflineDB } from "./db";

// Capture the owner BEFORE network work. Late responses from an old session
// must not be written under the next person's identity.
export function docOwner(): string {
  try {
    const user = JSON.parse(safeGet("user") ?? "null");
    return user?.id != null ? `${user.companyId ?? ""}:${user.id}` : "";
  } catch { return ""; }
}
export const docSession = () => `${docOwner()}:${safeGet("doc-session-generation") ?? "0"}`;
export const docKey = (customerId: number, branchName: string) => `${customerId}:${branchName}`;

export async function putDocSite(customerId: number, branchName: string, payload: unknown, session = docSession()): Promise<void> {
  if (!docOwner() || session !== docSession()) return;
  await runWithOfflineDB(async (db) => {
    if (session !== docSession()) return;
    await db.put("docSites", { key: docKey(customerId, branchName), owner: docOwner(), customerId, branchName, payload, savedAt: Date.now() });
  });
}
export async function getDocSite(customerId: number, branchName: string) {
  const owner = docOwner();
  const row = await runWithOfflineDB((db) => db.get("docSites", docKey(customerId, branchName)));
  return owner && owner === docOwner() && row?.owner === owner ? row : null;
}
export async function putDocSitesList(payload: unknown, session = docSession()): Promise<void> {
  if (!docOwner() || session !== docSession()) return;
  await runWithOfflineDB(async (db) => {
    if (session !== docSession()) return;
    await db.put("docSitesList", { key: "all", owner: docOwner(), payload, savedAt: Date.now() });
  });
}
export async function getDocSitesList() {
  const owner = docOwner();
  const row = await runWithOfflineDB((db) => db.get("docSitesList", "all"));
  return owner && owner === docOwner() && row?.owner === owner ? row : null;
}
export async function listDocSites() {
  const owner = docOwner();
  const rows = await runWithOfflineDB((db) => db.getAll("docSites"));
  return owner === docOwner() ? rows.filter((row) => row.owner === owner && owner) : [];
}
export async function clearDocCopies(): Promise<void> {
  safeSet("doc-session-generation", crypto.randomUUID());
  await runWithOfflineDB(async (db) => {
    const tx = db.transaction(["docSites", "docSitesList"], "readwrite");
    await Promise.all([tx.objectStore("docSites").clear(), tx.objectStore("docSitesList").clear()]);
    await tx.done;
  });
}
