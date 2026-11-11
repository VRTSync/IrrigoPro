import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { DocumentationSite, DocumentationSites } from "@workspace/api-client-react";
import { getGetDocumentationSitesQueryKey } from "@workspace/api-client-react";
import { readDocSite, readDocSitesList } from "@/lib/offline/doc-read";
const copyMetadata = new WeakMap<object, { fromCopy: boolean; savedAt: number }>();
const noCopy = { fromCopy: false, savedAt: 0 };

export function docSiteKey(customerId: number, branchName: string) {
  return ["/api/system-documentation/customers", customerId, "site", branchName] as const;
}

export function docSiteUrl(customerId: number, branchName: string) {
  return `/api/system-documentation/customers/${customerId}/site?branchName=${encodeURIComponent(branchName)}`;
}

export function useDocSite(customerId: number, branchName: string, enabled = true) {
  const query = useQuery<DocumentationSite>({
    queryKey: docSiteKey(customerId, branchName),
    queryFn: async () => {
      const result = await readDocSite(customerId, branchName);
      copyMetadata.set(result.payload, { fromCopy: result.fromCopy, savedAt: result.savedAt });
      return result.payload;
    },
    networkMode: "always",
    structuralSharing: false,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    enabled: enabled && Number.isFinite(customerId) && customerId > 0,
  });
  return { ...query, ...(query.data ? copyMetadata.get(query.data) ?? noCopy : noCopy) };
}

/**
 * After a write: refetch this site, refresh picker statuses, and mark every
 * Controllers & Zones cache for this customer (list in any branch form, plus
 * each controller's detail and history, the backflow list and each backflow) stale so the next visit refetches.
 */
export function useInvalidateDocSite(customerId: number, branchName: string) {
  const qc = useQueryClient();
  return useCallback(
    (extraControllerId?: number | null, extraBackflowId?: number | null) => {
      const cached = qc.getQueryData<DocumentationSite>(docSiteKey(customerId, branchName));
      const ids = new Set<number>((cached?.controllers ?? []).map((c) => c.id));
      if (extraControllerId != null) ids.add(extraControllerId);
      const bfIds = new Set<number>((cached?.backflows ?? []).map((b) => b.id));
      if (extraBackflowId != null) bfIds.add(extraBackflowId);
      const listPrefix = `/api/customers/${customerId}/controllers-profile`;
      return Promise.all([
        qc.invalidateQueries({ queryKey: docSiteKey(customerId, branchName), exact: true }),
        qc.invalidateQueries({ queryKey: getGetDocumentationSitesQueryKey() }),
        qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] === listPrefix || q.queryKey[0].startsWith(`${listPrefix}?`)) }),
        qc.invalidateQueries({ queryKey: ["/api/properties", customerId, "controllers"] }),
        // Controllers & Zones backflow list (BackflowSection) and any per-backflow detail.
        qc.invalidateQueries({ queryKey: [`/api/customers/${customerId}/backflows`] }),
        ...[...bfIds].map((id) => qc.invalidateQueries({ queryKey: [`/api/backflows/${id}`] })),
        ...[...ids].flatMap((id) => [
          qc.invalidateQueries({ queryKey: [`/api/irrigation-controllers/${id}`], exact: true }),
          qc.invalidateQueries({ queryKey: [`/api/irrigation-controllers/${id}/history`], exact: true }),
        ]),
      ]).then(() => undefined);
    },
    [qc, customerId, branchName],
  );
}

export function useDocSites() {
  const query = useQuery<DocumentationSites>({
    queryKey: getGetDocumentationSitesQueryKey(),
    queryFn: async () => {
      const result = await readDocSitesList();
      copyMetadata.set(result.payload, { fromCopy: result.fromCopy, savedAt: result.savedAt });
      return result.payload;
    },
    networkMode: "always",
    structuralSharing: false,
  });
  return { ...query, ...(query.data ? copyMetadata.get(query.data) ?? noCopy : noCopy) };
}
