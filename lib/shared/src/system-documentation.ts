export const CONTROLLER_DOC_STEPS = ["photo", "details", "zone_count", "zone_types", "programs", "run_times", "review"] as const;
export const BACKFLOW_DOC_STEPS = ["photo", "device", "location", "last_test", "review"] as const;
export type DocGap = { step: string; code: string; label: string };
export type ControllerDocInput = {
  settingsPhotoUrl: string | null; name: string | null; location: string | null; brand: string | null; model: string | null;
  totalZones: number | null;
  programs: { id: number; name: string; isActive: boolean; wateringDays: string[] | null; startTimes: string[] | null }[];
  zones: { zoneNumber: number; zoneTypeConfirmed: boolean; programId: number | null; runTimeMinutes: number }[];
};
export type BackflowDocInput = {
  photoUrl: string | null; deviceType: string | null; size: string | null; brand: string | null; serialNumber: string | null;
  name: string | null; location: string | null;
  lastTestResult: string | null; lastTestedDate: string | null; lastTestedBy: string | null; testUnknownReason: string | null;
};
const hasText = (text: string | null): boolean => !!text?.trim();
const zoneLabel = (n: number) => `${n} zone${n === 1 ? "" : "s"}`;

export function controllerDocumentationGaps(c: ControllerDocInput): DocGap[] {
  const gaps: DocGap[] = [];
  const add = (step: string, code: string, label: string) => gaps.push({ step, code, label });
  if (!hasText(c.settingsPhotoUrl)) add("photo", "photo", "clock photo");
  for (const key of ["name", "location", "brand", "model"] as const) {
    if (!hasText(c[key])) add("details", key, key);
  }
  const countGap = c.totalZones === null || c.totalZones < 1 || c.zones.length !== c.totalZones;
  if (countGap) add("zone_count", "zone_count", "zone count");
  const untyped = c.zones.filter(z => !z.zoneTypeConfirmed).length;
  if (!countGap && untyped) add("zone_types", "zone_types", `${zoneLabel(untyped)} without a type`);
  const active = c.programs.filter(p => p.isActive);
  if (!active.length) add("programs", "programs", "at least one program");
  for (const p of active) {
    if (!p.wateringDays?.some(hasText)) add("programs", `program_days:${p.id}`, `Program ${p.name.trim()} days`);
    if (!p.startTimes?.some(hasText)) add("programs", `program_times:${p.id}`, `Program ${p.name.trim()} start time`);
  }
  const ids = new Set(active.map(p => p.id));
  const incomplete = c.zones.filter(z => z.programId === null || !ids.has(z.programId)).length;
  if (!countGap && incomplete) add("run_times", "run_times", `${zoneLabel(incomplete)} without a program`);
  return gaps;
}

export function backflowDocumentationGaps(b: BackflowDocInput): DocGap[] {
  const gaps: DocGap[] = [];
  const add = (step: string, code: string, label: string) => gaps.push({ step, code, label });
  if (!hasText(b.photoUrl)) add("photo", "photo", "device photo");
  for (const [key, code, label] of [
    ["deviceType", "device_type", "type"], ["size", "size", "size"], ["brand", "brand", "brand"], ["serialNumber", "serial", "serial number"],
  ] as const) if (!hasText(b[key])) add("device", code, label);
  for (const key of ["name", "location"] as const) if (!hasText(b[key])) add("location", key, key);
  const tested = b.lastTestResult?.trim() === "pass" || b.lastTestResult?.trim() === "fail";
  if (!tested && !hasText(b.testUnknownReason)) add("last_test", "test", "test result");
  if (tested && (!hasText(b.lastTestedDate) || !hasText(b.lastTestedBy))) add("last_test", "test_details", "test date and tester");
  return gaps;
}

type Stamp = Date | string | null;
type Equipment = { isActive: boolean; fieldVerifiedAt: Stamp; lastUpdatedAt: Stamp };
const time = (stamp: Date | string) => new Date(stamp).getTime();
export function isFieldVerified(x: { fieldVerifiedAt: Stamp; lastUpdatedAt: Stamp }): boolean {
  return x.fieldVerifiedAt !== null && x.lastUpdatedAt !== null && time(x.fieldVerifiedAt) >= time(x.lastUpdatedAt);
}
export type SiteDocStatus = "verified" | "not_verified" | "nothing_on_file";
export function siteDocumentationStatus(input: {
  controllers: Equipment[]; backflows: Equipment[];
  record: { verifiedAt: Stamp; noBackflowConfirmedAt: Stamp } | null;
}): SiteDocStatus {
  const controllers = input.controllers.filter(c => c.isActive);
  const backflows = input.backflows.filter(b => b.isActive);
  if (!controllers.length && !backflows.length) return "nothing_on_file";
  const verifiedAt = input.record?.verifiedAt;
  if (verifiedAt == null || !controllers.length || (!backflows.length && input.record?.noBackflowConfirmedAt == null)) return "not_verified";
  return [...controllers, ...backflows].every(x => isFieldVerified(x) && time(x.fieldVerifiedAt!) <= time(verifiedAt))
    ? "verified" : "not_verified";
}
