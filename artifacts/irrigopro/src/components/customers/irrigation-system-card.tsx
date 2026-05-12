import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Cpu, Droplets, Minus, Plus, Loader2 } from "lucide-react";
import { apiRequest, queryClient, useArrayQuery } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Customer, PropertyController } from "@workspace/db/schema";

const DEFAULT_ZONE_COUNT = 12;
const MAX_CONTROLLERS = 26;
const MIN_CONTROLLERS = 1;
const MIN_ZONES = 1;
const MAX_ZONES = 100;

function letterFor(index: number) {
  return String.fromCharCode("A".charCodeAt(0) + index);
}

interface IrrigationSystemCardProps {
  customer: Customer;
  canEdit: boolean;
}

export function IrrigationSystemCard({ customer, canEdit }: IrrigationSystemCardProps) {
  const { toast } = useToast();
  const customerId = customer.id;
  const totalControllers = Math.max(
    MIN_CONTROLLERS,
    Math.min(MAX_CONTROLLERS, customer.totalControllers ?? 1),
  );

  const { data: controllers = [], isLoading } = useArrayQuery<PropertyController>({
    queryKey: ["/api/properties", customerId, "controllers"],
  });

  const controllersByLetter = useMemo(() => {
    const map = new Map<string, PropertyController>();
    (controllers ?? []).forEach((c) => map.set(c.controllerLetter, c));
    return map;
  }, [controllers]);

  const letters = useMemo(
    () => Array.from({ length: totalControllers }, (_, i) => letterFor(i)),
    [totalControllers],
  );

  const totalZones = letters.reduce((sum, letter) => {
    const row = controllersByLetter.get(letter);
    return sum + (row?.zoneCount ?? DEFAULT_ZONE_COUNT);
  }, 0);

  const updateTotalControllers = useMutation({
    mutationFn: async (next: number) => {
      return await apiRequest(`/api/customers/${customerId}`, "PATCH", {
        totalControllers: next,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/customers/${customerId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/properties", customerId, "controllers"] });
      toast({ title: "Controllers updated" });
    },
    onError: (err: any) => {
      toast({
        title: "Could not update controllers",
        description: err?.message ?? "Try again in a moment.",
        variant: "destructive",
      });
    },
  });

  const updateZoneCount = useMutation({
    mutationFn: async (vars: { letter: string; zoneCount: number }) => {
      return await apiRequest(`/api/properties/${customerId}/controllers`, "PATCH", {
        controllerLetter: vars.letter,
        zoneCount: vars.zoneCount,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/properties", customerId, "controllers"] });
      toast({ title: "Zone count updated" });
    },
    onError: (err: any) => {
      toast({
        title: "Could not update zone count",
        description: err?.message ?? "Try again in a moment.",
        variant: "destructive",
      });
    },
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2">
            <Droplets className="w-5 h-5 text-blue-600" />
            Irrigation System
          </CardTitle>
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-sm text-gray-600">
              <span className="font-semibold text-gray-900">{totalControllers}</span>{" "}
              {totalControllers === 1 ? "controller" : "controllers"}
              <span className="mx-2 text-gray-300">•</span>
              <span className="font-semibold text-gray-900">{totalZones}</span>{" "}
              {totalZones === 1 ? "zone" : "zones"}
            </div>
            {canEdit && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Controllers</span>
                <Select
                  value={String(totalControllers)}
                  onValueChange={(value) => {
                    const next = Number(value);
                    if (next !== totalControllers && !updateTotalControllers.isPending) {
                      updateTotalControllers.mutate(next);
                    }
                  }}
                  disabled={updateTotalControllers.isPending}
                >
                  <SelectTrigger className="h-8 w-[80px]" data-testid="select-total-controllers">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: MAX_CONTROLLERS }, (_, i) => i + 1).map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {updateTotalControllers.isPending && (
                  <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                )}
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            <div className="h-24 bg-gray-100 rounded-lg animate-pulse" />
            <div className="h-24 bg-gray-100 rounded-lg animate-pulse" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {letters.map((letter) => {
              const row = controllersByLetter.get(letter);
              const zoneCount = row?.zoneCount ?? DEFAULT_ZONE_COUNT;
              return (
                <ControllerTile
                  key={letter}
                  letter={letter}
                  zoneCount={zoneCount}
                  canEdit={canEdit}
                  isSaving={
                    updateZoneCount.isPending &&
                    updateZoneCount.variables?.letter === letter
                  }
                  onSave={(next) =>
                    updateZoneCount.mutate({ letter, zoneCount: next })
                  }
                />
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface ControllerTileProps {
  letter: string;
  zoneCount: number;
  canEdit: boolean;
  isSaving: boolean;
  onSave: (next: number) => void;
}

function ControllerTile({
  letter,
  zoneCount,
  canEdit,
  isSaving,
  onSave,
}: ControllerTileProps) {
  const [draft, setDraft] = useState<number>(zoneCount);

  // Keep the local draft in sync when the server value changes (e.g. after a
  // cache invalidate). Skip while saving so we don't clobber the user's input.
  useEffect(() => {
    if (!isSaving) setDraft(zoneCount);
  }, [zoneCount, isSaving]);

  const clamp = (n: number) =>
    Math.max(MIN_ZONES, Math.min(MAX_ZONES, Math.floor(n) || MIN_ZONES));

  const commit = (next: number) => {
    const clamped = clamp(next);
    setDraft(clamped);
    if (clamped !== zoneCount) onSave(clamped);
  };

  return (
    <div
      className="rounded-xl border border-gray-200 bg-gradient-to-br from-blue-50/40 to-white p-4"
      data-testid={`controller-tile-${letter}`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-blue-600 text-white font-bold flex items-center justify-center shadow-sm">
            {letter}
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">Controller {letter}</p>
            <p className="text-xs text-gray-500 flex items-center gap-1">
              <Cpu className="w-3 h-3" />
              {zoneCount} {zoneCount === 1 ? "zone" : "zones"}
            </p>
          </div>
        </div>
        {canEdit && (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => commit(draft - 1)}
              disabled={isSaving || draft <= MIN_ZONES}
              data-testid={`button-zone-decrement-${letter}`}
            >
              <Minus className="w-3 h-3" />
            </Button>
            <Input
              type="number"
              min={MIN_ZONES}
              max={MAX_ZONES}
              value={draft}
              onChange={(e) => setDraft(Number(e.target.value) || MIN_ZONES)}
              onBlur={() => commit(draft)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.currentTarget.blur();
                }
              }}
              disabled={isSaving}
              className="h-7 w-14 text-center text-sm"
              data-testid={`input-zone-count-${letter}`}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => commit(draft + 1)}
              disabled={isSaving || draft >= MAX_ZONES}
              data-testid={`button-zone-increment-${letter}`}
            >
              <Plus className="w-3 h-3" />
            </Button>
            {isSaving && <Loader2 className="w-4 h-4 animate-spin text-gray-400 ml-1" />}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: zoneCount }, (_, i) => i + 1).map((zone) => (
          <span
            key={zone}
            className="inline-flex items-center justify-center min-w-[28px] h-7 px-1.5 rounded-md bg-white border border-blue-200 text-xs font-medium text-blue-900 shadow-sm"
            data-testid={`zone-chip-${letter}-${zone}`}
          >
            {zone}
          </span>
        ))}
      </div>
    </div>
  );
}

