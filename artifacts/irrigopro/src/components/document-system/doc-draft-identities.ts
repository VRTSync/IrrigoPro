import type { DocumentationControllerGraph, DocumentationProgram } from "@workspace/api-client-react";
import { docTemporaryId } from "@/lib/offline/doc-apply";

/** Keep unsaved in-flight edits attached to zone numbers while sync replaces
 * local identities. Reads and the stored authoritative graph retain server ids. */
export function docDraftRecords(base: DocumentationControllerGraph | null, savedId: number | null, added: DocumentationProgram[]) {
  const raw = base?.programs ?? [];
  const programs = raw.map(p => {
    const draft = added.find(a => a.clientId && a.clientId === p.clientId);
    return draft ? { ...p, id: draft.id } : p;
  });
  const aliases = new Map(raw.map((p, index) => [p.id, programs[index].id]));
  const zones = (base?.zones ?? []).map(z => ({
    ...z,
    id: savedId != null && savedId < 0 ? docTemporaryId(`${savedId}:zone:${z.zoneNumber}`) : z.id,
    programId: z.programId == null ? null : aliases.get(z.programId) ?? z.programId,
    extraPrograms: (z.extraPrograms ?? []).map(line => ({ ...line, programId: aliases.get(line.programId) ?? line.programId })),
  }));
  return { programs, zones };
}
