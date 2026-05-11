import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EditIcon, SaveIcon, XIcon, ReceiptIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Customer } from "@workspace/db/schema";

interface BillingNotesProps {
  customer: Customer;
  userRole?: string;
}

export function BillingNotes({ customer, userRole = "company_admin" }: BillingNotesProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [notes, setNotes] = useState(customer.billingNotes || "");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const isBillingManager = userRole === "billing_manager";

  const updateBillingNotes = useMutation({
    mutationFn: async (updatedNotes: string) => {
      return apiRequest(`/api/customers/${customer.id}`, "PATCH", {
        billingNotes: updatedNotes,
      });
    },
    onSuccess: () => {
      toast({
        title: "Billing Notes Updated",
        description: "Billing notes have been saved successfully",
      });
      customer.billingNotes = notes;
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      queryClient.invalidateQueries({ queryKey: [`/api/customers/${customer.id}`] });
      setIsEditing(false);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update billing notes. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    updateBillingNotes.mutate(notes);
  };

  const handleCancel = () => {
    setNotes(customer.billingNotes || "");
    setIsEditing(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <ReceiptIcon className="w-5 h-5 text-indigo-600" />
            <span>Billing Notes</span>
            <span className="text-xs font-normal text-gray-400 ml-1">(billing team only)</span>
          </div>
          {!isEditing && isBillingManager && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsEditing(true)}
              className="h-8 px-3"
            >
              <EditIcon className="w-3 h-3 mr-1" />
              Edit
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isEditing ? (
          <div className="space-y-4">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add private billing notes (payment history, account flags, internal reminders, etc.)"
              className="min-h-[120px] resize-none"
              maxLength={2000}
            />
            <div className="text-xs text-gray-500 mb-3">
              {notes.length}/2000 characters
            </div>
            <div className="flex justify-end space-x-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancel}
                disabled={updateBillingNotes.isPending}
              >
                <XIcon className="w-3 h-3 mr-1" />
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={updateBillingNotes.isPending}
              >
                <SaveIcon className="w-3 h-3 mr-1" />
                {updateBillingNotes.isPending ? "Saving..." : "Save Notes"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="min-h-[80px]">
            {customer.billingNotes ? (
              <div className="whitespace-pre-wrap text-gray-700 text-sm leading-relaxed">
                {customer.billingNotes}
              </div>
            ) : (
              <div className="text-gray-500 text-sm italic text-center py-8 border-2 border-dashed border-gray-200 rounded-lg">
                {isBillingManager
                  ? 'No billing notes added yet. Click "Edit" to add internal billing reminders or payment context.'
                  : "No billing notes have been recorded for this customer."}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
