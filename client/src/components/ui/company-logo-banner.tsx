import { useQuery } from "@tanstack/react-query";

interface CompanyLogoBannerProps {
  className?: string;
}

export function CompanyLogoBanner({ className = "" }: CompanyLogoBannerProps) {
  // Get current user from localStorage  
  const user = JSON.parse(localStorage.getItem("user") || "{}");

  // Fetch company profile to get company logo
  const { data: company } = useQuery({
    queryKey: [`/api/company/${user?.companyId}/profile`],
    enabled: !!user?.companyId,
    retry: false,
  });

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
              console.error('Company logo failed to load:', company.logo);
              e.currentTarget.style.display = 'none';
            }}
          />
        </div>
      </div>
    </div>
  );
}