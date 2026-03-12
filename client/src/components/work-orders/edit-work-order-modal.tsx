import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { WorkOrder, User as UserType } from "@shared/schema";

const editWorkOrderSchema = z.object({
  projectName: z.string().min(1, "Project name is required"),
  description: z.string().optional(),
  projectAddress: z.string().optional(),
  locationNotes: z.string().optional(),
  scheduledDate: z.string().optional(),
  priority: z.string(),
  specialInstructions: z.string().optional(),
  notes: z.string().optional(),
  assignedTechnicianId: z.number().nullable().optional(),
  assignedTechnicianName: z.string().optional(),
});

type EditWorkOrderFormData = z.infer<typeof editWorkOrderSchema>;

interface EditWorkOrderModalProps {
  workOrder: WorkOrder;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function EditWorkOrderModal({ workOrder, open, onClose, onSuccess }: EditWorkOrderModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: fieldTechs } = useQuery<UserType[]>({
    queryKey: ["/api/users/field-techs"],
  });

  const formatDateForInput = (date: string | Date | null | undefined): string => {
    if (!date) return "";
    const d = new Date(date);
    if (isNaN(d.getTime())) return "";
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };

  const form = useForm<EditWorkOrderFormData>({
    resolver: zodResolver(editWorkOrderSchema),
    defaultValues: {
      projectName: workOrder.projectName || "",
      description: workOrder.description || "",
      projectAddress: workOrder.projectAddress || "",
      locationNotes: workOrder.locationNotes || "",
      scheduledDate: formatDateForInput(workOrder.scheduledDate),
      priority: workOrder.priority || "medium",
      specialInstructions: workOrder.specialInstructions || "",
      notes: workOrder.notes || "",
      assignedTechnicianId: workOrder.assignedTechnicianId || null,
      assignedTechnicianName: workOrder.assignedTechnicianName || "",
    },
  });

  const updateWorkOrder = useMutation({
    mutationFn: async (data: EditWorkOrderFormData) => {
      const submitData: Partial<WorkOrder> & { scheduledDate: string | null } = {
        projectName: data.projectName,
        description: data.description || "",
        projectAddress: data.projectAddress || "",
        locationNotes: data.locationNotes || "",
        scheduledDate: data.scheduledDate ? new Date(data.scheduledDate).toISOString() : null,
        priority: data.priority,
        specialInstructions: data.specialInstructions || "",
        notes: data.notes || "",
        assignedTechnicianId: data.assignedTechnicianId ? Number(data.assignedTechnicianId) : null,
        assignedTechnicianName: data.assignedTechnicianId ? (data.assignedTechnicianName || "") : "",
      };
      return apiRequest(`/api/work-orders/${workOrder.id}`, "PATCH", submitData);
    },
    onSuccess: () => {
      toast({
        title: "Work Order Updated",
        description: "Work order has been updated successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      onSuccess();
      onClose();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update work order",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: EditWorkOrderFormData) => {
    updateWorkOrder.mutate(data);
  };

  const managers = fieldTechs?.filter(u => u.role === 'irrigation_manager') || [];
  const techs = fieldTechs?.filter(u => u.role === 'field_tech') || [];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="w-screen h-screen sm:w-[95vw] sm:max-w-3xl sm:h-auto sm:max-h-[90vh] sm:rounded-lg overflow-hidden p-0 flex flex-col">
        <DialogHeader className="p-4 sm:p-6 border-b border-gray-200 flex-shrink-0">
          <DialogTitle className="text-lg sm:text-xl">Edit Work Order</DialogTitle>
          <DialogDescription>
            Update work order details for {workOrder.workOrderNumber}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <FormField
                control={form.control}
                name="projectName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter project name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Describe the work to be performed..."
                        className="min-h-[80px]"
                        {...field}
                        value={field.value || ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="projectAddress"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project Address</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter project address" {...field} value={field.value || ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="locationNotes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Location Notes</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Additional notes about the work location..."
                        className="min-h-[60px]"
                        {...field}
                        value={field.value || ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="priority"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Priority</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select priority" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="low">Low</SelectItem>
                          <SelectItem value="medium">Medium</SelectItem>
                          <SelectItem value="high">High</SelectItem>
                          <SelectItem value="urgent">Urgent</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="scheduledDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Scheduled Date</FormLabel>
                      <FormControl>
                        <Input type="datetime-local" {...field} value={field.value || ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="assignedTechnicianId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Assign To</FormLabel>
                      <Select
                        onValueChange={(value) => {
                          if (value === "__unassign__") {
                            field.onChange(null);
                            form.setValue("assignedTechnicianName", "");
                          } else {
                            const techId = parseInt(value);
                            field.onChange(techId);
                            const selectedTech = fieldTechs?.find(tech => tech.id === techId);
                            if (selectedTech) {
                              form.setValue("assignedTechnicianName", selectedTech.name);
                            }
                          }
                        }}
                        value={field.value?.toString() || "__unassign__"}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select person" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="__unassign__">Unassigned</SelectItem>
                          {managers.length > 0 && (
                            <>
                              <div className="px-2 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Managers</div>
                              {managers.map((user) => (
                                <SelectItem key={user.id} value={user.id.toString()}>
                                  {user.name}
                                </SelectItem>
                              ))}
                            </>
                          )}
                          {techs.length > 0 && (
                            <>
                              <div className="px-2 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider border-t mt-1 pt-1">Field Techs</div>
                              {techs.map((user) => (
                                <SelectItem key={user.id} value={user.id.toString()}>
                                  {user.name}
                                </SelectItem>
                              ))}
                            </>
                          )}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="specialInstructions"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Special Instructions</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Any special instructions for the technician..."
                        className="min-h-[60px]"
                        {...field}
                        value={field.value || ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Internal Notes</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Internal notes (not visible to customer)..."
                        className="min-h-[60px]"
                        {...field}
                        value={field.value || ""}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex gap-3 pt-4 border-t">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onClose}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={updateWorkOrder.isPending}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {updateWorkOrder.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
