import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { useCustomerRecordsLock } from "@/hooks/use-customer-records-lock";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, parseApiError } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export function CustomerRecordsCard({ companyId, canEdit }: { companyId: number; canEdit: boolean }) {
  const lock = useCustomerRecordsLock();
  const [locked, setLocked] = useState(lock.locked);
  const [name, setName] = useState(lock.systemName ?? "");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    if (!lock.isLoading) {
      setLocked(lock.locked);
      setName(lock.systemName ?? "");
    }
  }, [lock.isLoading, lock.locked, lock.systemName]);

  const mutation = useMutation({
    mutationFn: () => apiRequest(`/api/company/${companyId}/customer-records`, "PUT", {
      locked,
      systemName: name.trim() === "" ? null : name.trim(),
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/company/customer-records"] });
      toast({ title: "Customer records setting saved" });
    },
    onError: (error) => toast({
      title: "Error",
      description: parseApiError(error, "Failed to update customer records settings"),
      variant: "destructive",
    }),
  });
  const changed = locked !== lock.locked || name !== (lock.systemName ?? "");
  const cannotEnable = !locked && !lock.quickbooksConnected;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" />Customer records</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">Turn this on when customers are created and their billing details edited in another system (like your CRM) and reach IrrigoPro through QuickBooks. IrrigoPro-only details (display name, rates, budgets, notes) stay editable here.</p>
        <div className="flex items-center gap-3">
          <Switch id="customer-records-locked" checked={locked} onCheckedChange={setLocked} disabled={!canEdit || lock.isLoading || mutation.isPending || cannotEnable} />
          <Label htmlFor="customer-records-locked">Customer details are managed outside IrrigoPro</Label>
        </div>
        {cannotEnable && !lock.isLoading && <p className="text-sm text-slate-500">Connect QuickBooks first. While locked, customers can only arrive from QuickBooks.</p>}
        <div className="space-y-2">
          <Label htmlFor="customer-records-system-name">Managed in</Label>
          <Input id="customer-records-system-name" placeholder="High Plains CRM" maxLength={60} value={name} onChange={(event) => setName(event.target.value)} disabled={!canEdit || lock.isLoading || mutation.isPending} />
        </div>
        {lock.locked && !lock.quickbooksConnected && <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">QuickBooks is disconnected. New customers can't reach IrrigoPro until it is reconnected.</div>}
        {canEdit && <Button onClick={() => mutation.mutate()} disabled={lock.isLoading || mutation.isPending || !changed}>Save</Button>}
      </CardContent>
    </Card>
  );
}
