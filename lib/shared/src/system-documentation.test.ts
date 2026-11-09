import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CONTROLLER_DOC_STEPS, BACKFLOW_DOC_STEPS, controllerDocumentationGaps, backflowDocumentationGaps,
  isFieldVerified, siteDocumentationStatus, type ControllerDocInput, type BackflowDocInput,
} from "./system-documentation";

const controller = (): ControllerDocInput => ({
  settingsPhotoUrl: "photo", name: "Clock", location: "Outside", brand: "Brand", model: "Model", totalZones: 1,
  programs: [{ id: 1, name: "A", isActive: true, wateringDays: ["Mon"], startTimes: ["06:00"] }],
  zones: [{ zoneNumber: 1, zoneTypeConfirmed: true, programId: 1, runTimeMinutes: 10 }],
});
const backflow = (): BackflowDocInput => ({
  photoUrl: "photo", deviceType: "pvb", size: "1", brand: "Brand", serialNumber: "123",
  name: "Device", location: "Outside", lastTestResult: "pass", lastTestedDate: "2026-11-01",
  lastTestedBy: "Tester", testUnknownReason: null,
});
const codes = (gaps: { code: string }[]) => gaps.map(g => g.code);

describe("documentation gaps", () => {
  it("exports exact ordered steps", () => {
    assert.deepEqual(CONTROLLER_DOC_STEPS, ["photo", "details", "zone_count", "zone_types", "programs", "run_times", "review"]);
    assert.deepEqual(BACKFLOW_DOC_STEPS, ["photo", "device", "location", "last_test", "review"]);
  });
  it("complete controller and each required field, including whitespace", () => {
    assert.deepEqual(controllerDocumentationGaps(controller()), []);
    for (const [field, code] of [["settingsPhotoUrl", "photo"], ["name", "name"], ["location", "location"], ["brand", "brand"], ["model", "model"]] as const) {
      for (const empty of [null, "", " \t "]) {
        const c = controller(); c[field] = empty;
        assert.deepEqual(codes(controllerDocumentationGaps(c)), [code]);
      }
    }
    for (const totalZones of [null, 0, -1, 12]) {
      const c = controller(); c.totalZones = totalZones; c.zones[0].zoneTypeConfirmed = false; c.zones[0].programId = null;
      assert.deepEqual(codes(controllerDocumentationGaps(c)), ["zone_count"]);
    }
    const c = controller(); c.totalZones = 12;
    c.zones = Array.from({ length: 11 }, (_, i) => ({ zoneNumber: i + 1, zoneTypeConfirmed: false, programId: null, runTimeMinutes: 0 }));
    assert.deepEqual(controllerDocumentationGaps(c), [{ step: "zone_count", code: "zone_count", label: "zone count" }]);
  });
  it("pluralizes type and runtime counts and uses active program membership", () => {
    for (const n of [1, 2]) {
      const c = controller(); c.totalZones = n;
      c.zones = Array.from({ length: n }, (_, i) => ({ zoneNumber: i + 1, zoneTypeConfirmed: false, programId: 99, runTimeMinutes: 10 }));
      assert.deepEqual(controllerDocumentationGaps(c), [
        { step: "zone_types", code: "zone_types", label: `${n} zone${n === 1 ? "" : "s"} without a type` },
        { step: "run_times", code: "run_times", label: `${n} zone${n === 1 ? "" : "s"} without a program` },
      ]);
    }
    for (const patch of [{ programId: null }, { programId: 99 }]) {
      const c = controller(); Object.assign(c.zones[0], patch);
      assert.deepEqual(codes(controllerDocumentationGaps(c)), ["run_times"]);
    }
    const c = controller(); c.programs[0].wateringDays = []; c.programs[0].startTimes = [""];
    c.programs.push({ id: 2, name: "B", isActive: false, wateringDays: null, startTimes: null });
    assert.deepEqual(controllerDocumentationGaps(c), [
      { step: "programs", code: "program_days:1", label: "Program A days" },
      { step: "programs", code: "program_times:1", label: "Program A start time" },
    ]);
    c.zones[0].programId = 2;
    assert.deepEqual(codes(controllerDocumentationGaps(c)), ["program_days:1", "program_times:1", "run_times"]);
    c.programs[0].isActive = false;
    assert.deepEqual(codes(controllerDocumentationGaps(c)), ["programs", "run_times"]);
    c.programs = [];
    assert.deepEqual(codes(controllerDocumentationGaps(c)), ["programs", "run_times"]);
  });
  it("accepts zero through 120 minutes only with active controller-program membership", () => {
    for (const runTimeMinutes of [0, 1, 120]) {
      const c = controller(); c.zones[0].runTimeMinutes = runTimeMinutes;
      assert.deepEqual(controllerDocumentationGaps(c), []);
    }
    const c = controller();
    c.programs.push({ id: 2, name: "B", isActive: false, wateringDays: ["Mon"], startTimes: ["06:00"] });
    c.zones[0].programId = 2;
    assert.deepEqual(controllerDocumentationGaps(c), [
      { step: "run_times", code: "run_times", label: "1 zone without a program" },
    ]);
  });
  it("backflow exact field labels, required fields, and four test answers", () => {
    assert.deepEqual(backflowDocumentationGaps(backflow()), []);
    for (const [field, step, code, label] of [
      ["photoUrl", "photo", "photo", "device photo"], ["deviceType", "device", "device_type", "type"],
      ["size", "device", "size", "size"], ["brand", "device", "brand", "brand"],
      ["serialNumber", "device", "serial", "serial number"], ["name", "location", "name", "name"],
      ["location", "location", "location", "location"],
    ] as const) {
      for (const value of [null, " \t "]) {
        const b = backflow(); b[field] = value;
        assert.deepEqual(backflowDocumentationGaps(b), [{ step, code, label }]);
      }
    }
    for (const result of ["pass", "fail"]) {
      for (const field of ["lastTestedDate", "lastTestedBy"] as const) {
        const b = backflow(); b.lastTestResult = result; b[field] = " ";
        assert.deepEqual(backflowDocumentationGaps(b), [{ step: "last_test", code: "test_details", label: "test date and tester" }]);
      }
    }
    for (const reason of ["never_tested", "no_tag"]) {
      const b = backflow(); b.lastTestResult = null; b.testUnknownReason = reason; b.lastTestedDate = null; b.lastTestedBy = null;
      assert.deepEqual(backflowDocumentationGaps(b), []);
    }
    const b = backflow(); b.lastTestResult = "unknown"; b.testUnknownReason = " ";
    assert.deepEqual(backflowDocumentationGaps(b), [{ step: "last_test", code: "test", label: "test result" }]);
  });
});

describe("field verification and active-only site status", () => {
  const now = "2026-11-08T00:00:00.000Z";
  const item = () => ({ isActive: true, fieldVerifiedAt: now as string | Date | null, lastUpdatedAt: now as string | Date | null });
  it("accepts equality, compares dates and strings by milliseconds, rejects null/stale/invalid", () => {
    assert.equal(isFieldVerified(item()), true);
    assert.equal(isFieldVerified({ fieldVerifiedAt: new Date(now), lastUpdatedAt: now }), true);
    assert.equal(isFieldVerified({ fieldVerifiedAt: now, lastUpdatedAt: new Date(new Date(now).getTime() + 1) }), false);
    assert.equal(isFieldVerified({ fieldVerifiedAt: null, lastUpdatedAt: now }), false);
    assert.equal(isFieldVerified({ fieldVerifiedAt: now, lastUpdatedAt: null }), false);
    assert.equal(isFieldVerified({ fieldVerifiedAt: "bad", lastUpdatedAt: now }), false);
  });
  it("covers no rows, inactive-only, backflow-only, site stamp, no-backflow confirmation, stale and post-Finish verification", () => {
    const status = siteDocumentationStatus;
    const record = { verifiedAt: now, noBackflowConfirmedAt: null as string | null };
    assert.equal(status({ controllers: [], backflows: [], record }), "nothing_on_file");
    assert.equal(status({ controllers: [{ ...item(), isActive: false }], backflows: [{ ...item(), isActive: false }], record }), "nothing_on_file");
    assert.equal(status({ controllers: [], backflows: [item()], record }), "not_verified");
    assert.equal(status({ controllers: [item()], backflows: [item()], record: null }), "not_verified");
    assert.equal(status({ controllers: [item()], backflows: [item()], record: { ...record, verifiedAt: null } }), "not_verified");
    assert.equal(status({ controllers: [item()], backflows: [], record }), "not_verified");
    assert.equal(status({ controllers: [item()], backflows: [], record: { ...record, noBackflowConfirmedAt: now } }), "verified");
    assert.equal(status({ controllers: [item()], backflows: [item()], record }), "verified");
    for (const group of ["controllers", "backflows"] as const) {
      for (const patch of [
        { fieldVerifiedAt: null }, { lastUpdatedAt: null },
        { lastUpdatedAt: new Date(new Date(now).getTime() + 1) },
        { fieldVerifiedAt: new Date(new Date(now).getTime() + 1) },
      ]) {
        const input = { controllers: [item()], backflows: [item()], record };
        Object.assign(input[group][0], patch);
        assert.equal(status(input), "not_verified");
        input[group].push({ ...item(), isActive: false, fieldVerifiedAt: null });
      }
    }
    assert.equal(status({ controllers: [item(), { ...item(), isActive: false, fieldVerifiedAt: null }], backflows: [item()], record }), "verified");
    assert.equal(status({ controllers: [item()], backflows: [{ ...item(), isActive: false, fieldVerifiedAt: null }], record }), "not_verified");
  });
});
