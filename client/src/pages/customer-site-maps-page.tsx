import { safeGet } from "@/utils/safeStorage";
import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { CustomerSiteMaps } from "@/components/customers/customer-site-maps";
import { Skeleton } from "@/components/ui/skeleton";
import type { Customer } from "@shared/schema";

export default function CustomerSiteMapsPage() {
  const { customerId } = useParams();
  const [, setLocation] = useLocation();
  
  const getCurrentUser = () => {
    const savedUser = safeGet("user");
    return savedUser ? JSON.parse(savedUser) : null;
  };
  const currentUser = getCurrentUser();

  const { data: customer, isLoading, error } = useQuery({
    queryKey: [`/api/customers/${customerId}`],
    queryFn: () => apiRequest(`/api/customers/${customerId}`) as Promise<Customer>,
    enabled: !!customerId && !!currentUser?.id,
  });

  if (isLoading) {
    return (
      <div className="container mx-auto p-4 max-w-4xl">
        <Skeleton className="h-8 w-48 mb-4" />
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (error || !customer) {
    return (
      <div className="container mx-auto p-4 max-w-4xl">
        <div className="text-center py-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Customer Not Found</h2>
          <p className="text-gray-600 mb-4">The customer you're looking for doesn't exist or you don't have permission to view it.</p>
          <button
            onClick={() => setLocation('/customers')}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
          >
            Back to Customers
          </button>
        </div>
      </div>
    );
  }

  return (
    <CustomerSiteMaps
      customer={customer}
      onBack={() => setLocation('/customers')}
      userRole={currentUser?.role || ''}
    />
  );
}