import { apiRequest } from "@/lib/queryClient";
import { getSyncEngine } from "./engine";
import { docOwner, docSession, getDocSite } from "./doc-store";
import { applyDocMutation, docTemporaryId } from "./doc-apply";
import { isDocNetworkError, readDocSite } from "./doc-read";
import type { QueuedMutation, QueuedMutationKind } from "./types";
import type { DocumentationSite } from "@workspace/api-client-react";

const tails = new Map<string, Promise<void>>();
export async function withDocSiteLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prior = tails.get(key) ?? Promise.resolve();
  const current = prior.then(fn, fn);
  const tail = current.then(() => undefined, () => undefined);
  tails.set(key, tail);
  try { return await current; }
  finally { if (tails.get(key) === tail) tails.delete(key); }
}
export function docQueueForSite(queue: QueuedMutation[], siteKey: string) {
  return queue.filter(m => m.kind.startsWith("doc.") && m.siteKey === siteKey && m.docOwner === docOwner())
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}
export function overlayDocQueue(payload: DocumentationSite, queue: QueuedMutation[]): DocumentationSite {
  let result = payload;
  for (const m of queue) {
    if (m.status === "completed" || m.docRefused) continue;
    if (m.docRequiresSuccess?.some(cid => queue.some(p => p.clientId === cid && (p.docRefused || p.status === "failed")))) continue;
    result = applyDocMutation(result, m);
  }
  return result;
}
export interface DocWriteInput {
  kind: QueuedMutationKind; siteKey: string; subjectClientId?: string;
  method: "POST" | "PUT" | "DELETE"; url: string; body?: unknown;
  createClientId?: string; localSubjectId?: number; subjectLabel?: string;
  photoClientId?: string;
}
export async function docWrite(input: DocWriteInput): Promise<{ queued: boolean; response?: any }> {
  const owner = docOwner();
  const session = docSession();
  return withDocSiteLock(input.siteKey, async () => {
    if (docSession() !== session) throw new Error("Your account changed. Sign in again before saving.");
    const engine = getSyncEngine();
    if (navigator.onLine === false) engine.setOnline(false);
    const all = docQueueForSite(await engine.listMutations(), input.siteKey);
    if (docSession() !== session) throw new Error("Your account changed. Sign in again before saving.");
    const outstanding = all.filter(m => m.status !== "completed" || m.docRefused);
    const createClientId = input.kind.endsWith(".create") ? input.createClientId ?? crypto.randomUUID() : undefined;
    let body = createClientId ? { ...(input.body as object ?? {}), clientId: createClientId } : input.body;
    const photoField = input.kind === "doc.controller.create" ? "settingsPhotoUrl" : input.kind === "doc.backflow.create" ? "photoUrl" : null;
    const stagedPhoto = photoField && (body as Record<string, any>)?.[photoField]?.startsWith("local:")
      ? String((body as Record<string, any>)[photoField]).slice(6) : null;
    if (stagedPhoto && photoField) body = { ...(body as object), [photoField]: null };
    const placeholders: Record<string, string> = {};
    let url = input.url;
    // Keep local ids in the optimistic body, but use placeholders on the wire.
    const creates = all.filter(m => m.kind.endsWith(".create"));
    for (const create of creates) {
      const temporary = docTemporaryId(create.clientId);
      const token = `id${Object.keys(placeholders).length}`;
      if (url.split("/").includes(String(temporary))) {
        placeholders[token] = create.clientId;
        url = url.split("/").map(part => part === String(temporary) ? `{{${token}}}` : part).join("/");
      }
    }
    const transform = (v: unknown, key = ""): unknown => {
      if (typeof v === "number" && key === "programId" && v < 0) {
        const create = creates.find(m => docTemporaryId(m.clientId) === v);
        if (!create) throw new Error("The offline program could not be found.");
        const token = `id${Object.keys(placeholders).length}`;
        placeholders[token] = create.clientId;
        return `{{${token}}}`;
      }
      if (Array.isArray(v)) return v.map(x => transform(x));
      if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, transform(x, k)]));
      return v;
    };
    const wireBody = transform(body);
    const photoMutation = input.kind === "doc.controller.photo" || input.kind === "doc.backflow.photo";
    if (!stagedPhoto && !photoMutation && navigator.onLine !== false && engine.isOnline() && !outstanding.length && !Object.keys(placeholders).length) {
      try {
        const response = body === undefined ? await apiRequest(input.url, input.method) : await apiRequest(input.url, input.method, body);
        if (docSession() !== session) throw new Error("Your account changed. Sign in again before saving.");
        // Refresh even when the caller has already left/unmounted.
        const [customerId, ...branch] = input.siteKey.split(":");
        void readDocSite(Number(customerId), branch.join(":")).catch(() => {});
        return { queued: false, response };
      } catch (error) {
        if (!isDocNetworkError(error)) throw error;
        engine.setOnline(false);
      }
    }
    const [customerId, ...branch] = input.siteKey.split(":");
    if (!owner) throw new Error("Sign in before saving documentation.");
    const copy = await getDocSite(Number(customerId), branch.join(":"));
    if (!copy) throw new Error("Not saved — connect to download");
    const lastTime = all.at(-1)?.createdAt ?? 0;
    const m: QueuedMutation = {
      id: crypto.randomUUID(), clientId: input.photoClientId ?? createClientId ?? crypto.randomUUID(), kind: input.kind,
      method: input.method, urlTemplate: url, body: wireBody, docLocalBody: body,
      siteKey: input.siteKey, subjectClientId: input.subjectClientId, localSubjectId: input.localSubjectId,
      subjectLabel: `${(copy.payload as DocumentationSite).customer?.name ?? "Property"}${branch.join(":") ? ` · ${branch.join(":")}` : ""} · ${input.subjectLabel ?? "Location"}`, docOwner: owner,
      parentClientId: Object.values(placeholders)[0] ?? null, placeholders,
      docOrderAfter: all.filter(p => p.status === "pending" || p.status === "syncing").map(p => p.clientId),
      docRequiresSuccess: input.kind.endsWith(".verify")
        ? outstanding.map(p => p.clientId) : [],
      createdAt: Math.max(Date.now(), lastTime + 1), attemptCount: 0, lastAttemptAt: null,
      lastError: null, status: "pending", resolvedId: null,
    };
    if (docSession() !== session) throw new Error("Your account changed. Sign in again before saving.");
    // Durability precedes success. Local-storage failures are never network failures.
    const batch = [m];
    if (stagedPhoto && createClientId) {
      batch.push({
        ...m, id: crypto.randomUUID(), clientId: stagedPhoto,
        kind: input.kind === "doc.controller.create" ? "doc.controller.photo" : "doc.backflow.photo",
        method: input.kind === "doc.controller.create" ? "POST" : "PUT",
        urlTemplate: input.kind === "doc.controller.create" ? "/api/irrigation-controllers/{{subject}}/photo" : "/api/backflows/{{subject}}",
        body: {}, docLocalBody: {}, placeholders: { subject: createClientId }, parentClientId: createClientId,
        docOrderAfter: [m.clientId], docRequiresSuccess: [], createdAt: m.createdAt + 1,
        subjectClientId: createClientId, localSubjectId: docTemporaryId(createClientId),
      });
    }
    const local = batch.reduce(applyDocMutation, overlayDocQueue(copy.payload as DocumentationSite, all));
    await engine.enqueueMany(batch);
    const response = input.kind === "doc.controller.create" ? local.controllers.find(x => x.id === docTemporaryId(m.clientId))
      : input.kind === "doc.backflow.create" ? local.backflows.find(x => x.id === docTemporaryId(m.clientId))
      : input.kind === "doc.program.create" ? local.controllers.flatMap(x => x.programs).find(x => x.id === docTemporaryId(m.clientId))
      : undefined;
    return { queued: true, response };
  });
}

/** Bound to one wizard only; office callers keep their existing request path. */
export function createDocRequest(customerId: number, branchName: string) {
  return async (url: string, method = "GET", body?: unknown): Promise<any> => {
    if (method === "GET") return apiRequest(url, method, body);
    const siteKey = `${customerId}:${branchName}`;
    const controller = /\/irrigation-controllers\/(-?\d+)(.*)/.exec(url);
    if (controller?.[2] === "/photo") {
      if (String((body as any)?.url ?? "").startsWith("local:")) return;
    }
    if (/\/backflows\/-?\d+$/.test(url) && String((body as any)?.photoUrl ?? "").startsWith("local:")) return;
    const program = /\/irrigation-programs\/(-?\d+)/.exec(url);
    const backflow = /\/backflows\/(-?\d+)(.*)/.exec(url);
    let kind: QueuedMutationKind;
    let subjectId: number | undefined;
    if (url.endsWith("/controllers-profile")) kind = "doc.controller.create";
    else if (/\/customers\/\d+\/backflows$/.test(url)) kind = "doc.backflow.create";
    else if (controller) {
      subjectId = Number(controller[1]);
      kind = ({ "": "doc.controller.update", "/letter": "doc.controller.letter", "/zone-count": "doc.controller.zone_count",
        "/photo": "doc.controller.update",
        "/zones/bulk": "doc.controller.zones", "/zones/extra-programs": "doc.controller.extra_programs",
        "/field-verify": "doc.controller.verify", "/programs": "doc.program.create",
      } as Record<string, QueuedMutationKind>)[controller[2]];
    } else if (program) { subjectId = Number(program[1]); kind = method === "DELETE" ? "doc.program.delete" : "doc.program.update"; }
    else if (backflow) {
      subjectId = Number(backflow[1]);
      kind = backflow[2] === "/field-verify" ? "doc.backflow.verify" : backflow[2] === "/log-test" ? "doc.backflow.log_test" : "doc.backflow.update";
    } else if (url.endsWith("/no-backflow")) kind = "doc.site.no_backflow";
    else if (url.endsWith("/site/verify")) kind = "doc.site.verify";
    else throw new Error(`Unsupported document save: ${url}`);
    if (!kind) throw new Error(`Unsupported document save: ${url}`);
    const row = await getDocSite(customerId, branchName);
    const queue = docQueueForSite(await getSyncEngine().listMutations(), siteKey);
    const local = row ? overlayDocQueue(row.payload as DocumentationSite, queue) : null;
    const clock = local?.controllers.find(c => c.id === subjectId || c.programs.some(p => p.id === subjectId));
    const bf = local?.backflows.find(b => b.id === subjectId);
    const creator = queue.find(m => m.kind.endsWith(".create") && docTemporaryId(m.clientId) === subjectId);
    return (await docWrite({
      kind, siteKey, subjectClientId: creator?.clientId ?? (subjectId == null ? undefined : String(subjectId)), localSubjectId: subjectId,
      subjectLabel: clock ? `Controller ${clock.letter}${clock.location ? ` · ${clock.location}` : ""}` : bf ? `Backflow ${bf.name}` :
        kind === "doc.controller.create" ? `Controller ${(body as any)?.letter ?? ""}` : kind === "doc.backflow.create" ? `Backflow ${(body as any)?.name ?? ""}` : "Location",
      method: method as DocWriteInput["method"], url, body,
    })).response;
  };
}
