import { useEffect, useRef, useState } from "react";
import { Info, Minus, Plus, X } from "lucide-react";
import type { DocumentationProgram, DocumentationZone } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DocChip } from "./doc-chip";
import { DOC_ZONE_TYPES, WEEK_DAYS } from "./constants";
import {
  applyRun, applyType, editProgram, programView, zoneTypeInfo,
  type Slice5Handle,
} from "./slice5-model";

const stepperBtn = "h-[60px] w-[60px] shrink-0 rounded-xl";

function ZonesLoading({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-3" data-testid="doc-zones-loading">
      <div className="grid grid-cols-5 gap-2" aria-hidden>
        {Array.from({ length: 10 }, (_, i) => <div key={i} className="skeleton-shimmer h-[60px] rounded-xl" />)}
      </div>
      <p className="text-sm text-muted-foreground">Loading this clock's zones.</p>
      <button type="button" className="min-h-11 self-start text-sm font-semibold text-primary" onClick={onRetry} data-testid="button-zones-reload">Reload zones</button>
    </div>
  );
}

// ── Zone types ───────────────────────────────────────────────────────────────

export function ZoneTypesStep({ zones, ready, h, onReload }: { zones: DocumentationZone[]; ready: boolean; h: Slice5Handle; onReload: () => void }) {
  const d = h.draft;
  const brush = zoneTypeInfo(d.brush);
  const untyped = zones.filter((z) => !z.zoneTypeConfirmed);
  return (
    <section className="flex flex-col gap-4" data-testid="step-zone-types">
      <div>
        <h2 className="text-base font-semibold">Zone types</h2>
        <p className="text-sm text-muted-foreground">Pick a type, then tap every zone it applies to.</p>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Zone type brush">
        {DOC_ZONE_TYPES.map((t) => (
          <DocChip key={t.value} selected={d.brush === t.value} onClick={() => h.update((x) => ({ ...x, brush: t.value }))} testId={`chip-brush-${t.value}`}>
            <span className="flex items-center gap-2"><span className={cn("h-3 w-3 rounded-sm border", t.tile)} aria-hidden />{t.label}</span>
          </DocChip>
        ))}
      </div>
      {!ready ? <ZonesLoading onRetry={onReload} /> : (
        <>
          <p className="text-sm font-semibold tabular-nums" data-testid="text-typed-counter">
            {zones.length - untyped.length} of {zones.length} zones typed
          </p>
          <div className="grid grid-cols-5 gap-2">
            {zones.map((z) => {
              const info = z.zoneTypeConfirmed ? zoneTypeInfo(z.zoneType) : null;
              return (
                <button
                  key={z.id}
                  type="button"
                  aria-label={`Zone ${z.zoneNumber}, ${info ? info.label : "no type"}`}
                  onClick={() => applyType(h, [z.id], d.brush)}
                  className={cn(
                    "flex h-[60px] flex-col items-center justify-center rounded-xl border transition-transform active:scale-95",
                    info ? info.tile : "border-dashed border-slate-300 bg-white",
                  )}
                  data-testid={`tile-zone-${z.zoneNumber}`}
                >
                  <span className="text-[17px] font-bold leading-none tabular-nums">{z.zoneNumber}</span>
                  <span className={cn("mt-1 text-[11px] font-semibold", info ? "text-slate-800" : "text-slate-400")}>{info ? info.label : "Tap"}</span>
                </button>
              );
            })}
          </div>
          {untyped.length > 0 && (
            <Button type="button" variant="secondary" className="h-12 w-full text-[15px]" onClick={() => applyType(h, untyped.map((z) => z.id), d.brush)} data-testid="button-fill-untyped">
              Set the {untyped.length} untyped zones to {brush.label}
            </Button>
          )}
        </>
      )}
    </section>
  );
}

// ── Programs ─────────────────────────────────────────────────────────────────

export function ProgramsStep({
  programs, h, busy, onAdd, onRemove,
}: {
  programs: DocumentationProgram[]; h: Slice5Handle; busy: boolean;
  onAdd: () => void; onRemove: (p: DocumentationProgram) => void;
}) {
  const d = h.draft;
  const selected = programs.find((p) => p.id === d.selectedProgram) ?? programs[0] ?? null;
  const view = selected ? (d.programDrafts[selected.id] ?? programView(selected)) : null;
  const edit = (fn: Parameters<typeof editProgram>[2]) => { if (selected) editProgram(h, selected, fn); };
  return (
    <section className="flex flex-col gap-4" data-testid="step-programs">
      <div>
        <h2 className="text-base font-semibold">Programs</h2>
        <p className="text-sm text-muted-foreground">Enter what the clock is set to today: days, start times and seasonal adjust.</p>
      </div>
      <div className="flex flex-wrap gap-2" role="tablist">
        {programs.map((p) => (
          <DocChip key={p.id} selected={selected?.id === p.id} onClick={() => h.update((x) => ({ ...x, selectedProgram: p.id }))} testId={`tab-program-${p.name}`}>
            Program {p.name}
          </DocChip>
        ))}
        {programs.length < 6 && (
          <button type="button" disabled={busy} onClick={onAdd} className="min-h-11 rounded-xl border border-dashed border-primary/50 px-3.5 text-[15px] font-semibold text-primary disabled:opacity-50" data-testid="button-add-program">
            + Add program
          </button>
        )}
      </div>
      {!selected || !view ? (
        <p className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-3 text-sm text-blue-900" data-testid="text-no-programs">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />No programs yet. Add the first one that's set on the clock.
        </p>
      ) : (
        <div className="flex flex-col gap-5 rounded-2xl border border-slate-200 bg-white p-4" data-testid={`card-program-${selected.name}`}>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold">Watering days <span className="text-red-600">*</span></span>
            <div className="flex flex-wrap gap-1.5">
              {WEEK_DAYS.map((day) => {
                const on = view.wateringDays.includes(day);
                return (
                  <DocChip key={day} selected={on} testId={`chip-day-${day}`}
                    onClick={() => edit((v) => ({ ...v, wateringDays: on ? v.wateringDays.filter((x) => x !== day) : WEEK_DAYS.filter((w) => w === day || v.wateringDays.includes(w)) }))}>
                    {day}
                  </DocChip>
                );
              })}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold">Start times <span className="text-red-600">*</span></span>
            {view.startTimes.map((t, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="time"
                  aria-label={`Start time ${i + 1}`}
                  value={t}
                  onChange={(e) => { const val = e.target.value; edit((v) => ({ ...v, startTimes: v.startTimes.map((x, j) => (j === i ? val : x)) })); }}
                  className="h-[50px] min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 text-lg tabular-nums focus:outline-none focus:ring-2 focus:ring-primary"
                  data-testid={`input-start-time-${i}`}
                />
                <button type="button" aria-label={`Remove start time ${i + 1}`} className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100"
                  onClick={() => edit((v) => { const rest = v.startTimes.filter((_, j) => j !== i); return { ...v, startTimes: rest.length ? rest : [""] }; })}
                  data-testid={`button-remove-time-${i}`}>
                  <X className="h-5 w-5" />
                </button>
              </div>
            ))}
            <button type="button" className="min-h-11 self-start text-sm font-semibold text-primary" onClick={() => edit((v) => ({ ...v, startTimes: [...v.startTimes, ""] }))} data-testid="button-add-time">
              + Add start time
            </button>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold">Seasonal adjust</span>
            <div className="flex items-center justify-between gap-3">
              <Button type="button" variant="outline" className={stepperBtn} aria-label="Lower seasonal adjust" disabled={view.seasonalAdjustPct <= 0}
                onClick={() => edit((v) => ({ ...v, seasonalAdjustPct: Math.max(0, v.seasonalAdjustPct - 10) }))} data-testid="button-seasonal-minus">
                <Minus className="h-6 w-6" />
              </Button>
              <span className="text-3xl font-bold tabular-nums" data-testid="text-seasonal">{view.seasonalAdjustPct}%</span>
              <Button type="button" variant="outline" className={stepperBtn} aria-label="Raise seasonal adjust" disabled={view.seasonalAdjustPct >= 200}
                onClick={() => edit((v) => ({ ...v, seasonalAdjustPct: Math.min(200, v.seasonalAdjustPct + 10) }))} data-testid="button-seasonal-plus">
                <Plus className="h-6 w-6" />
              </Button>
            </div>
          </div>
          <button type="button" disabled={busy} className="min-h-11 self-start text-sm font-semibold text-red-700 disabled:opacity-50" onClick={() => onRemove(selected)} data-testid="button-remove-program">
            Remove Program {selected.name}
          </button>
        </div>
      )}
    </section>
  );
}

// ── Run times ────────────────────────────────────────────────────────────────

function MinutesInput({ value, min, max, onCommit, ariaLabel, testId, onEnterNext }:
  { value: number; min: number; max: number; onCommit: (n: number) => void; ariaLabel: string; testId: string; onEnterNext?: () => void }) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);

  return (
    <input
      type="text" inputMode="numeric" pattern="[0-9]*" enterKeyHint="next"
      aria-label={ariaLabel} data-testid={testId}
      className={cn("h-11 w-14 rounded-[10px] border border-slate-300 bg-white text-center text-lg font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-primary",
        Number(text) > max && "border-red-400")}
      value={text}
      onFocus={(e) => { focused.current = true; e.currentTarget.select(); }}
      onChange={(e) => {
        const next = e.target.value.replace(/\D/g, "").slice(0, 3);
        setText(next);
        if (next !== "") onCommit(clamp(parseInt(next, 10)));
      }}
      onBlur={() => {
        focused.current = false;
        setText(text === "" ? String(value) : String(clamp(parseInt(text, 10))));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
          onEnterNext?.();
        }
      }}
    />
  );
}

function focusMinutes(n: number) {
  document.querySelector<HTMLInputElement>(`[data-testid="input-minutes-${n}"]`)?.focus();
}

function ProgramChips({ programs, value, onPick, label }: { programs: DocumentationProgram[]; value: number | null; onPick: (id: number) => void; label: (p: DocumentationProgram) => string }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {programs.map((p) => (
        <button key={p.id} type="button" aria-pressed={value === p.id} aria-label={label(p)} onClick={() => onPick(p.id)}
          className={cn("h-11 min-w-11 rounded-[10px] border px-2 text-[15px] font-semibold",
            value === p.id ? "border-primary bg-primary text-white" : "border-slate-300 bg-white text-slate-700")}>
          {p.name}
        </button>
      ))}
    </div>
  );
}

export function RunTimesStep({ zones, programs, ready, h, onReload }: { zones: DocumentationZone[]; programs: DocumentationProgram[]; ready: boolean; h: Slice5Handle; onReload: () => void }) {
  const d = h.draft;
  const ids = new Set(programs.map((p) => p.id));
  const setAllProgram = d.setAllProgram != null && ids.has(d.setAllProgram) ? d.setAllProgram : programs[0]?.id ?? null;
  return (
    <section className="flex flex-col gap-4" data-testid="step-run-times">
      <div>
        <h2 className="text-base font-semibold">Run times</h2>
        <p className="text-sm text-muted-foreground">Every zone needs a program and minutes. Set them all at once, then adjust the ones that differ.</p>
      </div>
      {programs.length === 0 && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-900">Add a program first, on the Programs step.</p>
      )}
      {!ready ? <ZonesLoading onRetry={onReload} /> : (
        <>
          <div className="flex flex-col gap-3 rounded-2xl border border-primary/25 bg-primary/5 p-4" data-testid="card-set-all">
            <span className="text-sm font-semibold">Set all {zones.length} zones</span>
            <div className="flex items-center gap-3">
              <span className="w-16 text-sm text-muted-foreground">Program</span>
              <ProgramChips programs={programs} value={setAllProgram} label={(p) => `Set all on program ${p.name}`}
                onPick={(id) => h.update((x) => ({ ...x, setAllProgram: id }))} />
            </div>
            <div className="flex items-center gap-3">
              <span className="w-16 text-sm text-muted-foreground">Minutes</span>
              <Button type="button" variant="outline" className="h-11 w-11 rounded-[10px]" aria-label="Set all fewer minutes"
                onClick={() => h.update((x) => ({ ...x, setAllMinutes: Math.max(1, x.setAllMinutes - 1) }))}><Minus className="h-5 w-5" /></Button>
              <MinutesInput value={d.setAllMinutes} min={1} max={120} ariaLabel="Set all minutes" testId="input-set-all-minutes"
                onCommit={(n) => h.update((x) => ({ ...x, setAllMinutes: n }))} />
              <Button type="button" variant="outline" className="h-11 w-11 rounded-[10px]" aria-label="Set all more minutes"
                onClick={() => h.update((x) => ({ ...x, setAllMinutes: Math.min(120, x.setAllMinutes + 1) }))}><Plus className="h-5 w-5" /></Button>
            </div>
            <Button type="button" variant="secondary" className="h-12 w-full" disabled={setAllProgram == null || zones.length === 0}
              onClick={() => applyRun(h, zones.map((z) => z.id), { programId: setAllProgram!, runTimeMinutes: d.setAllMinutes })} data-testid="button-apply-all">
              Apply to all zones
            </Button>
          </div>
          <div>
            {zones.map((z) => {
              const done = z.programId != null && ids.has(z.programId);
              const type = z.zoneTypeConfirmed ? zoneTypeInfo(z.zoneType).label : "No type";
              return (
                <div key={z.id} className="flex flex-wrap items-center gap-2 border-b py-2.5" data-testid={`row-run-zone-${z.zoneNumber}`}>
                  <div className="w-16 shrink-0">
                    <div className={cn("text-[15px] font-bold", !done && "text-amber-700")}>Zone {z.zoneNumber}</div>
                    <div className="text-xs text-muted-foreground">{type}</div>
                  </div>
                  <ProgramChips programs={programs} value={z.programId} label={(p) => `Zone ${z.zoneNumber} on program ${p.name}`}
                    onPick={(id) => applyRun(h, [z.id], z.runTimeMinutes === 0 ? { programId: id, runTimeMinutes: d.setAllMinutes } : { programId: id })} />
                  <div className="flex-1" />
                  <div className="flex items-center gap-1">
                    <Button type="button" variant="outline" className="h-11 w-11 rounded-[10px]" aria-label={`Zone ${z.zoneNumber} fewer minutes`} disabled={z.runTimeMinutes <= 0}
                      onClick={() => applyRun(h, [z.id], { runTimeMinutes: Math.max(0, z.runTimeMinutes - 1) })}><Minus className="h-5 w-5" /></Button>
                    <MinutesInput value={z.runTimeMinutes} min={0} max={120}
                      ariaLabel={`Zone ${z.zoneNumber} minutes`} testId={`input-minutes-${z.zoneNumber}`}
                      onCommit={(n) => applyRun(h, [z.id], { runTimeMinutes: n })}
                      onEnterNext={() => focusMinutes(z.zoneNumber + 1)} />
                    <Button type="button" variant="outline" className="h-11 w-11 rounded-[10px]" aria-label={`Zone ${z.zoneNumber} more minutes`} disabled={z.runTimeMinutes >= 120}
                      onClick={() => applyRun(h, [z.id], { runTimeMinutes: Math.min(120, z.runTimeMinutes + 1) })}><Plus className="h-5 w-5" /></Button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
