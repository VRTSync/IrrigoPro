import { useCallback, useRef, useState } from "react";
import type { DocumentationProgram, DocumentationZone } from "@workspace/api-client-react";
import { zoneProgramLines, type ZoneExtraProgram } from "@workspace/shared";
import { apiRequest } from "@/lib/queryClient";
import { DOC_ZONE_TYPES, WEEK_DAYS } from "./constants";

/**
 * Slice 5 draft: everything the tech changed on Zone types, Programs and Run
 * times that is not yet confirmed by a site refetch. It overlays the site graph,
 * so a refetch never clobbers unsaved work, and it lives in a ref so sequential
 * saves can drain the dirty sets one group at a time.
 */
export type ZoneEdit = { zoneType?: string; programId?: number | null; runTimeMinutes?: number; extraPrograms?: ZoneExtraProgram[] };
export type ProgramDraft = { wateringDays: string[]; startTimes: string[]; seasonalAdjustPct: number };

export type Slice5Draft = {
  zoneEdits: Record<number, ZoneEdit>;
  typed: number[];
  typeDirty: number[];
  runDirty: number[];
  extraDirty: number[];
  programDrafts: Record<number, ProgramDraft>;
  programBaseline: Record<number, ProgramDraft>;
  programDirty: number[];
  addedPrograms: DocumentationProgram[];
  renamedPrograms: Record<number, { name: string; sortOrder: number }>;
  deletedPrograms: number[];
  brush: string;
  selectedProgram: number | null;
  setAllProgram: number | null;
  setAllMinutes: number;
};

const EMPTY: Slice5Draft = {
  zoneEdits: {}, typed: [], typeDirty: [], runDirty: [], extraDirty: [],
  programDrafts: {}, programBaseline: {}, programDirty: [],
  addedPrograms: [], renamedPrograms: {}, deletedPrograms: [],
  brush: "pop_up_spray", selectedProgram: null, setAllProgram: null, setAllMinutes: 10,
};

const add = (list: number[], ids: number[]) => Array.from(new Set([...list, ...ids]));
const without = (list: number[], ids: number[]) => list.filter((x) => !ids.includes(x));

export function useSlice5Draft() {
  const ref = useRef<Slice5Draft>(EMPTY);
  const [, bump] = useState(0);
  const update = useCallback((fn: (d: Slice5Draft) => Slice5Draft) => {
    ref.current = fn(ref.current);
    bump((n) => n + 1);
  }, []);
  return { draft: ref.current, ref, update };
}
export type Slice5Handle = ReturnType<typeof useSlice5Draft>;

// ── Merging the draft over the graph ─────────────────────────────────────────

export function mergePrograms(base: DocumentationProgram[], d: Slice5Draft): DocumentationProgram[] {
  const ids = new Set(base.map((p) => p.id));
  return [...base, ...d.addedPrograms.filter((p) => !ids.has(p.id))]
    .filter((p) => !d.deletedPrograms.includes(p.id))
    .map((p) => ({ ...p, ...d.renamedPrograms[p.id], ...d.programDrafts[p.id] }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
}

export function activeSorted(programs: DocumentationProgram[]): DocumentationProgram[] {
  return programs.filter((p) => p.isActive).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
}

export function mergeZones(base: DocumentationZone[], d: Slice5Draft, programs?: DocumentationProgram[]): DocumentationZone[] {
  return base
    .map((z) => {
      const e = d.zoneEdits[z.id] ?? {};
      let programId = e.programId !== undefined ? e.programId : z.programId;
      if (programId != null && d.deletedPrograms.includes(programId)) programId = null;
      return {
        ...z,
        zoneType: e.zoneType ?? z.zoneType,
        zoneTypeConfirmed: z.zoneTypeConfirmed || d.typed.includes(z.id),
        programId,
        runTimeMinutes: e.runTimeMinutes ?? z.runTimeMinutes,
        extraPrograms: (e.extraPrograms ?? z.extraPrograms ?? []).filter((line) =>
          line.programId !== programId && !d.deletedPrograms.includes(line.programId) &&
          (programs === undefined || programs.some((p) => p.id === line.programId))),
      };
    })
    .sort((a, b) => a.zoneNumber - b.zoneNumber);
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

export function zoneTypeInfo(value: string) {
  return DOC_ZONE_TYPES.find((t) => t.value === value) ?? { value, label: "Other", tile: "bg-slate-200 border-slate-400" };
}

export function normalizeProgram(p: { wateringDays: string[] | null; startTimes: string[] | null; seasonalAdjustPct: number }): ProgramDraft {
  return {
    wateringDays: WEEK_DAYS.filter((d) => (p.wateringDays ?? []).includes(d)),
    startTimes: (p.startTimes ?? []).map((t) => t.trim()).filter(Boolean).sort(),
    seasonalAdjustPct: p.seasonalAdjustPct,
  };
}

export function programPatch(draft: ProgramDraft, baseline: ProgramDraft): Partial<ProgramDraft> | null {
  const n = normalizeProgram(draft);
  const b = normalizeProgram(baseline);
  const out: Partial<ProgramDraft> = {};
  if (n.wateringDays.join() !== b.wateringDays.join()) out.wateringDays = n.wateringDays;
  if (n.startTimes.join() !== b.startTimes.join()) out.startTimes = n.startTimes;
  if (n.seasonalAdjustPct !== b.seasonalAdjustPct) out.seasonalAdjustPct = n.seasonalAdjustPct;
  return Object.keys(out).length ? out : null;
}

/** First letter A-F not used by a program currently on the controller (active or inactive). Deletes are hard, so a deleted letter is free again. */
export const PROGRAM_LETTERS = ["A", "B", "C", "D", "E", "F"] as const;
export function freeProgramLetters(all: { id?: number; name: string }[], except?: number): string[] {
  const used = new Set(all.filter((p) => except === undefined || p.id !== except).map((p) => p.name.trim().toUpperCase()));
  return PROGRAM_LETTERS.filter((l) => !used.has(l));
}
export function programSortOrder(letter: string): number {
  const index = PROGRAM_LETTERS.findIndex((l) => l === letter.trim().toUpperCase());
  return index < 0 ? 99 : index;
}

export function typeGroups(zones: DocumentationZone[], dirty: number[]) {
  const groups: { type: string; ids: number[] }[] = [];
  for (const t of [...DOC_ZONE_TYPES.map((x) => x.value as string), ...new Set(zones.map((z) => z.zoneType))]) {
    if (groups.some((g) => g.type === t)) continue;
    const ids = zones.filter((z) => dirty.includes(z.id) && z.zoneType === t).map((z) => z.id);
    if (ids.length) groups.push({ type: t, ids });
  }
  return groups;
}

export function runGroups(zones: DocumentationZone[], dirty: number[]) {
  const groups: { programId: number | null; minutes: number; ids: number[] }[] = [];
  for (const z of zones) {
    if (!dirty.includes(z.id)) continue;
    const g = groups.find((x) => x.programId === z.programId && x.minutes === z.runTimeMinutes);
    if (g) g.ids.push(z.id);
    else groups.push({ programId: z.programId, minutes: z.runTimeMinutes, ids: [z.id] });
  }
  return groups;
}

export function formatTime12(t: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return t;
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

export function typesSummary(zones: DocumentationZone[]): string {
  const confirmed = zones.filter((z) => z.zoneTypeConfirmed);
  const parts: string[] = DOC_ZONE_TYPES
    .map((t) => [t.label, confirmed.filter((z) => z.zoneType === t.value).length] as const)
    .filter(([, n]) => n > 0)
    .map(([l, n]) => `${l} ${n}`);
  const unknown = confirmed.filter((z) => !DOC_ZONE_TYPES.some((t) => t.value === z.zoneType)).length;
  if (unknown) parts.push(`Other ${unknown}`);
  const untyped = zones.length - confirmed.length;
  if (untyped) parts.push(`${untyped} untyped`);
  return parts.join(", ") || "Not set";
}

export function programsSummary(programs: DocumentationProgram[], zones: DocumentationZone[]): string {
  const lines = programs.map((p) => {
    const n = normalizeProgram(p);
    const on = zones.flatMap(zoneProgramLines).filter((line) => line.programId === p.id);
    const off = on.filter((z) => z.runTimeMinutes === 0).length;
    const mins = on.reduce((s, z) => s + z.runTimeMinutes, 0);
    const days = n.wateringDays.join(" ") || "no days";
    const times = n.startTimes.map(formatTime12).join(" and ") || "no start time";
    return `Program ${p.name}: ${days} at ${times}, ${n.seasonalAdjustPct}%, ${on.length} zone${on.length === 1 ? "" : "s"}${off ? ` (${off} at 0 min)` : ""}, ${mins} min`;
  });
  return lines.join("\n") || "Not set";
}

// ── Saving (sequential, stop at first failure, unsent groups stay dirty) ─────

export async function saveZoneTypes(controllerId: number, h: Slice5Handle, baseZones: DocumentationZone[], onSent: () => void, request = apiRequest) {
  const zones = mergeZones(baseZones, h.ref.current);
  for (const g of typeGroups(zones, h.ref.current.typeDirty)) {
    await request(`/api/irrigation-controllers/${controllerId}/zones/bulk`, "PUT", { zoneNumbers: zones.filter(z => g.ids.includes(z.id)).map(z => z.zoneNumber), patch: { zoneType: g.type } });
    h.update((d) => ({ ...d, typeDirty: without(d.typeDirty, g.ids) }));
    onSent();
  }
}

export async function saveRunTimes(controllerId: number, h: Slice5Handle, baseZones: DocumentationZone[], onSent: () => void, programs?: DocumentationProgram[], request = apiRequest) {
  const zones = mergeZones(baseZones, h.ref.current, programs);
  // Rows without a program are still sent (programId: null) so partial minutes persist.
  for (const g of runGroups(zones, h.ref.current.runDirty)) {
    await request(`/api/irrigation-controllers/${controllerId}/zones/bulk`, "PUT", {
      zoneNumbers: zones.filter(z => g.ids.includes(z.id)).map(z => z.zoneNumber), patch: { programId: g.programId, runTimeMinutes: g.minutes },
    });
    h.update((d) => ({ ...d, runDirty: without(d.runDirty, g.ids) }));
    onSent();
  }
  const dirty = [...h.ref.current.extraDirty];
  if (dirty.length) {
    await request(`/api/irrigation-controllers/${controllerId}/zones/extra-programs`, "PUT", {
      zones: dirty.map((id) => ({ zoneNumber: zones.find((z) => z.id === id)!.zoneNumber, lines: zones.find((z) => z.id === id)?.extraPrograms ?? [] })),
    });
    h.update((d) => ({ ...d, extraDirty: without(d.extraDirty, dirty) }));
    onSent();
  }
}

export async function saveProgramsStep(h: Slice5Handle, onSent: () => void, request = apiRequest) {
  for (const id of [...h.ref.current.programDirty]) {
    const d = h.ref.current;
    if (d.deletedPrograms.includes(id) || !d.programDrafts[id]) {
      h.update((x) => ({ ...x, programDirty: without(x.programDirty, [id]) }));
      continue;
    }
    const patch = programPatch(d.programDrafts[id], d.programBaseline[id]);
    if (patch) {
      await request(`/api/irrigation-programs/${id}`, "PUT", patch);
      onSent();
    }
    const sent = normalizeProgram(d.programDrafts[id]);
    h.update((x) => ({ ...x, programDirty: without(x.programDirty, [id]), programBaseline: { ...x.programBaseline, [id]: sent } }));
  }
}

// ── Local mutations ──────────────────────────────────────────────────────────

export function applyType(h: Slice5Handle, ids: number[], type: string) {
  h.update((d) => {
    const zoneEdits = { ...d.zoneEdits };
    for (const id of ids) zoneEdits[id] = { ...zoneEdits[id], zoneType: type };
    return { ...d, zoneEdits, typed: add(d.typed, ids), typeDirty: add(d.typeDirty, ids) };
  });
}

export function applyRun(h: Slice5Handle, zones: DocumentationZone[], edit: { programId?: number; runTimeMinutes?: number }) {
  h.update((d) => {
    const zoneEdits = { ...d.zoneEdits };
    const removed: number[] = [];
    // Callers pass the latest merged graph, including programs removed by a
    // refetch. Re-overlaying zoneEdits here would resurrect those removed lines.
    for (const zone of zones) {
      zoneEdits[zone.id] = { ...zoneEdits[zone.id], ...edit };
      if (typeof edit.programId === "number" && zone.extraPrograms.some((line) => line.programId === edit.programId)) {
        zoneEdits[zone.id].extraPrograms = zone.extraPrograms.filter((line) => line.programId !== edit.programId);
        removed.push(zone.id);
      }
    }
    return { ...d, zoneEdits, runDirty: add(d.runDirty, zones.map((z) => z.id)), extraDirty: add(d.extraDirty, removed) };
  });
}

function editExtras(h: Slice5Handle, zone: DocumentationZone, edit: (lines: ZoneExtraProgram[]) => ZoneExtraProgram[]) {
  h.update((d) => {
    return {
      ...d,
      zoneEdits: { ...d.zoneEdits, [zone.id]: { ...d.zoneEdits[zone.id], extraPrograms: edit(zone.extraPrograms ?? []) } },
      extraDirty: add(d.extraDirty, [zone.id]),
    };
  });
}

export function addExtra(h: Slice5Handle, zone: DocumentationZone, programId: number, minutes: number) {
  editExtras(h, zone, (lines) => [...lines, { programId, runTimeMinutes: minutes }]);
}

export function setExtra(h: Slice5Handle, zone: DocumentationZone, index: number, patch: Partial<ZoneExtraProgram>) {
  editExtras(h, zone, (lines) => lines.map((line, i) => i === index ? { ...line, ...patch } : line));
}

export function removeExtra(h: Slice5Handle, zone: DocumentationZone, index: number) {
  editExtras(h, zone, (lines) => lines.filter((_, i) => i !== index));
}

export function editProgram(h: Slice5Handle, p: DocumentationProgram, fn: (draft: ProgramDraft) => ProgramDraft) {
  h.update((d) => {
    const current = d.programDrafts[p.id] ?? programView(p);
    return {
      ...d,
      programDrafts: { ...d.programDrafts, [p.id]: fn(current) },
      programBaseline: d.programBaseline[p.id] ? d.programBaseline : { ...d.programBaseline, [p.id]: normalizeProgram(p) },
      programDirty: add(d.programDirty, [p.id]),
    };
  });
}

/** What the card shows for a program: one empty time row when it has none. */
export function programView(p: { wateringDays: string[] | null; startTimes: string[] | null; seasonalAdjustPct: number }): ProgramDraft {
  return {
    wateringDays: [...(p.wateringDays ?? [])],
    startTimes: p.startTimes?.length ? [...p.startTimes] : [""],
    seasonalAdjustPct: p.seasonalAdjustPct,
  };
}

export function programAdded(h: Slice5Handle, p: DocumentationProgram) {
  h.update((d) => ({ ...d, addedPrograms: [...d.addedPrograms, p], selectedProgram: p.id }));
}

export function programRenamed(h: Slice5Handle, id: number, name: string, sortOrder: number) {
  h.update((d) => ({
    ...d,
    addedPrograms: d.addedPrograms.map((p) => p.id === id ? { ...p, name, sortOrder } : p),
    renamedPrograms: { ...d.renamedPrograms, [id]: { name, sortOrder } },
  }));
}

export function programDeleted(h: Slice5Handle, id: number, baseZones: DocumentationZone[]) {
  h.update((d) => {
    const zones = mergeZones(baseZones, d);
    const lost = zones.filter((z) => z.programId === id).map((z) => z.id);
    const zoneEdits = { ...d.zoneEdits };
    for (const zid of lost) zoneEdits[zid] = { ...zoneEdits[zid], programId: null };
    return {
      ...d, zoneEdits,
      deletedPrograms: add(d.deletedPrograms, [id]),
      programDirty: without(d.programDirty, [id]),
      selectedProgram: d.selectedProgram === id ? null : d.selectedProgram,
      setAllProgram: d.setAllProgram === id ? null : d.setAllProgram,
    };
  });
}
