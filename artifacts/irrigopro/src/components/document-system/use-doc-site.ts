import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { DocumentationSite, DocumentationSites } from "@workspace/api-client-react";
import { getGetDocumentationSitesQueryKey } from "@workspace/api-client-react";
import { apiRequest } from "@/lib/queryClient";

export function docSiteKey(customerId: number, branchName: string) {
  return ["/api/system-documentation/customers", customerId, "site", branchName] as const;
}

export function docSiteUrl(customerId: number, branchName: string) {
  return `/api/system-documentation/customers/${customerId}/site?branchName=${encodeURIComponent(branchName)}`;
}

export function useDocSite(customerId: number, branchName: string, enabled = true) {
  return useQuery<DocumentationSite>({
    queryKey: docSiteKey(customerId, branchName),
    queryFn: () => apiRequest(docSiteUrl(customerId, branchName), "GET"),
    enabled: enabled && Number.isFinite(customerId) && customerId > 0,
  });
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
  return useQuery<DocumentationSites>({
    queryKey: getGetDocumentationSitesQueryKey(),
    queryFn: () => apiRequest("/api/system-documentation/sites", "GET"),
  });
}
