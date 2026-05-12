import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useArrayQuery } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { 
  ArrowLeft, 
  User, 
  Mail, 
  Phone, 
  MapPin, 
  FileText, 
  Wrench, 
  Receipt, 
  Calendar,
  DollarSign,
  Clock,
  Package,
  Map,
  ChevronDown,
  ChevronRight
} from "lucide-react";
import { BilledIndicator, BilledBadge } from "@/components/ui/billed-indicator";
import type { Customer, Estimate, WorkOrder, BillingSheetWithItems } from "@workspace/db/schema";
import { EstimateDetailModal } from "@/components/estimates/estimate-detail-modal";
import { WorkOrderDetails } from "@/components/work-orders/work-order-details";
import { PropertyNotes } from "./property-notes";
import { PropertyBoundarySection } from "./property-boundary";
import { BillingNotes } from "./billing-notes";
import { CustomerSiteMaps } from "./customer-site-maps";
import { displayCustomerAddress } from "@/lib/customer-address";

interface CustomerProfileProps {
  customer: Customer;
  onBack: () => void;
  userRole?: string;
}

export function CustomerProfile({ customer, onBack, userRole = "company_admin" }: CustomerProfileProps) {
  const [selectedEstimateId, setSelectedEstimateId] = useState<number | null>(null);
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<WorkOrder | null>(null);
  const [estimateWizardOpen, setEstimateWizardOpen] = useState(false);
  const [workOrderModalOpen, setWorkOrderModalOpen] = useState(false);
  const [showSiteMaps, setShowSiteMaps] = useState(false);
  const [billedWOExpanded, setBilledWOExpanded] = useState(false);
  const [billedBSExpanded, setBilledBSExpanded] = useState(false);

  const [activeView, setActiveView] = useState<'estimates' | 'work-orders' | 'billing-sheets'>('estimates');

  const isWOBilled = (wo: WorkOrder) => wo.status === 'billed' || !!wo.invoiceId;
  const isBSBilled = (bs: BillingSheetWithItems) => bs.status === 'billed' || !!bs.invoiceId;
  const isAdmin = userRole === "company_admin" || userRole === "super_admin" || userRole === "billing_manager";

  // Fetch customer-related data
  const { data: estimates = [] } = useArrayQuery<Estimate>({
    queryKey: [`/api/customers/${customer.id}/estimates`],
  });

  const { data: workOrders = [] } = useArrayQuery<WorkOrder>({
    queryKey: [`/api/customers/${customer.id}/work-orders`],
  });

  const { data: billingSheets = [] } = useArrayQuery<BillingSheetWithItems>({
    queryKey: [`/api/customers/${customer.id}/billing-sheets`],
  });

  const getStatusBadge = (status: string, type: 'estimate' | 'workorder' | 'billing' = 'estimate') => {
    const statusConfig: { [key: string]: { color: string; icon: string; bg: string } } = {
      // Estimate statuses
      pending: { color: 'text-amber-700', icon: '⏳', bg: 'bg-amber-50 border-amber-200 shadow-amber-100' },
      approved: { color: 'text-emerald-700', icon: '✅', bg: 'bg-emerald-50 border-emerald-200 shadow-emerald-100' },
      rejected: { color: 'text-red-700', icon: '❌', bg: 'bg-red-50 border-red-200 shadow-red-100' },
      converted_to_work_order: { color: 'text-blue-700', icon: '🔄', bg: 'bg-blue-50 border-blue-200 shadow-blue-100' },
      
      // Work order statuses
      assigned: { color: 'text-indigo-700', icon: '👤', bg: 'bg-indigo-50 border-indigo-200 shadow-indigo-100' },
      in_progress: { color: 'text-purple-700', icon: '🔧', bg: 'bg-purple-50 border-purple-200 shadow-purple-100' },
      completed: { color: 'text-green-700', icon: '✅', bg: 'bg-green-50 border-green-200 shadow-green-100' },
      cancelled: { color: 'text-gray-700', icon: '🚫', bg: 'bg-gray-50 border-gray-200 shadow-gray-100' },
      
      // Billing sheet status (always completed)
      billed: { color: 'text-orange-700', icon: '💰', bg: 'bg-orange-50 border-orange-200 shadow-orange-100' }
    };

    const config = statusConfig[status] || { color: 'text-gray-700', icon: '?', bg: 'bg-gray-50 border-gray-200' };
    
    return (
      <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border shadow-sm font-medium text-xs ${config.bg} ${config.color}`}>
        <span className="text-sm">{config.icon}</span>
        {status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
      </div>
    );
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { 
      style: 'currency', 
      currency: 'USD' 
    }).format(amount);
  };

  const formatDate = (date: string | Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  // Calculate totals
  const totalEstimateValue = estimates.reduce((sum, est) => sum + Number(est.totalAmount || 0), 0);
  const totalBillingValue = billingSheets.reduce((sum, sheet) => sum + Number(sheet.totalAmount || 0), 0);

  // Show site maps view
  if (showSiteMaps) {
    return (
      <CustomerSiteMaps 
        customer={customer} 
        onBack={() => setShowSiteMaps(false)}
        userRole={userRole}
      />
    );
  }

  return (
    <>
      <div className="max-w-7xl mx-auto px-2 sm:px-4 lg:px-8 py-4 lg:py-6">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <Button variant="outline" onClick={onBack} className="flex items-center gap-2">
              <ArrowLeft className="w-4 h-4" />
              Back to Customers
            </Button>
          </div>
          
          <div className="bg-gradient-to-r from-slate-50 to-blue-50 rounded-xl border shadow-lg p-4 sm:p-6 lg:p-8">
            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6">
                <div className="relative flex-shrink-0">
                  <div className="bg-gradient-to-br from-blue-500 to-blue-600 p-3 sm:p-4 rounded-2xl shadow-lg">
                    <User className="w-8 h-8 sm:w-10 sm:h-10 text-white" />
                  </div>
                  <div className="absolute -bottom-2 -right-2 bg-green-500 w-5 h-5 sm:w-6 sm:h-6 rounded-full border-4 border-white flex items-center justify-center">
                    <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-white rounded-full"></div>
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-1 truncate">
                    {customer.irrigoName || customer.name}
                  </h1>
                  {customer.irrigoName && customer.irrigoName !== customer.name && (
                    <p className="text-sm text-gray-500 mb-2 truncate">
                      Official: {customer.name}
                    </p>
                  )}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 sm:gap-3 text-gray-700">
                      <div className="bg-white p-1.5 rounded-lg shadow-sm flex-shrink-0">
                        <Mail className="w-3 h-3 sm:w-4 sm:h-4 text-blue-600" />
                      </div>
                      <span className="font-medium text-sm sm:text-base truncate">{customer.email}</span>
                    </div>
                    {customer.phone && (
                      <div className="flex items-center gap-2 sm:gap-3 text-gray-700">
                        <div className="bg-white p-1.5 rounded-lg shadow-sm flex-shrink-0">
                          <Phone className="w-3 h-3 sm:w-4 sm:h-4 text-green-600" />
                        </div>
                        <span className="font-medium text-sm sm:text-base">{customer.phone}</span>
                      </div>
                    )}
                    {(() => {
                      const addr = displayCustomerAddress(customer);
                      return addr ? (
                        <div className="flex items-start gap-2 sm:gap-3 text-gray-700">
                          <div className="bg-white p-1.5 rounded-lg shadow-sm flex-shrink-0">
                            <MapPin className="w-3 h-3 sm:w-4 sm:h-4 text-purple-600" />
                          </div>
                          <span className="font-medium text-sm sm:text-base break-words">{addr}</span>
                        </div>
                      ) : null;
                    })()}
                    {/* Site Maps Button - only for roles with site map access */}
                    {(userRole === 'company_admin' || userRole === 'irrigation_manager' || userRole === 'field_tech') && (
                      <div className="mt-3">
                        <Button 
                          onClick={() => setShowSiteMaps(true)}
                          variant="outline"
                          size="sm"
                          className="flex items-center gap-2 bg-white hover:bg-blue-50 border-blue-200 text-blue-700 hover:text-blue-800"
                        >
                          <Map className="w-4 h-4" />
                          <span className="text-sm">View Site Maps</span>
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              
              {/* Enhanced Summary Stats - Mobile Responsive */}
              <div className="grid grid-cols-3 gap-2 sm:gap-4 lg:gap-6 w-full lg:w-auto">
                <div className="bg-white rounded-lg lg:rounded-xl p-2 sm:p-3 lg:p-4 shadow-sm border border-blue-100 hover:shadow-md transition-shadow">
                  <div className="flex flex-col items-center lg:flex-row lg:items-center lg:justify-between mb-1 lg:mb-2">
                    <FileText className="w-4 h-4 sm:w-5 sm:h-5 lg:w-6 lg:h-6 text-blue-600 mb-1 lg:mb-0" />
                    <div className="text-lg sm:text-xl lg:text-2xl font-bold text-blue-700">{estimates.length}</div>
                  </div>
                  <div className="text-xs sm:text-sm font-medium text-gray-700 text-center lg:text-left">Estimates</div>
                  <div className="text-xs text-blue-600 font-medium mt-1 text-center lg:text-left">{formatCurrency(totalEstimateValue)}</div>
                </div>
                <div className="bg-white rounded-lg lg:rounded-xl p-2 sm:p-3 lg:p-4 shadow-sm border border-green-100 hover:shadow-md transition-shadow">
                  <div className="flex flex-col items-center lg:flex-row lg:items-center lg:justify-between mb-1 lg:mb-2">
                    <Wrench className="w-4 h-4 sm:w-5 sm:h-5 lg:w-6 lg:h-6 text-green-600 mb-1 lg:mb-0" />
                    <div className="text-lg sm:text-xl lg:text-2xl font-bold text-green-700">{workOrders.length}</div>
                  </div>
                  <div className="text-xs sm:text-sm font-medium text-gray-700 text-center lg:text-left">Work Orders</div>
                  <div className="text-xs text-green-600 font-medium mt-1 text-center lg:text-left">Active Projects</div>
                </div>
                <div className="bg-white rounded-lg lg:rounded-xl p-2 sm:p-3 lg:p-4 shadow-sm border border-orange-100 hover:shadow-md transition-shadow">
                  <div className="flex flex-col items-center lg:flex-row lg:items-center lg:justify-between mb-1 lg:mb-2">
                    <Receipt className="w-4 h-4 sm:w-5 sm:h-5 lg:w-6 lg:h-6 text-orange-600 mb-1 lg:mb-0" />
                    <div className="text-lg sm:text-xl lg:text-2xl font-bold text-orange-700">{billingSheets.length}</div>
                  </div>
                  <div className="text-xs sm:text-sm font-medium text-gray-700 text-center lg:text-left">Billing Sheets</div>
                  <div className="text-xs text-orange-600 font-medium mt-1 text-center lg:text-left">{formatCurrency(totalBillingValue)}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Property Notes Section */}
        <div className="mb-8">
          <PropertyNotes customer={customer} userRole={userRole} />
        </div>

        {/* Property Boundary Section */}
        <div className="mb-8">
          <PropertyBoundarySection customer={customer} userRole={userRole} />
        </div>

        {/* Billing Rates Section - visible only to billing_manager, company_admin, super_admin */}
        {(userRole === "billing_manager" || userRole === "company_admin" || userRole === "super_admin") && (
          <div className="mb-8">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <DollarSign className="w-5 h-5 text-green-600" />
                  Billing Rates
                  <span className="text-xs font-normal text-gray-400 ml-1">(billing team only)</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <div className="bg-gray-50 rounded-lg p-3 border">
                    <div className="text-xs text-gray-500 font-medium mb-1">Labor Rate</div>
                    <div className="text-lg font-bold text-gray-900">
                      {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(customer.laborRate || 45))}/hr
                    </div>
                  </div>
                  <div className="bg-orange-50 rounded-lg p-3 border border-orange-200">
                    <div className="text-xs text-orange-600 font-medium mb-1">Emergency Labor Rate</div>
                    <div className="text-lg font-bold text-orange-700">
                      {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(customer.emergencyLaborRate || 125))}/hr
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Billing Notes Section - visible only to billing_manager, company_admin, super_admin */}
        {(userRole === "billing_manager" || userRole === "company_admin" || userRole === "super_admin") && (
          <div className="mb-8">
            <BillingNotes customer={customer} userRole={userRole} />
          </div>
        )}

        {/* Customer Data Viewer with Selector */}
        <div className="mb-8">
          {/* View Selector */}
          <div className="mb-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-1 bg-gray-100 p-1 rounded-xl">
              <button
                onClick={() => setActiveView('estimates')}
                className={`flex items-center justify-center gap-2 py-3 px-4 rounded-lg font-medium transition-all duration-200 text-sm ${
                  activeView === 'estimates'
                    ? 'bg-blue-500 text-white shadow-md'
                    : 'text-gray-600 hover:bg-white hover:shadow-sm'
                }`}
              >
                <FileText className="w-4 h-4" />
                <span>Estimates</span>
                <div className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                  activeView === 'estimates'
                    ? 'bg-blue-400 text-white'
                    : 'bg-blue-100 text-blue-800'
                }`}>
                  {estimates.length}
                </div>
              </button>
              <button
                onClick={() => setActiveView('work-orders')}
                className={`flex items-center justify-center gap-2 py-3 px-4 rounded-lg font-medium transition-all duration-200 text-sm ${
                  activeView === 'work-orders'
                    ? 'bg-green-500 text-white shadow-md'
                    : 'text-gray-600 hover:bg-white hover:shadow-sm'
                }`}
              >
                <Wrench className="w-4 h-4" />
                <span>Work Orders</span>
                <div className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                  activeView === 'work-orders'
                    ? 'bg-green-400 text-white'
                    : 'bg-green-100 text-green-800'
                }`}>
                  {workOrders.length}
                </div>
              </button>
              <button
                onClick={() => setActiveView('billing-sheets')}
                className={`flex items-center justify-center gap-2 py-3 px-4 rounded-lg font-medium transition-all duration-200 text-sm ${
                  activeView === 'billing-sheets'
                    ? 'bg-orange-500 text-white shadow-md'
                    : 'text-gray-600 hover:bg-white hover:shadow-sm'
                }`}
              >
                <Receipt className="w-4 h-4" />
                <span>Billing Sheets</span>
                <div className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                  activeView === 'billing-sheets'
                    ? 'bg-orange-400 text-white'
                    : 'bg-orange-100 text-orange-800'
                }`}>
                  {billingSheets.length}
                </div>
              </button>
            </div>
          </div>

          {/* Content Area */}
          <div className="space-y-4">
            {/* Estimates View */}
            {activeView === 'estimates' && (
              <>
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 sm:gap-0">
                  <h2 className="text-lg font-semibold">Customer Estimates</h2>
                  <div className="text-sm text-gray-600">
                    Total Value: <span className="font-semibold text-green-600">{formatCurrency(totalEstimateValue)}</span>
                  </div>
                </div>
                
                {estimates.length === 0 ? (
                  <Card className="border-2 border-dashed border-gray-200">
                    <CardContent className="flex items-center justify-center py-16">
                      <div className="text-center">
                        <div className="bg-blue-100 p-4 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4">
                          <FileText className="w-10 h-10 text-blue-500" />
                        </div>
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">No Estimates Yet</h3>
                        <p className="text-gray-600">This customer doesn't have any estimates created</p>
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid gap-4">
                    {estimates.map((estimate) => (
                      <Card key={estimate.id} className="group hover:shadow-lg transition-all duration-200 cursor-pointer border-l-4 border-l-blue-500 hover:border-l-blue-600 bg-gradient-to-r from-blue-50/30 to-transparent" 
                            onClick={() => {
                              setSelectedEstimateId(estimate.id);
                              setEstimateWizardOpen(true);
                            }}>
                        <CardContent className="p-4 sm:p-6">
                          <div className="space-y-4">
                            {/* Header */}
                            <div className="flex items-center gap-3">
                              <div className="bg-blue-500 p-2.5 rounded-lg shadow-sm group-hover:shadow-md transition-shadow flex-shrink-0">
                                <FileText className="w-5 h-5 text-white" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <h3 className="font-bold text-gray-900 text-lg group-hover:text-blue-700 transition-colors">{estimate.estimateNumber}</h3>
                                <p className="text-gray-600 font-medium text-sm">{estimate.projectName}</p>
                              </div>
                              <div className="flex-shrink-0">
                                {getStatusBadge(estimate.status, 'estimate')}
                              </div>
                            </div>
                            
                            {/* Details */}
                            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 pt-2 border-t border-gray-100">
                              <div className="flex items-center gap-2 text-gray-500 text-sm">
                                <Calendar className="w-4 h-4 flex-shrink-0" />
                                <span>Created {formatDate(estimate.createdAt)}</span>
                              </div>
                              <div className="flex items-center gap-2 text-gray-500 text-sm">
                                <DollarSign className="w-4 h-4 flex-shrink-0" />
                                <span className="font-semibold text-blue-600">{formatCurrency(Number(estimate.totalAmount || 0))}</span>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Work Orders View */}
            {activeView === 'work-orders' && (
              <>
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 sm:gap-0">
                  <h2 className="text-lg font-semibold">Customer Work Orders</h2>
                </div>
                
                {workOrders.length === 0 ? (
                  <Card className="border-2 border-dashed border-gray-200">
                    <CardContent className="flex items-center justify-center py-16">
                      <div className="text-center">
                        <div className="bg-green-100 p-4 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4">
                          <Wrench className="w-10 h-10 text-green-500" />
                        </div>
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">No Work Orders</h3>
                        <p className="text-gray-600">This customer doesn't have any work orders yet</p>
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-4">
                    {/* Active (non-billed) work orders */}
                    <div className="grid gap-4">
                      {workOrders.filter(wo => !isWOBilled(wo)).map((workOrder) => (
                        <Card key={workOrder.id} className="group hover:shadow-lg transition-all duration-200 cursor-pointer border-l-4 border-l-green-500 hover:border-l-green-600 bg-gradient-to-r from-green-50/30 to-transparent"
                              onClick={() => {
                                setSelectedWorkOrder(workOrder);
                                setWorkOrderModalOpen(true);
                              }}>
                          <CardContent className="p-4 sm:p-6">
                            <div className="space-y-4">
                              <div className="flex items-center gap-3">
                                <div className="bg-green-500 p-2.5 rounded-lg shadow-sm group-hover:shadow-md transition-shadow flex-shrink-0">
                                  <Wrench className="w-5 h-5 text-white" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <h3 className="font-bold text-gray-900 text-lg group-hover:text-green-700 transition-colors">{workOrder.workOrderNumber}</h3>
                                  <p className="text-gray-600 font-medium text-sm">{workOrder.projectName}</p>
                                </div>
                                <div className="flex-shrink-0">
                                  {getStatusBadge(workOrder.status, 'workorder')}
                                </div>
                              </div>
                              <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 pt-2 border-t border-gray-100">
                                <div className="flex items-center gap-2 text-gray-500 text-sm">
                                  <Calendar className="w-4 h-4 flex-shrink-0" />
                                  <span>Created {formatDate(workOrder.createdAt)}</span>
                                </div>
                                {workOrder.assignedTechnicianName && (
                                  <div className="flex items-center gap-2 text-gray-500 text-sm">
                                    <User className="w-4 h-4 flex-shrink-0" />
                                    <span className="font-medium">{workOrder.assignedTechnicianName}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                    {/* Billed work orders — collapsible */}
                    {workOrders.filter(wo => isWOBilled(wo)).length > 0 && (
                      <div className="border border-purple-200 rounded-xl overflow-hidden">
                        <button
                          className="w-full flex items-center justify-between px-4 py-3 bg-purple-50 hover:bg-purple-100 transition-colors text-left"
                          onClick={() => setBilledWOExpanded(!billedWOExpanded)}
                        >
                          <div className="flex items-center gap-2 text-sm font-medium text-purple-800">
                            {billedWOExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            Billed — {workOrders.filter(wo => isWOBilled(wo)).length} work order{workOrders.filter(wo => isWOBilled(wo)).length !== 1 ? 's' : ''}
                          </div>
                        </button>
                        {billedWOExpanded && (
                          <div className="grid gap-3 p-3 bg-purple-50/30">
                            {workOrders.filter(wo => isWOBilled(wo)).map((workOrder) => (
                              <Card key={workOrder.id} className="group cursor-pointer border-l-4 border-l-purple-400 bg-purple-50/60 border border-purple-200"
                                    onClick={() => {
                                      setSelectedWorkOrder(workOrder);
                                      setWorkOrderModalOpen(true);
                                    }}>
                                <CardContent className="p-4 sm:p-6">
                                  <div className="space-y-4">
                                    <div className="flex items-center gap-3">
                                      <div className="bg-purple-500 p-2.5 rounded-lg shadow-sm flex-shrink-0">
                                        <Wrench className="w-5 h-5 text-white" />
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <h3 className="font-bold text-gray-900 text-lg">{workOrder.workOrderNumber}</h3>
                                        <p className="text-gray-600 font-medium text-sm">{workOrder.projectName}</p>
                                      </div>
                                      <div className="flex-shrink-0 flex flex-col items-end gap-1">
                                        {getStatusBadge(workOrder.status, 'workorder')}
                                        {workOrder.status !== 'billed' && <BilledBadge />}
                                      </div>
                                    </div>
                                    <div className="pt-2 border-t border-purple-100">
                                      <BilledIndicator compact invoiceId={workOrder.invoiceId} billedAt={workOrder.billedAt} />
                                    </div>
                                  </div>
                                </CardContent>
                              </Card>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Billing Sheets View */}
            {activeView === 'billing-sheets' && (
              <>
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 sm:gap-0">
                  <h2 className="text-lg font-semibold">Customer Billing Sheets</h2>
                  <div className="text-sm text-gray-600">
                    Total Value: <span className="font-semibold text-green-600">{formatCurrency(totalBillingValue)}</span>
                  </div>
                </div>
                
                {billingSheets.length === 0 ? (
                  <Card className="border-2 border-dashed border-gray-200">
                    <CardContent className="flex items-center justify-center py-16">
                      <div className="text-center">
                        <div className="bg-orange-100 p-4 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4">
                          <Receipt className="w-10 h-10 text-orange-500" />
                        </div>
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">No Billing Sheets</h3>
                        <p className="text-gray-600">This customer doesn't have any billing sheets created</p>
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-4">
                    {/* Active (non-billed) billing sheets */}
                    <div className="grid gap-4">
                      {billingSheets.filter(bs => !isBSBilled(bs)).map((billingSheet) => (
                        <Card key={billingSheet.id} className="group hover:shadow-lg transition-all duration-200 cursor-pointer border-l-4 border-l-orange-500 hover:border-l-orange-600 bg-gradient-to-r from-orange-50/30 to-transparent">
                          <CardContent className="p-4 sm:p-6">
                            <div className="space-y-4">
                              <div className="flex items-center gap-3">
                                <div className="bg-orange-500 p-2.5 rounded-lg shadow-sm group-hover:shadow-md transition-shadow flex-shrink-0">
                                  <Receipt className="w-5 h-5 text-white" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <h3 className="font-bold text-gray-900 text-lg group-hover:text-orange-700 transition-colors">{billingSheet.billingNumber}</h3>
                                  <p className="text-gray-600 font-medium text-sm">{billingSheet.notes || 'Billing sheet'}</p>
                                </div>
                                <div className="flex-shrink-0 text-right">
                                  <div className="mb-1">{getStatusBadge(billingSheet.status, 'billing')}</div>
                                  <div className="text-lg font-bold text-orange-600">{formatCurrency(Number(billingSheet.totalAmount || 0))}</div>
                                </div>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-gray-100">
                                <div className="flex items-center gap-2 text-gray-500 text-sm">
                                  <Calendar className="w-4 h-4 flex-shrink-0" />
                                  <span>Created {formatDate(billingSheet.createdAt)}</span>
                                </div>
                                <div className="flex items-center gap-2 text-gray-500 text-sm">
                                  <User className="w-4 h-4 flex-shrink-0" />
                                  <span className="font-medium">{billingSheet.technicianName}</span>
                                </div>
                                <div className="flex items-center gap-2 text-gray-500 text-sm">
                                  <Package className="w-4 h-4 flex-shrink-0" />
                                  <span>{billingSheet.items?.length || 0} items</span>
                                </div>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                    {/* Billed billing sheets — collapsible */}
                    {billingSheets.filter(bs => isBSBilled(bs)).length > 0 && (
                      <div className="border border-purple-200 rounded-xl overflow-hidden">
                        <button
                          className="w-full flex items-center justify-between px-4 py-3 bg-purple-50 hover:bg-purple-100 transition-colors text-left"
                          onClick={() => setBilledBSExpanded(!billedBSExpanded)}
                        >
                          <div className="flex items-center gap-2 text-sm font-medium text-purple-800">
                            {billedBSExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            Billed — {billingSheets.filter(bs => isBSBilled(bs)).length} billing sheet{billingSheets.filter(bs => isBSBilled(bs)).length !== 1 ? 's' : ''}
                          </div>
                        </button>
                        {billedBSExpanded && (
                          <div className="grid gap-3 p-3 bg-purple-50/30">
                            {billingSheets.filter(bs => isBSBilled(bs)).map((billingSheet) => (
                              <Card key={billingSheet.id} className="border-l-4 border-l-purple-400 bg-purple-50/60 border border-purple-200">
                                <CardContent className="p-4 sm:p-6">
                                  <div className="space-y-4">
                                    <div className="flex items-center gap-3">
                                      <div className="bg-purple-500 p-2.5 rounded-lg shadow-sm flex-shrink-0">
                                        <Receipt className="w-5 h-5 text-white" />
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <h3 className="font-bold text-gray-900 text-lg">{billingSheet.billingNumber}</h3>
                                        <p className="text-gray-600 font-medium text-sm">{billingSheet.notes || 'Billing sheet'}</p>
                                      </div>
                                      <div className="flex-shrink-0 text-right">
                                        <div className="mb-1"><BilledBadge /></div>
                                        <div className="text-lg font-bold text-purple-700">{formatCurrency(Number(billingSheet.totalAmount || 0))}</div>
                                      </div>
                                    </div>
                                    <div className="pt-2 border-t border-purple-100">
                                      <BilledIndicator compact invoiceId={billingSheet.invoiceId} />
                                    </div>
                                  </div>
                                </CardContent>
                              </Card>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      {estimateWizardOpen && selectedEstimateId && (
        <EstimateDetailModal
          open={estimateWizardOpen}
          onOpenChange={(open) => {
            setEstimateWizardOpen(open);
            if (!open) setSelectedEstimateId(null);
          }}
          estimateId={selectedEstimateId}
        />
      )}

      {workOrderModalOpen && selectedWorkOrder && (
        <WorkOrderDetails
          workOrder={selectedWorkOrder}
          onClose={() => {
            setWorkOrderModalOpen(false);
            setSelectedWorkOrder(null);
          }}
          onUpdate={() => {
            // Refresh work orders when updated
            setWorkOrderModalOpen(false);
            setSelectedWorkOrder(null);
          }}
        />
      )}
    </>
  );
}