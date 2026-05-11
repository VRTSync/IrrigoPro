import { safeGet } from "@/utils/safeStorage";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle, Package, ClipboardList, DollarSign } from "lucide-react";
import { useState } from "react";
import type { Part, ManualPartReview } from "@workspace/db/schema";

interface PendingPartRowProps {
  part: Part;
  onApprove: (id: number, price: string, cost: string) => void;
  isApproving: boolean;
}

function PendingPartRow({ part, onApprove, isApproving }: PendingPartRowProps) {
  const [price, setPrice] = useState(part.price?.toString() || "0.00");
  const [cost, setCost] = useState(part.cost?.toString() || "");

  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50/50">
      <td className="px-4 py-3">
        <div className="font-medium text-gray-900 text-sm">{part.name}</div>
        <div className="text-xs text-gray-500">{part.sku} · {part.category}</div>
      </td>
      <td className="px-4 py-3 w-36">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder="0.00"
            className="h-8 text-sm pl-6"
          />
        </div>
      </td>
      <td className="px-4 py-3 w-36">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="0.00"
            className="h-8 text-sm pl-6"
          />
        </div>
      </td>
      <td className="px-4 py-3 w-32 text-right">
        <Button
          size="sm"
          onClick={() => onApprove(part.id, price, cost)}
          disabled={isApproving || !price}
          className="bg-green-600 hover:bg-green-700 text-white gap-1.5"
        >
          <CheckCircle className="w-3.5 h-3.5" />
          Approve
        </Button>
      </td>
    </tr>
  );
}

interface ManualReviewRowProps {
  review: ManualPartReview;
  onApprove: (id: number, price: string) => void;
  isApproving: boolean;
}

function ManualReviewRow({ review, onApprove, isApproving }: ManualReviewRowProps) {
  const [price, setPrice] = useState(review.proposedPrice?.toString() || "0.00");

  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50/50">
      <td className="px-4 py-3">
        <div className="font-medium text-gray-900 text-sm">{review.partName}</div>
        <div className="text-xs text-gray-500">Billing Sheet #{review.billingSheetId}</div>
      </td>
      <td className="px-4 py-3 text-sm text-gray-600">
        ${parseFloat(review.proposedPrice).toFixed(2)}
      </td>
      <td className="px-4 py-3 w-36">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="0.00"
            className="h-8 text-sm pl-6"
          />
        </div>
      </td>
      <td className="px-4 py-3 w-32 text-right">
        <Button
          size="sm"
          onClick={() => onApprove(review.id, price)}
          disabled={isApproving || !price}
          className="bg-green-600 hover:bg-green-700 text-white gap-1.5"
        >
          <CheckCircle className="w-3.5 h-3.5" />
          Approve
        </Button>
      </td>
    </tr>
  );
}

export default function PartsPendingApproval() {
  const { toast } = useToast();

  const { data: pendingParts = [], isLoading: loadingParts } = useQuery<Part[]>({
    queryKey: ["/api/parts/pending-approval"],
  });

  const { data: manualReviews = [], isLoading: loadingReviews } = useQuery<ManualPartReview[]>({
    queryKey: ["/api/manual-part-reviews"],
  });

  const approvePartMutation = useMutation({
    mutationFn: ({ id, price, cost }: { id: number; price: string; cost: string }) =>
      apiRequest(`/api/parts/${id}/approve`, "POST", { price, cost }),
    onSuccess: () => {
      toast({ title: "Part approved", description: "Pricing has been confirmed and pushed to open billing sheets." });
      queryClient.invalidateQueries({ queryKey: ["/api/parts/pending-approval"] });
      queryClient.invalidateQueries({ queryKey: ["/api/parts"] });
    },
    onError: () => toast({ title: "Failed to approve part", variant: "destructive" }),
  });

  const approveReviewMutation = useMutation({
    mutationFn: ({ id, reviewedPrice }: { id: number; reviewedPrice: string }) =>
      apiRequest(`/api/manual-part-reviews/${id}/approve`, "POST", { reviewedPrice }),
    onSuccess: () => {
      toast({ title: "Manual part approved", description: "The price has been locked in on the billing sheet." });
      queryClient.invalidateQueries({ queryKey: ["/api/manual-part-reviews"] });
    },
    onError: () => toast({ title: "Failed to approve manual part", variant: "destructive" }),
  });

  const totalPending = pendingParts.length + manualReviews.length;
  const isLoading = loadingParts || loadingReviews;

  return (
    <div className="space-y-6 p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-orange-100 rounded-xl">
          <ClipboardList className="w-5 h-5 text-orange-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Parts Pending Approval</h1>
          <p className="text-sm text-gray-500">Review and confirm pricing before billing</p>
        </div>
        {totalPending > 0 && (
          <Badge variant="destructive" className="ml-auto text-sm px-2.5 py-1">
            {totalPending} pending
          </Badge>
        )}
      </div>

      {/* New Catalog Parts Section */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 text-blue-600" />
            <CardTitle className="text-base">New Catalog Parts</CardTitle>
            {pendingParts.length > 0 && (
              <Badge variant="secondary" className="ml-auto">{pendingParts.length}</Badge>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Parts recently added to the catalog that need cost and price confirmation.
          </p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2].map(i => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : pendingParts.length === 0 ? (
            <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-xl">
              <CheckCircle className="w-8 h-8 text-green-400 mx-auto mb-2" />
              <p className="text-sm text-gray-500">No catalog parts awaiting approval</p>
            </div>
          ) : (
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-left px-4 py-2.5 font-medium text-gray-600">Part</th>
                    <th className="text-left px-4 py-2.5 font-medium text-gray-600 w-36">Cost ($)</th>
                    <th className="text-left px-4 py-2.5 font-medium text-gray-600 w-36">Price ($)</th>
                    <th className="w-32"></th>
                  </tr>
                </thead>
                <tbody>
                  {pendingParts.map(part => (
                    <PendingPartRow
                      key={part.id}
                      part={part}
                      onApprove={(id, price, cost) => approvePartMutation.mutate({ id, price, cost })}
                      isApproving={approvePartMutation.isPending}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Manual Parts from Billing Sheets Section */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-orange-600" />
            <CardTitle className="text-base">Manually Entered Parts (from Billing Sheets)</CardTitle>
            {manualReviews.length > 0 && (
              <Badge variant="secondary" className="ml-auto">{manualReviews.length}</Badge>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Parts entered manually by technicians that aren't in the catalog. Confirm the price to lock it in.
          </p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2].map(i => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : manualReviews.length === 0 ? (
            <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-xl">
              <CheckCircle className="w-8 h-8 text-green-400 mx-auto mb-2" />
              <p className="text-sm text-gray-500">No manual parts awaiting review</p>
            </div>
          ) : (
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-left px-4 py-2.5 font-medium text-gray-600">Part Name</th>
                    <th className="text-left px-4 py-2.5 font-medium text-gray-600">Proposed Price</th>
                    <th className="text-left px-4 py-2.5 font-medium text-gray-600 w-36">Confirmed Price ($)</th>
                    <th className="w-32"></th>
                  </tr>
                </thead>
                <tbody>
                  {manualReviews.map(review => (
                    <ManualReviewRow
                      key={review.id}
                      review={review}
                      onApprove={(id, reviewedPrice) => approveReviewMutation.mutate({ id, reviewedPrice })}
                      isApproving={approveReviewMutation.isPending}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
