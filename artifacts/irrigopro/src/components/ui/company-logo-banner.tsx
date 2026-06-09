import { safeGet } from "@/utils/safeStorage";
import { useQuery } from "@tanstack/react-query";
import React, { useState, useEffect, useMemo } from "react";

interface CompanyLogoBannerProps {
  className?: string;
}

export function CompanyLogoBanner({ className = "" }: CompanyLogoBannerProps) {
  // Get user from localStorage (production-compatible)
  const [user, setUser] = useState<{ id: number, companyId: number, role: string } | null>(null);
  
  useEffect(() => {
    const savedUser = safeGet("user");
    if (savedUser) {
      try {
        const userData = JSON.parse(savedUser);
        setUser(userData);
      } catch (error) {
        console.error("Error parsing user data:", error);
      }
    }
  }, []);

  // Fetch company profile using the authenticated user's company ID from session
  const { data: company } = useQuery<{ logo?: string; name?: string }>({
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
      
      // Auth user query removed for production compatibility
    });
  }, [user?.companyId]);


  // Route through /api/company-logo/:id — a public route (no requireAuthentication)
  // that serves the binary from object storage. Using the API URL avoids exposing
  // or depending on the raw object-storage URL, which may not be publicly reachable,
  // and lets <img src> work without any custom auth headers.
  //
  // Handles two stored formats:
  //   new:    company-logos/<uuid>          → /api/company-logo/<uuid>
  //   legacy: /api/company-logo/<uuid>      → pass through as-is
  const logoApiUrl = useMemo(() => {
    const logo = company?.logo;
    if (!logo || logo.trim() === '' || logo === 'null') return null;
    // New format: company-logos/<id>
    const m = logo.match(/company-logos\/([^?]+)/);
    if (m) return `/api/company-logo/${m[1]}`;
    // Legacy format: /api/company-logo/<id> stored directly in DB
    const legacy = logo.match(/\/api\/company-logo\/([^?/]+)/);
    if (legacy) return `/api/company-logo/${legacy[1]}`;
    return null;
  }, [company?.logo]);

  if (!logoApiUrl) {
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
            src={logoApiUrl}
            alt={`${company?.name ?? 'Company'} Logo`}
            className="h-16 max-w-xs object-contain"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        </div>
      </div>
    </div>
  );
}