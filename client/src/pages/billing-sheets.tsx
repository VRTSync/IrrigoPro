import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { StandaloneBillingSheet } from "@/components/billing/standalone-billing-sheet";
import { Plus, Search, FileText, Calendar, User, DollarSign, Clock } from "lucide-react";
import type { BillingSheet } from "@shared/schema";

export default function BillingSheets() {
  const [showBillingModal, setShowBillingModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const { data: billingSheets, isLoading } = useQuery<BillingSheet[]>({
    queryKey: ["/api/billing-sheets"],
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

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Billing Sheets</h1>
          <p className="text-gray-600 mt-2">Manage billing for work performed without work orders</p>
        </div>
        <Button 
          onClick={() => setShowBillingModal(true)}
          className="bg-blue-600 hover:bg-blue-700"
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
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-3">
                      <FileText className="w-5 h-5 text-blue-600" />
                      <div>
                        <h3 className="font-semibold text-gray-900">{sheet.billingNumber}</h3>
                        <p className="text-sm text-gray-600">{sheet.customerName}</p>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-gray-500" />
                        <div>
                          <p className="text-gray-900">{formatDate(sheet.workDate)}</p>
                          <p className="text-gray-500">Work Date</p>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-gray-500" />
                        <div>
                          <p className="text-gray-900">{sheet.technicianName}</p>
                          <p className="text-gray-500">Technician</p>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-gray-500" />
                        <div>
                          <p className="text-gray-900">{sheet.totalHours} hours</p>
                          <p className="text-gray-500">Total Time</p>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <DollarSign className="w-4 h-4 text-gray-500" />
                        <div>
                          <p className="text-gray-900 font-semibold">{formatCurrency(sheet.totalAmount)}</p>
                          <p className="text-gray-500">Total Amount</p>
                        </div>
                      </div>
                    </div>
                    
                    <div className="mt-3">
                      <p className="text-sm text-gray-600">
                        <strong>Work:</strong> {sheet.workDescription}
                      </p>
                      {sheet.propertyAddress && (
                        <p className="text-sm text-gray-600">
                          <strong>Location:</strong> {sheet.propertyAddress}
                        </p>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex flex-col items-end gap-3">
                    {getStatusBadge(sheet.status)}
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