import { useRef, useState, type ReactNode } from "react";
import { Reorder, useDragControls } from "framer-motion";
import { ArrowDown, ArrowUp, GripVertical, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import type { DocumentationControllerGraph, DocumentationSite, DocumentationControllerOrder } from "@workspace/api-client-react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { docSiteKey } from "./use-doc-site";
import { serverMessage } from "./constants";

type Controller = DocumentationControllerGraph;
const ROW = "flex min-h-[68px] w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-left shadow-sm";

function SortableController({ controller, index, count, disabled, body, move }: {
  controller: Controller; index: number; count: number; disabled: boolean; body: ReactNode;
  move: (id: number, direction: number) => void;
}) {
  const controls = useDragControls();
  const name = controller.name?.trim() || `Controller ${controller.letter ?? "?"}`;
  return (
    <Reorder.Item value={controller.id} dragListener={false} dragControls={controls}
      as="li" className={`${ROW} relative flex-wrap gap-2`} data-testid={`reorder-controller-${controller.id}`}
      onDrag={(_, info) => {
        if (info.point.y > window.innerHeight - 90) window.scrollBy(0, 10);
        else if (info.point.y < 90) window.scrollBy(0, -10);
      }}>
      <button type="button" aria-label={`Drag ${name}`} disabled={disabled}
        className="flex h-11 w-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-muted-foreground active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-primary"
        onPointerDown={e => { if (!disabled) controls.start(e); }}>
        <GripVertical className="h-5 w-5" aria-hidden />
      </button>
      <div className="flex min-w-0 flex-1 items-center gap-2">{body}</div>
      <div className="flex w-full items-center justify-end gap-1 border-t border-slate-100 pt-1">
        <span className="mr-auto text-xs text-muted-foreground">Position {index + 1} of {count}</span>
        <Button type="button" variant="ghost" className="h-11 w-11 p-0" disabled={disabled || index === 0}
          aria-label={`Move ${name} up`} onClick={() => move(controller.id, -1)}><ArrowUp className="h-4 w-4" aria-hidden /></Button>
        <Button type="button" variant="ghost" className="h-11 w-11 p-0" disabled={disabled || index === count - 1}
          aria-label={`Move ${name} down`} onClick={() => move(controller.id, 1)}><ArrowDown className="h-4 w-4" aria-hidden /></Button>
      </div>
    </Reorder.Item>
  );
}

export function ControllerOrderList({ customerId, branchName, controllers, disabled, onEditingChange, onOpen, renderBody }: {
  customerId: number; branchName: string; controllers: Controller[]; disabled: boolean;
  onEditingChange: (editing: boolean) => void; onOpen: (id: number) => void;
  renderBody: (controller: Controller) => ReactNode;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<{ original: Controller[]; ids: number[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  function cancel() {
    setDraft(null); setError(null); setAnnouncement(""); onEditingChange(false);
  }
  function move(id: number, direction: number) {
    if (!draft || savingRef.current) return;
    const ids = [...draft.ids], index = ids.indexOf(id), next = index + direction;
    if (index < 0 || next < 0 || next >= ids.length) return;
    [ids[index], ids[next]] = [ids[next], ids[index]];
    setDraft({ ...draft, ids });
    setAnnouncement(`Controller moved to position ${next + 1} of ${ids.length}.`);
    setError(null);
  }
  async function save() {
    if (!draft || savingRef.current) return;
    savingRef.current = true; setSaving(true); setError(null);
    try {
      const result: DocumentationControllerOrder = await apiRequest(
        `/api/system-documentation/customers/${customerId}/site/controller-order`, "PUT",
        { branchName, controllerIds: draft.ids, previousControllerIds: draft.original.map(c => c.id) },
      );
      if (!Array.isArray(result?.controllerIds) || result.controllerIds.length !== draft.ids.length ||
        result.controllerIds.some((id, i) => id !== draft.ids[i])) throw new Error("Could not confirm the saved order. Please retry.");
      qc.setQueryData<DocumentationSite>(docSiteKey(customerId, branchName), old => {
        if (!old) return old;
        const rows = new Map(old.controllers.map(c => [c.id, c]));
        return { ...old, controllers: result.controllerIds.flatMap(id => rows.has(id) ? [rows.get(id)!] : []) };
      });
      cancel(); setSaved(true);
      void qc.invalidateQueries({ queryKey: docSiteKey(customerId, branchName), exact: true });
    } catch (e) {
      setError(serverMessage(e));
      // Retain the attempted draft, but fetch current membership/order for Cancel and retry.
      void qc.invalidateQueries({ queryKey: docSiteKey(customerId, branchName), exact: true });
    } finally { savingRef.current = false; setSaving(false); }
  }

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Controllers</h3>
        {!draft && controllers.length > 1 && (
          <Button type="button" variant="ghost" className="h-11 text-primary" disabled={disabled}
            onClick={() => {
              setDraft({ original: [...controllers], ids: controllers.map(c => c.id) });
              setSaved(false); setError(null); onEditingChange(true);
            }}>Reorder</Button>
        )}
      </div>
      {saved && <p role="status" className="text-sm font-medium text-green-800">Controller order saved.</p>}
      {draft ? (
        <>
          <p className="text-sm text-muted-foreground">Drag the handles or use the arrows. Letters and controller details stay the same.</p>
          <div className="sticky top-0 z-20 flex flex-col gap-2 bg-slate-50 py-2">
            {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
            <div className="flex gap-2">
              <Button type="button" className="h-12 flex-1" disabled={saving} onClick={() => void save()}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
                {saving ? "Saving…" : error ? "Retry save" : "Save order"}
              </Button>
              <Button type="button" variant="outline" className="h-12 flex-1" disabled={saving} onClick={cancel}>Cancel</Button>
            </div>
          </div>
          <Reorder.Group axis="y" values={draft.ids} as="ol" className="flex flex-col gap-2" aria-label="Reorder controllers"
            onReorder={ids => { if (!savingRef.current) setDraft({ ...draft, ids }); }}>
            {draft.ids.map((id, index) => {
              const controller = draft.original.find(c => c.id === id)!;
              return <SortableController key={id} controller={controller} index={index} count={draft.ids.length}
                disabled={saving} body={renderBody(controller)} move={move} />;
            })}
          </Reorder.Group>
          <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
        </>
      ) : controllers.map(c => (
        <button key={c.id} type="button" onClick={() => onOpen(c.id)} disabled={disabled}
          className={`${ROW} transition-transform active:scale-[0.99]`} data-testid={`row-controller-${c.id}`}>{renderBody(c)}</button>
      ))}
    </>
  );
}
