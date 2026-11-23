import { queryOptions } from "@tanstack/react-query";

export function actionBoardQueryOptions<T>(year: number, month: number, companyId?: number) {
  const url = `/api/action-board?year=${year}&month=${month}${companyId ? `&companyId=${companyId}` : ""}`;
  return queryOptions({
    queryKey: [url],
    queryFn: async ({ signal }): Promise<T> => {
      const response = await fetch(url, { credentials: "include", signal });
      if (!response.ok) throw new Error("Unable to load Action Board");
      return response.json();
    },
    staleTime: 30_000,
  });
}
