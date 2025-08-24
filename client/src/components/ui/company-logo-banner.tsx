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
    return null;
  }

  return (
    <div className={`bg-white rounded-lg shadow-sm border border-gray-200 p-6 ${className}`}>
      <div className="flex items-center justify-center">
        <img 
          src={company.logo.startsWith('http') 
            ? company.logo 
            : `/public-objects/company-logos/${company.logo}`}
          alt={`${company.name} Logo`}
          className="h-16 w-auto object-contain"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      </div>
      <div className="text-center mt-3">
        <h2 className="text-xl font-semibold text-gray-900">{company.name}</h2>
      </div>
    </div>
  );
}