import { describe, expect, it } from "vitest";
import type { DocumentationSite } from "@workspace/api-client-react";
import { applyDocMutation, docTemporaryId } from "./doc-apply";
import type { QueuedMutation, QueuedMutationKind } from "./types";
import { docDraftRecords } from "@/components/document-system/doc-draft-identities";

export const emptySite = (): DocumentationSite => ({
  customer: { id: 1, name: "Field property", address: null, branches: [] }, branchName: "", controllers: [], backflows: [],
  site: { status: "nothing_on_file", verifiedAt: null, verifiedByName: null, noBackflowConfirmed: false },
});
function mutation(kind: QueuedMutationKind, body: unknown, extra: Partial<QueuedMutation> = {}): QueuedMutation {
  return { id: kind, clientId: kind, kind, body, method: "PUT", urlTemplate: "", placeholders: {},
    parentClientId: null, attemptCount: 0, lastAttemptAt: null, lastError: null, status: "pending", createdAt: 1000, resolvedId: null, ...extra };
}
describe("documentation optimistic shape", () => {
  it("retains draft zone/program identities when server identities replace an offline clock", () => {
    let local = applyDocMutation(emptySite(), mutation("doc.controller.create", { letter: "K", totalZones: 2 }, { clientId: "clock" }));
    const temporary = local.controllers[0].id;
    local = applyDocMutation(local, mutation("doc.program.create", { name: "A" }, { localSubjectId: temporary, clientId: "program" }));
    const added = local.controllers[0].programs;
    const server = structuredClone(local.controllers[0]);
    server.id = 70; server.programs[0].id = 80;
    server.zones.forEach((z, i) => { z.id = 101 + i; z.programId = 80; });
    const draft = docDraftRecords(server, temporary, added);
    expect(draft.programs).toHaveLength(1);
    expect(draft.programs[0].id).toBe(added[0].id);
    expect(draft.zones.map(z => z.id)).toEqual(local.controllers[0].zones.map(z => z.id));
    expect(draft.zones[0].programId).toBe(added[0].id);
    expect(server.programs[0].id).toBe(80);
  });
  it("creates and resizes a clock, assigns types and a zero-minute program, then verifies with shared gaps", () => {
    const original = emptySite();
    let site = applyDocMutation(original, mutation("doc.controller.create", { letter: "K", confirmLetter: true, settingsPhotoUrl: "saved-photo", location: "West", brand: "Hunter", model: "Pro-C" }, { clientId: "clock" }));
    const clock = docTemporaryId("clock");
    const apply = (kind: QueuedMutationKind, body: unknown, extra = {}) => {
      site = applyDocMutation(site, mutation(kind, body, { localSubjectId: clock, ...extra }));
    };
    apply("doc.controller.zone_count", { totalZones: 8 });
    apply("doc.controller.zones", { zoneNumbers: [1, 2, 3, 4, 5, 6, 7, 8], patch: { zoneType: "rotor" } });
    apply("doc.program.create", { name: "A", wateringDays: ["Mon"], startTimes: ["05:00"] }, { clientId: "program" });
    apply("doc.controller.zones", { zoneNumbers: [1, 2, 3, 4, 5, 6, 7, 8], patch: { programId: docTemporaryId("program"), runTimeMinutes: 0 } });
    expect(site.controllers[0].gaps).toEqual([]);
    apply("doc.controller.verify", {});
    expect(site.controllers[0].verified).toBe(true);
    apply("doc.controller.zone_count", { totalZones: 2 });
    expect(site.controllers[0].zones).toHaveLength(2);
    expect(site.controllers[0].verified).toBe(false);
    expect(original.controllers).toEqual([]);
  });
  it("keeps test dates, no-backflow confirmation and site verification consistent", () => {
    let site = applyDocMutation(emptySite(), mutation("doc.backflow.create", { name: "Valve", deviceType: "rpz", size: '1"', brand: "Watts", serialNumber: "AB", location: "West", photoUrl: "photo" }, { clientId: "bf" }));
    site = applyDocMutation(site, mutation("doc.backflow.log_test", { lastTestedDate: "2026-03-09", lastTestResult: "pass", lastTestedBy: "Tester" }, { localSubjectId: docTemporaryId("bf") }));
    expect(site.backflows[0].nextTestDueDate).toBe("2027-03-09");
    expect(site.backflows[0].gaps).toEqual([]);
    site = applyDocMutation(site, mutation("doc.backflow.verify", {}, { localSubjectId: docTemporaryId("bf") }));
    expect(site.backflows[0].verified).toBe(true);
  });
});
