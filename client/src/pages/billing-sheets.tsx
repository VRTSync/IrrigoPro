import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { StandaloneBillingSheet } from "@/components/billing/standalone-billing-sheet";
import { Plus, Search, FileText, Calendar, User, DollarSign, Clock, Check, X, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { BillingSheet } from "@shared/schema";

export default function BillingSheets() {
  const [showBillingModal, setShowBillingModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Get current user from localStorage  
  const getCurrentUser = () => {
    const savedUser = localStorage.getItem("user");
    return savedUser ? JSON.parse(savedUser) : null;
  };

  const currentUser = getCurrentUser();

  // Check for create parameter in URL
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('create') === 'true') {
      setShowBillingModal(true);
      // Clean up URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // For field techs, only show their own billing sheets
  const { data: billingSheets, isLoading } = useQuery<BillingSheet[]>({
    queryKey: currentUser?.role === 'field_tech' 
      ? ["/api/billing-sheets", "technician", currentUser?.id]
      : ["/api/billing-sheets"],
    queryFn: () => currentUser?.role === 'field_tech' 
      ? fetch(`/api/billing-sheets?technician=${currentUser.id}`).then(res => res.json())
      : fetch('/api/billing-sheets').then(res => res.json()),
  });

  const formatCurrency = (amount: number | string) => {
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(numAmount);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'draft':
        return <Badge className="bg-gray-100 text-gray-800">Draft</Badge>;
      case 'submitted':
        return <Badge className="bg-blue-100 text-blue-800">Submitted</Badge>;
      case 'approved':
        return <Badge className="bg-green-100 text-green-800">Approved</Badge>;
      case 'billed':
        return <Badge className="bg-purple-100 text-purple-800">Billed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatDate = (date: string | Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const filteredBillingSheets = billingSheets?.filter(sheet =>
    sheet.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    sheet.propertyAddress.toLowerCase().includes(searchQuery.toLowerCase()) ||
    sheet.technicianName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    sheet.billingNumber.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  // Billing sheet approval mutation
  const approveBillingSheet = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/billing-sheets/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'approved' })
      });
      if (!response.ok) throw new Error('Failed to approve billing sheet');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/billing-sheets'] });
      toast({
        title: "Success",
        description: "Billing sheet approved successfully"
      });
    },
    onError: () => {
      toast({
        title: "Error", 
        description: "Failed to approve billing sheet",
        variant: "destructive"
      });
    }
  });

  // Billing sheet rejection mutation
  const rejectBillingSheet = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/billing-sheets/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'draft' })
      });
      if (!response.ok) throw new Error('Failed to reject billing sheet');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/billing-sheets'] });
      toast({
        title: "Success",
        description: "Billing sheet rejected and returned to draft"
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to reject billing sheet", 
        variant: "destructive"
      });
    }
  });

  // Submit billing sheet for approval (field techs only)
  const submitForApproval = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/billing-sheets/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'submitted' })
      });
      if (!response.ok) throw new Error('Failed to submit billing sheet for approval');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/billing-sheets'] });
      toast({
        title: "Success",
        description: "Billing sheet submitted for manager approval"
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to submit billing sheet for approval",
        variant: "destructive"
      });
    }
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
            {currentUser?.role === 'field_tech' ? 'My Billing Sheets' : 'Billing Sheets'}
          </h1>
          <p className="text-gray-600 mt-1 sm:mt-2 text-sm sm:text-base">
            {currentUser?.role === 'field_tech' 
              ? 'Create billing for your standalone work'
              : 'Manage billing for work performed without work orders'
            }
          </p>
        </div>
        <Button 
          onClick={() => setShowBillingModal(true)}
          className="bg-blue-600 hover:bg-blue-700 w-full sm:w-auto"
        >
          <Plus className="w-4 h-4 mr-2" />
          New Billing Sheet
        </Button>
      </div>

      {/* Search */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              placeholder="Search by customer, property, technician, or billing number..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      {/* Billing Sheets List */}
      {isLoading ? (
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-2">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-4 w-48" />
                  </div>
                  <Skeleton className="h-8 w-20" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredBillingSheets.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <FileText className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">No billing sheets found</h3>
            <p className="text-gray-600 mb-6">
              {searchQuery 
                ? "No billing sheets match your search criteria." 
                : "Get started by creating your first billing sheet for work performed without a work order."
              }
            </p>
            <Button 
              onClick={() => setShowBillingModal(true)}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create First Billing Sheet
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredBillingSheets.map((sheet) => (
            <Card key={sheet.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-3">
                      <FileText className="w-5 h-5 text-blue-600 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-gray-900 truncate">{sheet.billingNumber}</h3>
                        <p className="text-sm text-gray-600 truncate">{sheet.customerName}</p>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 text-sm">
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-gray-500 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-gray-900 truncate">{formatDate(sheet.workDate)}</p>
                          <p className="text-gray-500 text-xs">Work Date</p>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-gray-500 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-gray-900 truncate">{sheet.technicianName}</p>
                          <p className="text-gray-500 text-xs">Technician</p>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-gray-500 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-gray-900 truncate">{sheet.totalHours} hours</p>
                          <p className="text-gray-500 text-xs">Total Time</p>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <DollarSign className="w-4 h-4 text-gray-500 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-gray-900 font-semibold truncate">{formatCurrency(sheet.totalAmount)}</p>
                          <p className="text-gray-500 text-xs">Total Amount</p>
                        </div>
                      </div>
                    </div>
                    
                    <div className="mt-3 space-y-1">
                      <p className="text-xs sm:text-sm text-gray-600">
                        <strong>Work:</strong> <span className="break-words">{sheet.workDescription}</span>
                      </p>
                      {sheet.propertyAddress && (
                        <p className="text-xs sm:text-sm text-gray-600">
                          <strong>Location:</strong> <span className="break-words">{sheet.propertyAddress}</span>
                        </p>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex flex-col sm:items-end gap-2 sm:gap-3 flex-shrink-0">
                    <div className="flex flex-col sm:items-end gap-2">
                      {getStatusBadge(sheet.status)}
                      
                      {/* Submit for approval button for field techs on draft billing sheets */}
                      {currentUser?.role === 'field_tech' && sheet.status === 'draft' && sheet.technicianId === currentUser.id && (
                        <Button
                          size="sm"
                          onClick={() => submitForApproval.mutate(sheet.id)}
                          disabled={submitForApproval.isPending}
                          className="bg-blue-600 hover:bg-blue-700 text-white px-3"
                        >
                          <Send className="w-3 h-3 mr-1" />
                          Submit for Approval
                        </Button>
                      )}
                      
                      {/* Approval buttons for managers on submitted billing sheets */}
                      {currentUser?.role !== 'field_tech' && sheet.status === 'submitted' && (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => approveBillingSheet.mutate(sheet.id)}
                            disabled={approveBillingSheet.isPending}
                            className="bg-green-600 hover:bg-green-700 text-white px-3"
                          >
                            <Check className="w-3 h-3 mr-1" />
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => rejectBillingSheet.mutate(sheet.id)}
                            disabled={rejectBillingSheet.isPending}
                            className="border-red-300 text-red-600 hover:bg-red-50 px-3"
                          >
                            <X className="w-3 h-3 mr-1" />
                            Reject
                          </Button>
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-gray-500">
                      Created: {formatDate(sheet.createdAt)}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Standalone Billing Sheet Modal */}
      <StandaloneBillingSheet
        open={showBillingModal}
        onOpenChange={setShowBillingModal}
      />
    </div>
  );
}