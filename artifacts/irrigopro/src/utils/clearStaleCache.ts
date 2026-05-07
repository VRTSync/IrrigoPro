// Production-optimized cache management
export const clearStaleCache = () => {
  // Clear only stale queries for production performance
  import('@/lib/queryClient').then(({ queryClient }) => {
    queryClient.removeQueries({ 
      predicate: (query) => {
        const key = Array.isArray(query.queryKey) ? query.queryKey[0] as string : '';
        return !!(key && key.includes('/api/company/') && key.includes('/profile'));
      }
    });
  }).catch(() => {});
};