import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Plus, User, Building, Mail, Phone, MapPin } from "lucide-react";
import { apiRequest, useArrayQuery } from "@/lib/queryClient";
import { CustomerForm } from "@/components/customer-form";
import { useAuth } from "@/lib/auth-context";
import type { Customer } from "@workspace/db/schema";

interface CustomerSelectorProps {
  selectedCustomer?: Customer | null;
  onSelectCustomer: (customer: Customer) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  hideLabel?: boolean;
  canCreateCustomer?: boolean;
  /**
   * When true and no customer is selected, automatically open the
   * picker dialog and focus the search input. Used by callers (e.g. the
   * estimate wizard) that want customer selection to be the obvious
   * first action with no extra click.
   */
  autoOpen?: boolean;
}

export function CustomerSelector({ 
  selectedCustomer, 
  onSelectCustomer, 
  placeholder = "Search and select a customer...",
  className = "",
  disabled = false,
  hideLabel = false,
  canCreateCustomer = true,
  autoOpen = false,
}: CustomerSelectorProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const { user } = useAuth();
  const showCreate = canCreateCustomer && user?.role === "company_admin";
  const [isOpen, setIsOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const autoOpenedRef = useRef(false);

  // Auto-open the picker dialog once when requested and no customer is
  // selected yet, so callers that want customer selection front-and-center
  // don't need an extra click. Re-arms once a customer is selected so a
  // later "Change customer" still triggers re-open if the caller wants it.
  useEffect(() => {
    if (!autoOpen) return;
    if (selectedCustomer) {
      autoOpenedRef.current = false;
      return;
    }
    if (autoOpenedRef.current) return;
    autoOpenedRef.current = true;
    setIsOpen(true);
  }, [autoOpen, selectedCustomer]);

  const { data: customers = [], isLoading } = useArrayQuery<Customer>({
    queryKey: ["/api/customers", { billingVisible: true }],
    queryFn: () => apiRequest("/api/customers?billingVisible=true"),
  });

  const filteredCustomers = customers?.filter(customer => {
    const q = searchQuery.toLowerCase();
    return (
      customer.name.toLowerCase().includes(q) ||
      (customer.irrigoName || "").toLowerCase().includes(q) ||
      customer.email.toLowerCase().includes(q) ||
      customer.address?.toLowerCase().includes(q)
    );
  }) || [];

  const handleSelectCustomer = (customer: Customer) => {
    onSelectCustomer(customer);
    setIsOpen(false);
    setSearchQuery("");
  };

  if (isLoading) {
    return (
      <div className={`${hideLabel ? '' : 'space-y-2'} ${className}`}>
        {!hideLabel && <Label>Customer</Label>}
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  return (
    <>
      <div className={`w-full ${hideLabel ? '' : 'space-y-2'} ${className}`}>
        {!hideLabel && <Label>Customer *</Label>}
        
        {selectedCustomer ? (
          <Card className="border-2 border-blue-200 bg-blue-50/30 w-full">
            <CardContent className="p-3 sm:p-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-start space-x-3 min-w-0 flex-1">
                  <div className="bg-blue-100 p-2 rounded-lg flex-shrink-0">
                    <Building className="w-4 h-4 text-blue-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="font-medium text-gray-900 truncate">{selectedCustomer.name}</h4>
                    <div className="flex flex-col sm:flex-row sm:items-center sm:space-x-4 space-y-1 sm:space-y-0 text-sm text-gray-600 mt-1">
                      <span className="flex items-center min-w-0">
                        <Mail className="w-3 h-3 mr-1 flex-shrink-0" />
                        <span className="truncate">{selectedCustomer.email}</span>
                      </span>
                      {selectedCustomer.phone && (
                        <span className="flex items-center">
                          <Phone className="w-3 h-3 mr-1 flex-shrink-0" />
                          <span className="truncate">{selectedCustomer.phone}</span>
                        </span>
                      )}
                    </div>
                    {selectedCustomer.address && (
                      <div className="flex items-center text-sm text-gray-600 mt-1">
                        <MapPin className="w-3 h-3 mr-1 flex-shrink-0" />
                        <span className="truncate">{selectedCustomer.address}</span>
                      </div>
                    )}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsOpen(true)}
                  disabled={disabled}
                  className="flex-shrink-0 w-full sm:w-auto"
                >
                  Change
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Button
            type="button"
            variant="outline"
            onClick={() => setIsOpen(true)}
            disabled={disabled}
            className="w-full justify-start text-gray-500 h-10 min-w-0"
          >
            <Search className="w-4 h-4 mr-2 flex-shrink-0" />
            <span className="truncate">{placeholder}</span>
          </Button>
        )}
      </div>

      {/* Customer Selection Dialog */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="w-[95vw] max-w-2xl max-h-[85vh] overflow-hidden p-0 flex flex-col">
          <DialogHeader className="p-4 sm:p-6 border-b border-gray-200 flex-shrink-0">
            <DialogTitle className="flex items-center gap-2 text-lg sm:text-xl">
              <User className="w-5 h-5 text-blue-600" />
              Select Customer
            </DialogTitle>
            <DialogDescription>
              Choose an existing customer or create a new one
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto p-4 sm:p-6 min-h-0">
            <div className="space-y-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
              <Input
                ref={searchInputRef}
                autoFocus
                placeholder="Search customers by name, email, or address..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Create New Customer — the one customer modal */}
            {showCreate && (
              <CustomerForm
                trigger={
                  <Button type="button" className="w-full bg-blue-600 hover:bg-blue-700 text-white">
                    <Plus className="w-4 h-4 mr-2" />
                    Create New Customer
                  </Button>
                }
                onSaved={(created) => handleSelectCustomer(created)}
              />
            )}

            {/* Customer List */}
            <div className="space-y-2">
              {filteredCustomers.length === 0 ? (
                <div className="text-center py-8">
                  <Building className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No customers found</h3>
                  <p className="text-gray-600">
                    {searchQuery
                      ? canCreateCustomer
                        ? "No customers match your search."
                        : "Customer not found — contact your manager to have them added to the system."
                      : "No customers available."}
                  </p>
                </div>
              ) : (
                filteredCustomers.map((customer) => (
                  <Card
                    key={customer.id}
                    className="cursor-pointer hover:bg-blue-50 hover:border-blue-200 transition-colors"
                    onClick={() => {
                      onSelectCustomer(customer);
                      setIsOpen(false);
                    }}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="min-w-0 flex-1">
                          <h3 className="font-semibold text-gray-900 truncate text-base">
                            {customer.irrigoName || customer.name}
                          </h3>
                          {customer.irrigoName && customer.irrigoName !== customer.name && (
                            <p className="text-xs text-gray-400 truncate">{customer.name}</p>
                          )}
                          <div className="text-sm text-gray-600 space-y-1 mt-2">
                            <div className="flex items-center">
                              <Mail className="w-4 h-4 mr-2 flex-shrink-0 text-gray-400" />
                              <span className="truncate">{customer.email}</span>
                            </div>
                            {customer.phone && (
                              <div className="flex items-center">
                                <Phone className="w-4 h-4 mr-2 flex-shrink-0 text-gray-400" />
                                <span>{customer.phone}</span>
                              </div>
                            )}
                            {customer.address && (
                              <div className="flex items-center">
                                <MapPin className="w-4 h-4 mr-2 flex-shrink-0 text-gray-400" />
                                <span className="truncate">{customer.address}</span>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="ml-4 flex-shrink-0">
                          <Badge variant="outline" className="text-xs">
                            {customer.contractType || "Standard"}
                          </Badge>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </div>
          </div>
        </DialogContent>
      </Dialog>

    </>
  );
}