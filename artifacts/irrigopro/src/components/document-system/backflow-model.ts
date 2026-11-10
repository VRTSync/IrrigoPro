import type { DocumentationBackflow } from "@workspace/api-client-react";
import type { BackflowDocInput } from "@workspace/shared";

// Keys match BACKFLOW_DOC_STEPS (lib/shared/src/system-documentation.ts).
export const BACKFLOW_FLOW_STEPS = [
  { key: "photo", title: "Device photo" },
  { key: "device", title: "Device" },
  { key: "location", title: "Location" },
  { key: "last_test", title: "Last test" },
  { key: "review", title: "Review" },
] as const;
export type BackflowStepKey = (typeof BACKFLOW_FLOW_STEPS)[number]["key"];

export type TestChoice = "pass" | "fail" | "never_tested" | "no_tag";
export const TEST_CHOICES: { value: TestChoice; label: string }[] = [
  { value: "pass", label: "Pass" },
  { value: "fail", label: "Fail" },
  { value: "never_tested", label: "Never tested" },
  { value: "no_tag", label: "No tag / unknown" },
];

export type BackflowValues = {
  photo: string | null;
  deviceType: string;
  size: string;
  brand: string;
  serialNumber: string;
  model: string;
  name: string;
  location: string;
  installDate: string;
  notes: string;
  /** Pass/Fail entry or unknown reason being captured on Last test. */
  result: TestChoice | null;
  testDate: string;
  testedBy: string;
};

const s = (v: string | null | undefined) => v ?? "";

/** True when the record already carries a Pass or Fail test. */
export function hasTestOnFile(b: Pick<DocumentationBackflow, "lastTestResult"> | null): boolean {
  const r = b?.lastTestResult?.trim();
  return r === "pass" || r === "fail";
}

export function backflowValuesOf(b: DocumentationBackflow | null, draftName: string): BackflowValues {
  const unknown = b?.testUnknownReason === "never_tested" || b?.testUnknownReason === "no_tag" ? (b.testUnknownReason as TestChoice) : null;
  return {
    photo: b?.photoUrl ?? null,
    deviceType: s(b?.deviceType),
    size: s(b?.size),
    brand: s(b?.brand),
    serialNumber: s(b?.serialNumber),
    model: s(b?.model),
    name: b ? s(b.name) : draftName,
    location: s(b?.location),
    installDate: s(b?.installDate).slice(0, 10),
    notes: s(b?.notes),
    // An on-file test is shown as a card; the entry starts empty for a newer one.
    result: hasTestOnFile(b) ? null : unknown,
    testDate: "",
    testedBy: "",
  };
}

/**
 * Matches storage.logBackflowTest on the UTC API server: new Date(<yyyy-mm-dd>)
 * parses as UTC, so the year is rolled in UTC (Feb 29 -> Mar 1) and the
 * preview does not depend on the browser's timezone or DST.
 */
export function nextDueDate(lastTestedDate: string): string | null {
  if (!lastTestedDate) return null;
  try {
    const d = new Date(lastTestedDate);
    d.setUTCFullYear(d.getUTCFullYear() + 1);
    return d.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2025-05-10" -> "May 10, 2025" without a timezone shift. */
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])}, ${m[1]}`;
}

export const resultLabel = (r: string | null | undefined) => (r === "pass" ? "Pass" : r === "fail" ? "Fail" : "");

export type OnFileChoice = "matches" | "newer" | null;

/** The record as it would look if this draft were saved; feeds the shared gap rules. */
export function backflowDraftInput(v: BackflowValues, base: DocumentationBackflow | null, onFile: boolean, choice: OnFileChoice): BackflowDocInput {
  let test: Pick<BackflowDocInput, "lastTestResult" | "lastTestedDate" | "lastTestedBy" | "testUnknownReason">;
  if (onFile && choice !== "newer") {
    test = { lastTestResult: base?.lastTestResult ?? null, lastTestedDate: base?.lastTestedDate ?? null, lastTestedBy: base?.lastTestedBy ?? null, testUnknownReason: null };
  } else if (v.result === "pass" || v.result === "fail") {
    test = { lastTestResult: v.result, lastTestedDate: v.testDate || null, lastTestedBy: v.testedBy, testUnknownReason: null };
  } else if (v.result) {
    test = { lastTestResult: null, lastTestedDate: null, lastTestedBy: null, testUnknownReason: v.result };
  } else {
    test = { lastTestResult: null, lastTestedDate: null, lastTestedBy: null, testUnknownReason: null };
  }
  return {
    photoUrl: v.photo, deviceType: v.deviceType, size: v.size, brand: v.brand, serialNumber: v.serialNumber,
    name: v.name, location: v.location, ...test,
  };
}
