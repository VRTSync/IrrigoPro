import { useQuery } from "@tanstack/react-query";
import React from "react";

interface CompanyLogoBannerProps {
  className?: string;
}

export function CompanyLogoBanner({ className = "" }: CompanyLogoBannerProps) {
  // Always get current user from session first (production-safe)
  const { data: user } = useQuery<{ id: number, companyId: number, role: string }>({
    queryKey: ["/api/auth/user"],
    retry: false,
    staleTime: 30000, // Cache for 30 seconds to reduce API calls
  });

  // Fetch company profile using the authenticated user's company ID from session
  const { data: company, error } = useQuery({
    queryKey: [`/api/company/${user?.companyId}/profile`],
    enabled: !!user?.companyId && !isNaN(user?.companyId), // Only fetch when we have a valid numeric company ID
    retry: false,
    staleTime: 60000, // Cache company profile for 1 minute
  });

  // Force clear any cached queries with wrong company ID
  React.useEffect(() => {
    import('@/lib/queryClient').then(({ queryClient }) => {
      // Always clear potentially stale company queries on mount
      queryClient.removeQueries({ 
        queryKey: ['/api/company/1/profile'] 
      });
      queryClient.removeQueries({ 
        predicate: (query) => {
          const key = Array.isArray(query.queryKey) ? query.queryKey[0] as string : '';
          // Clear any company profile queries that don't match current user's company
          if (key && key.includes('/api/company/') && key.includes('/profile')) {
            const match = key.match(/\/api\/company\/(\d+)\/profile/);
            if (match) {
              const queryCompanyId = parseInt(match[1]);
              return user?.companyId ? queryCompanyId !== user.companyId : queryCompanyId === 1;
            }
          }
          return false;
        }
      });
      
      // Force invalidate auth user to ensure fresh data
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
    });
  }, [user?.companyId]);

  // Debug logging to track the issue
  console.log('CompanyLogoBanner - User from session:', { id: user?.id, companyId: user?.companyId, role: user?.role });
  console.log('CompanyLogoBanner - Query URL would be:', `/api/company/${user?.companyId}/profile`);
  if (error) {
    console.error('CompanyLogoBanner - Company profile query error:', error);
  }

  if (!company?.logo) {
    return (
      <div className={`bg-gradient-to-r from-blue-50 to-blue-100 dark:from-blue-950 dark:to-blue-900 border-b p-4 ${className}`}>
        <div className="flex items-center justify-center">
          <div className="text-center text-sm text-muted-foreground">
            <span className="bg-white dark:bg-gray-800 px-3 py-1 rounded-full border">
              Upload company logo in Admin → Company
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-gradient-to-r from-blue-50 to-blue-100 dark:from-blue-950 dark:to-blue-900 border-b p-4 ${className}`}>
      <div className="flex items-center justify-center">
        <div className="bg-white dark:bg-gray-800 p-3 rounded-lg shadow-sm border">
          <img 
            src={company.logo}
            alt={`${company.name} Logo`}
            className="h-12 max-w-48 object-contain"
            onError={(e) => {
              // Hide broken logo images gracefully in production
              e.currentTarget.style.display = 'none';
            }}
          />
        </div>
      </div>
    </div>
  );
}