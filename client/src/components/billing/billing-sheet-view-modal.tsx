import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { 
  FileText, 
  User, 
  Calendar, 
  Package, 
  Timer, 
  Camera,
  MapPin,
  Clock,
  X
} from "lucide-react";
import type { BillingSheet, BillingSheetItem } from "@shared/schema";

interface BillingSheetViewModalProps {
  sheet: BillingSheet;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Helper function to get current user
const getCurrentUser = () => {
  const savedUser = localStorage.getItem("user");
  return savedUser ? JSON.parse(savedUser) : null;
};

export function BillingSheetViewModal({ sheet, open, onOpenChange }: BillingSheetViewModalProps) {
  const currentUser = getCurrentUser();
  const isFieldTech = currentUser?.role === 'field_tech';

  // Fetch billing sheet items
  const { data: items = [] } = useQuery<BillingSheetItem[]>({
    queryKey: ["/api/billing-sheets", sheet.id, "items"],
    queryFn: () => fetch(`/api/billing-sheets/${sheet.id}/items`).then(res => res.json()),
    enabled: open,
  });

  const formatDate = (date: string | Date) => {
    return new Date(date).toLocaleDateString();
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'draft':
        return 'bg-gray-100 text-gray-800';
      case 'submitted':
        return 'bg-yellow-100 text-yellow-800';
      case 'approved':
        return 'bg-green-100 text-green-800';
      case 'billed':
        return 'bg-blue-100 text-blue-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-4xl h-[95vh] max-h-[95vh] overflow-hidden p-0 flex flex-col">
        <DialogHeader className="p-4 sm:p-6 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-orange-50 p-2 rounded-lg">
                <FileText className="w-5 h-5 text-orange-600" />
              </div>
              <div>
                <DialogTitle className="text-xl font-semibold">
                  Billing Sheet {sheet.billingNumber}
                </DialogTitle>
                <p className="text-sm text-gray-600 font-normal mt-1">
                  View billing sheet details
                </p>
              </div>
            </div>
            <Badge className={getStatusColor(sheet.status)}>
              {sheet.status.charAt(0).toUpperCase() + sheet.status.slice(1)}
            </Badge>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="space-y-4 sm:space-y-6">
            {/* Customer & Location */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                  <User className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
                  Customer & Location
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-sm font-medium text-gray-600">Customer</p>
                  <p className="text-gray-900">{sheet.customerName}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-600">Property Address</p>
                  <p className="text-gray-900">{sheet.propertyAddress}</p>
                </div>
              </CardContent>
            </Card>

            {/* Work Details */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                  <Calendar className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
                  Work Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <p className="text-sm font-medium text-gray-600">Work Date</p>
                    <p className="text-gray-900">{formatDate(sheet.workDate)}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-600">Technician</p>
                    <p className="text-gray-900">{sheet.technicianName}</p>
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-600">Work Description</p>
                  <p className="text-gray-900">{sheet.workDescription}</p>
                </div>
              </CardContent>
            </Card>

            {/* Parts & Materials */}
            {items.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                    <Package className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
                    {isFieldTech ? `Parts Used (${items.length} items)` : `Parts & Materials (${items.length} items)`}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {items.map((item, index) => (
                      <div key={index} className="bg-gray-50 p-3 rounded-lg">
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <p className="font-medium text-gray-900">{item.partName}</p>
                            {item.partDescription && (
                              <p className="text-sm text-gray-600 mt-1">{item.partDescription}</p>
                            )}
                          </div>
                          <div className="text-right ml-4">
                            <p className="text-sm text-gray-600">Qty: {item.quantity}</p>
                            {!isFieldTech && (
                              <p className="text-sm font-medium text-gray-900">{formatCurrency(Number(item.totalPrice))}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Photos */}
            {sheet.photos && sheet.photos.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                    <Camera className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
                    Photos ({sheet.photos.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {sheet.photos.map((photo, index) => (
                      <div key={index} className="aspect-square bg-gray-100 rounded-lg overflow-hidden">
                        <img 
                          src={photo} 
                          alt={`Photo ${index + 1}`}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Notes */}
            {sheet.notes && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base sm:text-lg">Additional Notes</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-gray-900">{sheet.notes}</p>
                </CardContent>
              </Card>
            )}

            {/* Work Summary for field techs, Billing Summary for others */}
            {isFieldTech ? (
              <Card className="bg-blue-50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                    <Clock className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
                    Work Summary
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Total Hours Worked:</span>
                      <span className="font-semibold text-gray-900">{sheet.totalHours} hours</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Parts Used:</span>
                      <span className="font-medium text-gray-900">{items.length} items</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="bg-gray-50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                    <Timer className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
                    Billing Summary
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Parts Subtotal:</span>
                    <span className="font-medium">{formatCurrency(Number(sheet.partsSubtotal))}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">
                      Labor ({sheet.totalHours} hours @ {formatCurrency(Number(sheet.laborRate))}/hr):
                    </span>
                    <span className="font-medium">{formatCurrency(Number(sheet.laborSubtotal))}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Markup:</span>
                    <span className="font-medium">{formatCurrency(Number(sheet.markupAmount))}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Tax:</span>
                    <span className="font-medium">{formatCurrency(Number(sheet.taxAmount))}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between text-lg font-semibold">
                    <span>Total:</span>
                    <span>{formatCurrency(Number(sheet.totalAmount))}</span>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Close Button */}
        <div className="border-t border-gray-200 p-4 sm:p-6 flex-shrink-0">
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="w-full sm:w-auto"
            >
              <X className="w-4 h-4 mr-2" />
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}