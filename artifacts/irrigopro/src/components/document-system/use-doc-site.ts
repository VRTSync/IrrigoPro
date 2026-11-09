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

/** Invalidates exactly this site's query and nothing else. */
export function useInvalidateDocSite(customerId: number, branchName: string) {
  const qc = useQueryClient();
  return useCallback(
    () => qc.invalidateQueries({ queryKey: docSiteKey(customerId, branchName), exact: true }),
    [qc, customerId, branchName],
  );
}

export function useDocSites() {
  return useQuery<DocumentationSites>({
    queryKey: getGetDocumentationSitesQueryKey(),
    queryFn: () => apiRequest("/api/system-documentation/sites", "GET"),
  });
}
