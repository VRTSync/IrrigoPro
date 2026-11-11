import type { DocumentationSites } from "@workspace/api-client-react";
import { fetchDoc, docSiteUrl } from "./doc-read";
import { docSession, putDocSite, putDocSitesList } from "./doc-store";

type Progress = (done: number, total: number) => void;
let running: Promise<{ saved: number; failed: number }> | null = null;
const listeners = new Set<Progress>();
const watchers = new Set<Progress>();
let currentProgress: [number, number] = [0, 0];
export function observeDocDownloads(fn: Progress) {
  watchers.add(fn);
  fn(...currentProgress);
  return () => { watchers.delete(fn); };
}
let lastAuto = -Infinity;

export function downloadAllDocSites(opts?: { onProgress?: Progress }): Promise<{ saved: number; failed: number }> {
  if (opts?.onProgress) listeners.add(opts.onProgress);
  if (running) return running;
  const owner = docSession();
  running = (async () => {
    const list = await fetchDoc<DocumentationSites>("/api/system-documentation/sites");
    await putDocSitesList(list, owner);
    const jobs = list.customers.flatMap((c) =>
      (c.branches.length ? c.branches : [""]).map((branch) => ({ id: c.customerId, branch })));
    let cursor = 0, saved = 0, failed = 0;
    const progress = () => {
      currentProgress = [saved + failed, jobs.length];
      for (const fn of [...listeners, ...watchers]) fn(...currentProgress);
    };
    progress();
    await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, async () => {
      while (cursor < jobs.length && docSession() === owner) {
        const job = jobs[cursor++];
        try {
          const payload = await fetchDoc(docSiteUrl(job.id, job.branch));
          await putDocSite(job.id, job.branch, payload, owner);
          saved++;
        } catch { failed++; }
        progress();
      }
    }));
    return { saved, failed };
  })().finally(() => {
    running = null; listeners.clear(); currentProgress = [0, 0];
    watchers.forEach(fn => fn(0, 0));
  });
  return running;
}

export function autoDownloadDocSites(): Promise<unknown> {
  if (navigator.onLine === false || Date.now() - lastAuto < 600_000) return Promise.resolve();
  lastAuto = Date.now();
  return downloadAllDocSites();
}
