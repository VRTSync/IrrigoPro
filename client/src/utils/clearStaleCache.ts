// Utility to clear stale cache data - call this on app startup
export const clearStaleCache = () => {
  // Clear any localStorage data that might be stale
  const savedUser = localStorage.getItem("user");
  if (savedUser) {
    try {
      const user = JSON.parse(savedUser);
      console.log('Clearing stale cache for user:', { id: user.id, companyId: user.companyId });
      
      // If user has company ID 1, it might be stale test data
      if (user.companyId === 1) {
        console.warn('Found potentially stale user data with companyId: 1, clearing...');
        localStorage.removeItem("user");
        // Force page reload to get fresh session data
        window.location.reload();
      }
    } catch (error) {
      console.error('Error parsing saved user data:', error);
      localStorage.removeItem("user");
    }
  }
};