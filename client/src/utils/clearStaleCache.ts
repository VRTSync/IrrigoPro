// Utility to clear stale cache data - call this on app startup
export const clearStaleCache = () => {
  // Only clear cache queries, NOT user data
  console.log('Clearing query cache for fresh data');
  
  // Clear any cached queries that might be stale
  import('@/lib/queryClient').then(({ queryClient }) => {
    // Clear company profile queries that might be stale
    queryClient.removeQueries({ 
      predicate: (query) => {
        const key = Array.isArray(query.queryKey) ? query.queryKey[0] as string : '';
        return key && key.includes('/api/company/') && key.includes('/profile');
      }
    });
  }).catch(() => {
    // Ignore import errors
  });
};