import { preparePhotoForUpload } from "@/lib/photo-prep";
import { ensurePersistentStorage } from "./api";
import { docWrite, docQueueForSite } from "./doc-api";
import { getSyncEngine } from "./engine";
import { deletePhotoBlob, getPhotoBlob, openOfflineDB, putPhotoBlob } from "./db";
import { docOwner, docSession } from "./doc-store";

let persistence: ReturnType<typeof ensurePersistentStorage> | null = null;
let warned = false;
export async function shouldQueueDocPhoto(siteKey: string) {
  const engine = getSyncEngine();
  return navigator.onLine === false || !engine.isOnline() ||
    docQueueForSite(await engine.listMutations(), siteKey).some(m => m.status !== "completed" || m.docRefused);
}
export async function captureDocPhoto(input: {
  file: File; siteKey: string; kind: "controller" | "backflow"; subjectId: number | null; subjectLabel: string;
  warn: () => void;
}): Promise<string> {
  const owner = docOwner();
  const session = docSession();
  if (!owner) throw new Error("Sign in before saving a photo.");
  persistence ??= ensurePersistentStorage();
  const storage = await persistence;
  if (!storage.persisted && !warned) { warned = true; input.warn(); }
  const prepared = await preparePhotoForUpload(input.file);
  const clientId = crypto.randomUUID();
  const db = await openOfflineDB();
  if (docSession() !== session) throw new Error("Your account changed. Nothing was saved.");
  await putPhotoBlob(db, { clientId, blob: prepared.displayFile, contentType: prepared.displayFile.type || "image/jpeg",
    name: prepared.displayFile.name, byteSize: prepared.displayFile.size, capturedAt: Date.now(), compressed: !prepared.usedFallback });
  try {
    if (docSession() !== session) throw new Error("Your account changed. Nothing was saved.");
    if (input.subjectId != null) {
      await docWrite({
        kind: input.kind === "controller" ? "doc.controller.photo" : "doc.backflow.photo",
        siteKey: input.siteKey, subjectClientId: String(input.subjectId), localSubjectId: input.subjectId,
        subjectLabel: input.subjectLabel, photoClientId: clientId,
        method: input.kind === "controller" ? "POST" : "PUT",
        url: input.kind === "controller" ? `/api/irrigation-controllers/${input.subjectId}/photo` : `/api/backflows/${input.subjectId}`,
        body: {},
      });
    }
  } catch (error) {
    await deletePhotoBlob(db, clientId);
    throw error;
  }
  // A draft's blob is attached atomically with its create, once Device/Details
  // is complete. We never POST a local marker as a server photo URL.
  return `local:${clientId}`;
}
export async function discardDocPhoto(marker: string) {
  const clientId = marker.slice(6);
  const engine = getSyncEngine();
  for (const m of await engine.listMutations()) {
    if (m.docOwner === docOwner() && m.clientId === clientId) await engine.cancelMutation(m.id);
  }
  await deletePhotoBlob(await openOfflineDB(), clientId);
}
export async function getDocPhotoBlob(marker: string) {
  return (await getPhotoBlob(await openOfflineDB(), marker.slice(6)))?.blob;
}
