import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { IrrigationController } from "@workspace/db/schema";
import { apiRequest, parseApiError } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Clock = IrrigationController & { zones?: unknown[] };

/** Mounted only while open, so reopening initializes from freshly fetched clocks. */
export function ReletterDialog({ customerId, branchName, controllers, onClose }: {
  customerId: number;
  branchName: string;
  controllers: Clock[];
  onClose: () => void;
}) {
  const clocks = controllers.filter(c => c.isActive && (c.branchName ?? "") === branchName)
    .slice().sort((a, b) => (a.letter ?? "\uffff").localeCompare(b.letter ?? "\uffff") || a.id - b.id);
  const [letters, setLetters] = useState<Record<number, string>>(() =>
    Object.fromEntries(clocks.map(c => [c.id, c.letter ?? ""])));
  const [error, setError] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const counts = new Map<string, number>();
  for (const c of clocks) counts.set(letters[c.id], (counts.get(letters[c.id]) ?? 0) + 1);
  const changed = clocks.filter(c => (c.letter ?? "") !== letters[c.id]);
  const invalid = clocks.some(c => !/^[A-Z]$/.test(letters[c.id]) || (counts.get(letters[c.id]) ?? 0) > 1);

  const save = useMutation({
    mutationFn: () => apiRequest(`/api/customers/${customerId}/controllers/letters`, "PUT", {
      branchName, letters: clocks.map(c => ({ controllerId: c.id, letter: letters[c.id] })),
    }) as Promise<{ changed: number; controllers: IrrigationController[] }>,
    onSuccess: async result => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [`/api/customers/${customerId}/controllers-profile`] }),
        queryClient.invalidateQueries({ queryKey: ["/api/properties", customerId, "controllers"] }),
        ...changed.map(c => queryClient.invalidateQueries({ queryKey: [`/api/irrigation-controllers/${c.id}/history`] })),
      ]);
      toast({ title: `${result.changed} ${result.changed === 1 ? "clock" : "clocks"} re-lettered` });
      onClose();
    },
    onError: e => setError(parseApiError(e, "Could not re-letter — please retry")),
  });

  return <Dialog open onOpenChange={open => { if (!open && !save.isPending) onClose(); }}>
    <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto" style={{ width: "calc(100vw - 2rem)" }}>
      <DialogHeader>
        <DialogTitle>Re-letter clocks</DialogTitle>
        <DialogDescription>Give each clock its letter in walking order. Each clock keeps all of its zones, wet checks and billing. Only its name changes. Changed clocks will need their letter confirmed on site.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        {clocks.map(c => <div key={c.id} className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <label htmlFor={`reletter-${c.id}`} className="text-sm font-medium">Controller {c.letter ?? "unassigned"}</label>
            <p className="text-xs text-muted-foreground">
              {[c.location, [c.brand, c.model].filter(Boolean).join(" "), `${c.zones?.length ?? c.totalZones ?? 0} zones`].filter(Boolean).join(" · ")}
            </p>
            {(counts.get(letters[c.id]) ?? 0) > 1 && <p className="text-xs text-red-700">Used twice</p>}
          </div>
          {(c.letter ?? "") !== letters[c.id] && <span className="text-blue-700 font-medium">→ {letters[c.id]}</span>}
          <select id={`reletter-${c.id}`} data-testid={`select-letter-${c.id}`}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={letters[c.id]} disabled={save.isPending}
            onChange={e => { setLetters({ ...letters, [c.id]: e.target.value }); setError(""); }}>
            {!c.letter && <option value="" disabled>Choose</option>}
            {Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ", letter => <option key={letter} value={letter}>{letter}</option>)}
          </select>
        </div>)}
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <p className="text-sm">{changed.length} {changed.length === 1 ? "clock" : "clocks"} will be renamed</p>
      <DialogFooter>
        <Button variant="outline" disabled={save.isPending} onClick={onClose}>Cancel</Button>
        <Button data-testid="button-save-letters" disabled={invalid || !changed.length || save.isPending}
          onClick={() => { setError(""); save.mutate(); }}>{save.isPending ? "Saving…" : "Save letters"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
