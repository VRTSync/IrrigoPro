import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Tag } from "lucide-react";
import {
  useGetCustomerMarkupOverride,
  useGetMarkupScheduleOptions,
  useSetCustomerMarkupOverride,
  useRemoveCustomerMarkupOverride,
  getGetCustomerMarkupOverrideQueryKey,
  getGetMarkupScheduleOptionsQueryKey,
} from "@workspace/api-client-react";
import { CAN_ASSIGN_MARKUP_SCHEDULES, hasCapability } from "@workspace/shared";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { errorMessage } from "@/lib/markup-tier-form";

const COMPANY_DEFAULT = "company-default";

interface CustomerMarkupOverrideProps {
  customerId: number;
  /** The customer's own company — used as explicit scope for unscoped super admins. */
  companyId: number;
  /** Signed-in role; unknown/null fails closed. */
  role: string | null | undefined;
}

export function CustomerMarkupOverride({ customerId, companyId, role }: CustomerMarkupOverrideProps) {
  const canAssign = hasCapability(role, CAN_ASSIGN_MARKUP_SCHEDULES);
  const params = role === "super_admin" ? { companyId } : undefined;
  const { toast } = useToast();
  const qc = useQueryClient();

  const overrideKey = getGetCustomerMarkupOverrideQueryKey(customerId, params);
  const override = useGetCustomerMarkupOverride(customerId, params, {
    query: { enabled: canAssign && customerId > 0, queryKey: overrideKey },
  });
  const options = useGetMarkupScheduleOptions(params, {
    query: { enabled: canAssign, queryKey: getGetMarkupScheduleOptionsQueryKey(params) },
  });
  const setOverride = useSetCustomerMarkupOverride();
  const removeOverride = useRemoveCustomerMarkupOverride();

  const current = override.data?.override?.scheduleId;
  const currentValue = current ? String(current) : COMPANY_DEFAULT;
  const [value, setValue] = useState(currentValue);
  useEffect(() => setValue(currentValue), [currentValue]);

  if (!canAssign) return null;

  const pending = setOverride.isPending || removeOverride.isPending;
  const loading = override.isLoading || options.isLoading;
  const loadError = override.error ?? options.error;

  const done = (msg: string) => {
    toast({ title: msg });
    qc.invalidateQueries({ queryKey: overrideKey });
  };
  const fail = (e: unknown) =>
    toast({ title: "Pricing not saved", description: errorMessage(e, "Please try again."), variant: "destructive" });

  const save = () => {
    if (value === currentValue) return;
    if (value === COMPANY_DEFAULT) {
      removeOverride.mutate(
        { id: customerId, params },
        { onSuccess: () => done("Customer now uses the company default"), onError: fail },
      );
    } else {
      setOverride.mutate(
        { id: customerId, data: { scheduleId: Number(value) }, params },
        { onSuccess: () => done("Markup schedule assigned"), onError: fail },
      );
    }
  };

  return (
    <Card data-testid="card-customer-pricing">
      <CardHeader>
        <CardTitle className="flex items-center text-lg">
          <Tag className="mr-2 h-5 w-5" aria-hidden /> Pricing
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="skeleton-shimmer h-10 w-full" />
        ) : loadError ? (
          <div className="text-sm text-red-700" data-testid="status-pricing-error">
            {errorMessage(loadError, "Could not load pricing options.")}{" "}
            <button
              type="button"
              className="underline"
              onClick={() => {
                override.refetch();
                options.refetch();
              }}
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Label htmlFor={`markup-schedule-${customerId}`}>Material markup schedule</Label>
              <Select value={value} onValueChange={(v) => { if (v) setValue(v); }} disabled={pending}>
                <SelectTrigger id={`markup-schedule-${customerId}`} data-testid="select-customer-markup">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={COMPANY_DEFAULT}>Company Default</SelectItem>
                  {(options.data ?? []).map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name}{s.isActive ? " (active default)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-gray-500">
                Applies to newly added catalog lines. Existing document lines keep their recorded prices.
              </p>
            </div>
            <Button
              type="button"
              onClick={save}
              disabled={pending || value === currentValue}
              data-testid="button-save-customer-markup"
            >
              {pending ? "Saving..." : "Save Pricing"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
