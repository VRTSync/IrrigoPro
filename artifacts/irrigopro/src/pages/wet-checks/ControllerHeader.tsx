import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import type { PropertyController } from "@workspace/db/schema";

export function ControllerHeader({
  controller,
  customerId,
  readOnly,
}: {
  controller: PropertyController | undefined;
  customerId: number;
  readOnly: boolean;
}) {
  const { toast } = useToast();
  const [zc, setZc] = useState<string>(String(controller?.zoneCount ?? 100));
  useEffect(() => { setZc(String(controller?.zoneCount ?? 100)); }, [controller?.zoneCount]);

  const updateMut = useMutation({
    mutationFn: (n: number) =>
      apiRequest(`/api/properties/${customerId}/controllers`, "PATCH", { controllerLetter: controller!.controllerLetter, zoneCount: n }),
    onSuccess: () => {
      toast({ title: "Saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/properties", customerId, "controllers"] });
    },
    onError: (e: any) => toast({ title: "Failed", description: e?.message, variant: "destructive" }),
  });

  if (!controller) return null;
  return (
    <Card>
      <CardContent className="py-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-xl font-semibold">Controller {controller.controllerLetter}</div>
          <div className="text-xs text-gray-500">Adjust zone count if wrong</div>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            value={zc}
            onChange={(e) => setZc(e.target.value)}
            className="w-20 h-10 text-base"
            disabled={readOnly}
            data-testid="input-zone-count"
          />
          <Button
            size="sm"
            disabled={readOnly || updateMut.isPending}
            onClick={() => {
              const n = parseInt(zc);
              if (!Number.isFinite(n) || n < 1 || n > 100) return;
              updateMut.mutate(n);
            }}
            data-testid="btn-save-zone-count"
          >
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
