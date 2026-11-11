import type { DocumentationSite, DocumentationControllerGraph, DocumentationBackflow } from "@workspace/api-client-react";
import { controllerDocumentationGaps, backflowDocumentationGaps, siteDocumentationStatus, controllerNameFor } from "@workspace/shared";
import type { QueuedMutation } from "./types";

export function docTemporaryId(clientId: string): number {
  let hash = 0;
  for (const c of clientId) hash = (Math.imul(31, hash) + c.charCodeAt(0)) | 0;
  return -(Math.abs(hash) + 1);
}
export type LocalSite = DocumentationSite;
type LocalController = DocumentationControllerGraph;
type LocalBackflow = DocumentationBackflow;
export const docRecordMatches = (row: { id: number; clientId?: string | null }, id: number) =>
  row.id === id || (!!row.clientId && docTemporaryId(row.clientId) === id);

/** Always starts from an authoritative snapshot, never an already-overlaid copy. */
export function applyDocMutation(payload: DocumentationSite, m: QueuedMutation): DocumentationSite {
  const site: DocumentationSite = structuredClone(payload);
  const b = (m.docLocalBody ?? m.body ?? {}) as Record<string, any>;
  const now = new Date(m.createdAt).toISOString();
  const subjectId = m.localSubjectId ?? Number(m.subjectClientId);
  let c = site.controllers.find(x => docRecordMatches(x, subjectId) || (!!m.subjectClientId && x.clientId === m.subjectClientId) || (m.kind === "doc.controller.create" && x.clientId === m.clientId));
  let bf = site.backflows.find(x => docRecordMatches(x, subjectId) || (!!m.subjectClientId && x.clientId === m.subjectClientId) || (m.kind === "doc.backflow.create" && x.clientId === m.clientId));
  const resize = (clock: DocumentationControllerGraph, count: number) => {
    clock.totalZones = count;
    clock.zones = Array.from({ length: count }, (_, i) => clock.zones.find(z => z.zoneNumber === i + 1) ?? {
      id: docTemporaryId(`${clock.id}:zone:${i + 1}`), zoneNumber: i + 1, name: `Zone ${i + 1}`,
      zoneType: "other", zoneTypeConfirmed: false, programId: null, runTimeMinutes: 0, extraPrograms: [],
    });
  };
  switch (m.kind) {
    case "doc.controller.create": {
      if (!c) {
        c = { id: docTemporaryId(m.clientId), clientId: m.clientId, name: controllerNameFor(b.letter), letter: b.letter,
          letterConfirmed: b.confirmLetter === true, location: null, brand: null, model: null, totalZones: null,
          settingsPhotoUrl: null, notes: null, fieldVerifiedAt: null, fieldVerifiedByName: null, lastUpdatedAt: now,
          gaps: [], verified: false, programs: [], zones: [], ...b } as LocalController;
        site.controllers.push(c);
        if (b.totalZones) resize(c, b.totalZones);
      }
      break;
    }
    case "doc.controller.update":
      if (c) {
        Object.assign(c, b);
        if (b.url !== undefined) c.settingsPhotoUrl = b.url;
        if (b.isActive === false) site.controllers = site.controllers.filter(x => x !== c);
      }
      break;
    case "doc.controller.letter":
      if (c) {
        const other = site.controllers.find(x => x.id !== c!.id && x.letter === b.letter);
        if (b.swap && other) { other.letter = c.letter; other.name = controllerNameFor(other.letter!); other.letterConfirmed = false; other.verified = false; }
        c.letter = b.letter; c.name = controllerNameFor(b.letter); c.letterConfirmed = b.confirm === true;
      }
      break;
    case "doc.controller.zone_count": if (c) resize(c, b.totalZones); break;
    case "doc.controller.photo": if (c) c.settingsPhotoUrl = `local:${m.clientId}`; break;
    case "doc.backflow.photo": if (bf) bf.photoUrl = `local:${m.clientId}`; break;
    case "doc.controller.zones":
      if (c) for (const z of c.zones) {
        if ((b.zoneNumbers ?? []).includes(z.zoneNumber)) {
          const patch = { ...b.patch };
          if (patch.programId < 0) patch.programId = c.programs.find(p => docRecordMatches(p, patch.programId))?.id ?? patch.programId;
          Object.assign(z, patch);
          if (b.patch.zoneType !== undefined) z.zoneTypeConfirmed = true;
          z.extraPrograms = (z.extraPrograms ?? []).filter(line => line.programId !== z.programId);
        }
      }
      break;
    case "doc.controller.extra_programs":
      if (c) for (const entry of b.zones ?? []) {
        const z = c.zones.find(x => x.zoneNumber === entry.zoneNumber);
        if (z) z.extraPrograms = entry.lines.map((line: { programId: number; runTimeMinutes: number }) => ({
          ...line, programId: c!.programs.find(p => docRecordMatches(p, line.programId))?.id ?? line.programId,
        }));
      }
      break;
    case "doc.program.create":
      if (c && !c.programs.some(p => p.id === docTemporaryId(m.clientId) || p.clientId === m.clientId)) c.programs.push({
        id: docTemporaryId(m.clientId), clientId: m.clientId, companyId: 0, controllerId: c.id, name: b.name, wateringDays: [], startTimes: [],
        seasonalAdjustPct: 100, isActive: true, sortOrder: 0, createdAt: now, updatedAt: now, ...b,
      });
      break;
    case "doc.program.update":
    case "doc.program.delete":
      for (const clock of site.controllers) {
        const program = clock.programs.find(p => docRecordMatches(p, subjectId));
        if (!program) continue;
        c = clock;
        if (m.kind === "doc.program.update") Object.assign(program, b);
        else {
          clock.programs = clock.programs.filter(p => p !== program);
          for (const z of clock.zones) {
            if (z.programId === program.id) z.programId = null;
            z.extraPrograms = (z.extraPrograms ?? []).filter(line => line.programId !== program.id);
          }
        }
      }
      break;
    case "doc.backflow.create":
      if (!bf) {
        bf = { id: docTemporaryId(m.clientId), clientId: m.clientId, name: b.name, branchName: site.branchName, photoUrl: null,
          deviceType: "other", size: null, brand: null, model: null, serialNumber: null, location: null, installDate: null,
          notes: null, lastTestResult: null, lastTestedDate: null, lastTestedBy: null, nextTestDueDate: null,
          testUnknownReason: null, lastUpdatedAt: now, fieldVerifiedAt: null, fieldVerifiedByName: null,
          isActive: true, lastUpdatedByUserId: null, lastUpdatedByName: null, fieldVerifiedByUserId: null,
          createdAt: now, updatedAt: now, verified: false, gaps: [], ...b } as LocalBackflow;
        site.backflows.push(bf);
      }
      break;
    case "doc.backflow.update":
    case "doc.backflow.log_test":
      if (bf) {
        Object.assign(bf, b);
        if (m.kind === "doc.backflow.log_test") {
          bf.testUnknownReason = null;
          const due = new Date(`${b.lastTestedDate}T00:00:00Z`);
          due.setUTCFullYear(due.getUTCFullYear() + 1);
          bf.nextTestDueDate = due.toISOString().slice(0, 10);
        }
        if (b.isActive === false) site.backflows = site.backflows.filter(x => x !== bf);
      }
      break;
    case "doc.site.no_backflow": site.site.noBackflowConfirmed = b.confirmed; break;
    case "doc.controller.verify": if (c) { c.verified = true; c.fieldVerifiedAt = now; } break;
    case "doc.backflow.verify": if (bf) { bf.verified = true; bf.fieldVerifiedAt = now; } break;
    case "doc.site.verify": site.site.verifiedAt = now; break;
    default: return payload;
  }
  if (c && m.kind !== "doc.controller.verify") { c.verified = false; c.lastUpdatedAt = now; }
  if (bf && m.kind !== "doc.backflow.verify") { bf.verified = false; bf.lastUpdatedAt = now; }
  for (const clock of site.controllers) {
    clock.gaps = controllerDocumentationGaps(clock);
    if (clock.gaps.length) clock.verified = false;
  }
  for (const backflow of site.backflows) {
    backflow.gaps = backflowDocumentationGaps(backflow);
    if (backflow.gaps.length) backflow.verified = false;
  }
  site.controllers.sort((a, b) => (a.letter ?? "").localeCompare(b.letter ?? ""));
  // Mirror the shared rule with stamps representing the current local verdict.
  site.site.status = siteDocumentationStatus({
    controllers: site.controllers.map(x => ({ ...x, isActive: true, fieldVerifiedAt: x.verified ? x.fieldVerifiedAt ?? now : null })),
    backflows: site.backflows.map(x => ({ ...x, isActive: true, fieldVerifiedAt: x.verified ? x.fieldVerifiedAt ?? now : null })),
    record: { verifiedAt: m.kind === "doc.site.verify" ? now : site.site.verifiedAt, noBackflowConfirmedAt: site.site.noBackflowConfirmed ? now : null },
  });
  if (site.site.status !== "verified") { site.site.verifiedAt = null; site.site.verifiedByName = null; }
  return site;
}
