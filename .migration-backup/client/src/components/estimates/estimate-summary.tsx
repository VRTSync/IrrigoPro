import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Part } from "@shared/schema";

interface EstimateItem {
  part: Part;
  quantity: number;
  totalPrice: number;
  totalLaborHours: number;
}

interface EstimateSummaryProps {
  items: EstimateItem[];
  laborRate: number;
}

export function EstimateSummary({ items, laborRate }: EstimateSummaryProps) {
  const partsSubtotal = items.reduce((sum, item) => sum + item.totalPrice, 0);
  const totalLaborHours = items.reduce((sum, item) => sum + item.totalLaborHours, 0);
  const laborSubtotal = totalLaborHours * (laborRate || 0);
  const totalAmount = partsSubtotal + laborSubtotal;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  return (
    <Card className="w-full bg-gray-50">
      <CardHeader>
        <CardTitle className="text-lg font-medium text-gray-900">Estimate Summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex justify-between">
          <span className="text-gray-600">Parts Subtotal:</span>
          <span className="font-medium">{formatCurrency(partsSubtotal)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">
            Labor ({totalLaborHours.toFixed(1)} hours):
          </span>
          <span className="font-medium">{formatCurrency(laborSubtotal)}</span>
        </div>
        <div className="border-t border-gray-200 pt-2">
          <div className="flex justify-between">
            <span className="text-lg font-semibold text-gray-900">Total:</span>
            <span className="text-lg font-bold text-primary">{formatCurrency(totalAmount)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
