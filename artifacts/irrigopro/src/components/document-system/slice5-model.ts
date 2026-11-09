import { useCallback, useRef, useState } from "react";
import type { DocumentationProgram, DocumentationZone } from "@workspace/api-client-react";
import { apiRequest } from "@/lib/queryClient";
import { DOC_ZONE_TYPES, WEEK_DAYS } from "./constants";

/**
 * Slice 5 draft: everything the tech changed on Zone types, Programs and Run
 * times that is not yet confirmed by a site refetch. It overlays the site graph,
 * so a refetch never clobbers unsaved work, and it lives in a ref so sequential
 * saves can drain the dirty sets one group at a time.
 */
export type ZoneEdit = { zoneType?: string; programId?: number | null; runTimeMinutes?: number };
export type ProgramDraft = { wateringDays: string[]; startTimes: string[]; seasonalAdjustPct: number };

export type Slice5Draft = {
  zoneEdits: Record<number, ZoneEdit>;
  typed: number[];
  typeDirty: number[];
  runDirty: number[];
  programDrafts: Record<number, ProgramDraft>;
  programBaseline: Record<number, ProgramDraft>;
  programDirty: number[];
  addedPrograms: DocumentationProgram[];
  deletedPrograms: number[];
  brush: string;
  selectedProgram: number | null;
  setAllProgram: number | null;
  setAllMinutes: number;
};

const EMPTY: Slice5Draft = {
  zoneEdits: {}, typed: [], typeDirty: [], runDirty: [],
  programDrafts: {}, programBaseline: {}, programDirty: [],
  addedPrograms: [], deletedPrograms: [],
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
    .map((p) => (d.programDrafts[p.id] ? { ...p, ...d.programDrafts[p.id] } : p));
}

export function activeSorted(programs: DocumentationProgram[]): DocumentationProgram[] {
  return programs.filter((p) => p.isActive).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
}

export function mergeZones(base: DocumentationZone[], d: Slice5Draft): DocumentationZone[] {
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
export function nextProgramName(all: { name: string }[]): string | null {
  const used = new Set(all.map((p) => p.name.trim().toUpperCase()));
  return ["A", "B", "C", "D", "E", "F"].find((l) => !used.has(l)) ?? null;
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
    const on = zones.filter((z) => z.programId === p.id);
    const mins = on.reduce((s, z) => s + z.runTimeMinutes, 0);
    const days = n.wateringDays.join(" ") || "no days";
    const times = n.startTimes.map(formatTime12).join(" and ") || "no start time";
    return `Program ${p.name}: ${days} at ${times}, ${n.seasonalAdjustPct}%, ${on.length} zone${on.length === 1 ? "" : "s"}, ${mins} min`;
  });
  return lines.join("\n") || "Not set";
}

// ── Saving (sequential, stop at first failure, unsent groups stay dirty) ─────

export async function saveZoneTypes(controllerId: number, h: Slice5Handle, baseZones: DocumentationZone[], onSent: () => void) {
  const zones = mergeZones(baseZones, h.ref.current);
  for (const g of typeGroups(zones, h.ref.current.typeDirty)) {
    await apiRequest(`/api/irrigation-controllers/${controllerId}/zones/bulk`, "PUT", { zoneIds: g.ids, patch: { zoneType: g.type } });
    h.update((d) => ({ ...d, typeDirty: without(d.typeDirty, g.ids) }));
    onSent();
  }
}

export async function saveRunTimes(controllerId: number, h: Slice5Handle, baseZones: DocumentationZone[], onSent: () => void) {
  const zones = mergeZones(baseZones, h.ref.current);
  // Rows without a program are still sent (programId: null) so partial minutes persist.
  for (const g of runGroups(zones, h.ref.current.runDirty)) {
    await apiRequest(`/api/irrigation-controllers/${controllerId}/zones/bulk`, "PUT", {
      zoneIds: g.ids, patch: { programId: g.programId, runTimeMinutes: g.minutes },
    });
    h.update((d) => ({ ...d, runDirty: without(d.runDirty, g.ids) }));
    onSent();
  }
}

export async function saveProgramsStep(h: Slice5Handle, onSent: () => void) {
  for (const id of [...h.ref.current.programDirty]) {
    const d = h.ref.current;
    if (d.deletedPrograms.includes(id) || !d.programDrafts[id]) {
      h.update((x) => ({ ...x, programDirty: without(x.programDirty, [id]) }));
      continue;
    }
    const patch = programPatch(d.programDrafts[id], d.programBaseline[id]);
    if (patch) {
      await apiRequest(`/api/irrigation-programs/${id}`, "PUT", patch);
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

export function applyRun(h: Slice5Handle, ids: number[], edit: { programId?: number; runTimeMinutes?: number }) {
  h.update((d) => {
    const zoneEdits = { ...d.zoneEdits };
    for (const id of ids) zoneEdits[id] = { ...zoneEdits[id], ...edit };
    return { ...d, zoneEdits, runDirty: add(d.runDirty, ids) };
  });
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
