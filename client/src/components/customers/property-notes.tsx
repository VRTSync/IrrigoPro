import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EditIcon, SaveIcon, XIcon, StickyNoteIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Customer } from "@shared/schema";

interface PropertyNotesProps {
  customer: Customer;
}

export function PropertyNotes({ customer }: PropertyNotesProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [notes, setNotes] = useState(customer.propertyNotes || "");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const updatePropertyNotes = useMutation({
    mutationFn: async (updatedNotes: string) => {
      return apiRequest(`/api/customers/${customer.id}`, "PATCH", {
        propertyNotes: updatedNotes,
      });
    },
    onSuccess: () => {
      toast({
        title: "Property Notes Updated",
        description: "Property notes have been saved successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      queryClient.invalidateQueries({ queryKey: [`/api/customers/${customer.id}`] });
      setIsEditing(false);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: "Failed to update property notes",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    updatePropertyNotes.mutate(notes);
  };

  const handleCancel = () => {
    setNotes(customer.propertyNotes || "");
    setIsEditing(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <StickyNoteIcon className="w-5 h-5 text-orange-600" />
            <span>Property Notes</span>
          </div>
          {!isEditing && (
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
              placeholder="Add property-specific notes for technicians (access codes, special instructions, equipment locations, etc.)"
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
                disabled={updatePropertyNotes.isPending}
              >
                <XIcon className="w-3 h-3 mr-1" />
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={updatePropertyNotes.isPending}
              >
                <SaveIcon className="w-3 h-3 mr-1" />
                {updatePropertyNotes.isPending ? "Saving..." : "Save Notes"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="min-h-[80px]">
            {customer.propertyNotes ? (
              <div className="whitespace-pre-wrap text-gray-700 text-sm leading-relaxed">
                {customer.propertyNotes}
              </div>
            ) : (
              <div className="text-gray-500 text-sm italic text-center py-8 border-2 border-dashed border-gray-200 rounded-lg">
                No property notes added yet. Click "Edit" to add important information about this property for field technicians.
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}