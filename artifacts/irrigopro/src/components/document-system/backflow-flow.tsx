import { useMemo, useRef, useState } from "react";
import { CalendarClock, Info, Loader2, ShieldCheck } from "lucide-react";
import type { DocumentationBackflow, DocumentationSite } from "@workspace/api-client-react";
import { backflowDocumentationGaps, type DocGap } from "@workspace/shared";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DocFrame } from "./doc-frame";
import { DocChip } from "./doc-chip";
import { DocPhotoField } from "./doc-photo-field";
import {
  BACKFLOW_BRANDS, BACKFLOW_LOCATIONS, BACKFLOW_SIZES, BACKFLOW_TYPES, backflowTypeLabel, serverMessage,
} from "./constants";
import {
  BACKFLOW_FLOW_STEPS, TEST_CHOICES, backflowDraftInput, backflowValuesOf, formatDay, hasTestOnFile, nextDueDate, resultLabel,
  type BackflowStepKey, type BackflowValues, type OnFileChoice,
} from "./backflow-model";
import { useInvalidateDocSite } from "./use-doc-site";

const STEP_TITLES = BACKFLOW_FLOW_STEPS.map((s) => s.title);
const stepIndex = (k: BackflowStepKey) => BACKFLOW_FLOW_STEPS.findIndex((s) => s.key === k);
const LAST = BACKFLOW_FLOW_STEPS.length - 1;

type Action = { kind: "step"; to: number } | { kind: "exit" } | { kind: "verify" } | { kind: "inactive" };

/** What the server holds for the test, so only real changes are written. */
type SavedTest = { result: string | null; date: string | null; by: string | null; unknown: string | null };
const savedTestOf = (b: DocumentationBackflow | null): SavedTest => ({
  result: b?.lastTestResult ?? null, date: b?.lastTestedDate?.slice(0, 10) ?? null, by: b?.lastTestedBy ?? null, unknown: b?.testUnknownReason ?? null,
});

export function initialBackflowStep(b: DocumentationBackflow | null): number {
  if (!b) return 0;
  if (b.verified) return LAST;
  for (let i = 0; i < LAST; i++) if (b.gaps.some((g) => g.step === BACKFLOW_FLOW_STEPS[i].key)) return i;
  return LAST;
}

export interface BackflowFlowProps {
  customerId: number;
  branchName: string;
  site: DocumentationSite;
  /** Snapshot when the flow opened; null = Add backflow. */
  backflow: DocumentationBackflow | null;
  /** Name for a new draft, "Backflow <active count + 1>". */
  draftName: string;
  onExit: (flash: string | null) => void;
  footerOffsetClass?: string;
}

export function BackflowFlow({ customerId, branchName, site, backflow, draftName, onExit, footerOffsetClass }: BackflowFlowProps) {
  const invalidateSite = useInvalidateDocSite(customerId, branchName);
  const savedIdRef = useRef<number | null>(backflow?.id ?? null);
  const invalidate = () => invalidateSite(null, savedIdRef.current);
  const [savedId, setSavedId] = useState<number | null>(backflow?.id ?? null);
  const [step, setStep] = useState(() => initialBackflowStep(backflow));
  const [values, setValues] = useState<BackflowValues>(() => backflowValuesOf(backflow, draftName));
  const savedRef = useRef<BackflowValues>(backflowValuesOf(backflow, draftName));
  const savedTestRef = useRef<SavedTest>(savedTestOf(backflow));
  // Rule 4: an on-file test must be checked against the tag in this session.
  const [choice, setChoice] = useState<OnFileChoice>(null);
  const changedRef = useRef(false);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; retry: () => void } | null>(null);
  const [dialog, setDialog] = useState<null | "leave" | "inactive">(null);
  const [photoState, setPhotoState] = useState<"idle" | "uploading" | "failed">("idle");
  const photoBlocked = photoState !== "idle";
  const [brandOther, setBrandOther] = useState(() => !!backflow?.brand && !BACKFLOW_BRANDS.includes(backflow.brand));

  const live = useMemo(() => (savedId == null ? null : site.backflows.find((b) => b.id === savedId) ?? null), [site, savedId]);
  const base = live ?? backflow;
  const onFile = hasTestOnFile(base);
  const stepKey: BackflowStepKey = BACKFLOW_FLOW_STEPS[step].key;
  const displayName = values.name.trim() || savedRef.current.name.trim() || draftName;

  const allGaps: DocGap[] = useMemo(
    () => backflowDocumentationGaps(backflowDraftInput(values, base, onFile, choice)),
    [values, base, onFile, choice],
  );
  const tagUnchecked = onFile && choice === null;
  const stepGaps = allGaps.filter((g) => g.step === stepKey);
  const stepNeeded = [...stepGaps.map((g) => g.label), ...(stepKey === "last_test" && tagUnchecked ? ["check the test tag"] : [])];
  const reviewNeeded = [...allGaps.map((g) => g.label), ...(tagUnchecked ? ["check the test tag"] : [])];

  // A Pass/Fail entry still missing its date or tester (never saved, never silently dropped).
  const partialTest = savedIdRef.current != null && (!onFile || choice === "newer")
    && (values.result === "pass" || values.result === "fail") && (!values.testDate || !values.testedBy.trim());

  const set = <K extends keyof BackflowValues>(k: K, v: BackflowValues[K]) => setValues((p) => ({ ...p, [k]: v }));

  // ── Saving (D11): only what this step changed ──────────────────────────────
  async function saveStep(key: BackflowStepKey, forward: boolean, exiting: boolean): Promise<void> {
    const v = values;
    const saved = savedRef.current;
    const id = savedIdRef.current;
    let wrote = false;
    if (key === "photo") {
      if (id == null || !v.photo || v.photo === saved.photo) return;
      await apiRequest(`/api/backflows/${id}`, "PUT", { photoUrl: v.photo });
      savedRef.current = { ...savedRef.current, photo: v.photo };
      wrote = true;
    } else if (key === "device") {
      if (id == null) {
        const complete = [v.deviceType, v.size, v.brand, v.serialNumber].every((x) => x.trim());
        // The row is only created by a complete forward Next; Back keeps the local draft.
        if (!complete || !forward) return;
        const created = await apiRequest(`/api/customers/${customerId}/backflows`, "POST", {
          name: v.name.trim() || draftName, branchName, deviceType: v.deviceType, size: v.size, brand: v.brand.trim(),
          model: v.model.trim() || null, serialNumber: v.serialNumber.trim(), photoUrl: v.photo,
        });
        const newId = Number(created?.id);
        if (!Number.isFinite(newId)) throw new Error("The server did not return the new backflow.");
        savedIdRef.current = newId;
        setSavedId(newId);
        savedRef.current = { ...savedRef.current, deviceType: v.deviceType, size: v.size, brand: v.brand, model: v.model, serialNumber: v.serialNumber, photo: v.photo, name: v.name.trim() || draftName };
        wrote = true;
      } else {
        const body: Record<string, string | null> = {};
        for (const k of ["deviceType", "size", "brand", "serialNumber", "model"] as const) {
          if (v[k].trim() !== saved[k].trim()) body[k] = k === "deviceType" ? v[k] : (v[k].trim() || null);
        }
        if (!Object.keys(body).length) return;
        if ("deviceType" in body && !body.deviceType) throw new Error("Pick the device type to save this backflow.");
        await apiRequest(`/api/backflows/${id}`, "PUT", body);
        savedRef.current = { ...savedRef.current, deviceType: v.deviceType, size: v.size, brand: v.brand, serialNumber: v.serialNumber, model: v.model };
        wrote = true;
      }
    } else if (key === "location") {
      if (id == null) return;
      const body: Record<string, string | null> = {};
      for (const k of ["name", "location", "installDate"] as const) {
        if (v[k].trim() !== saved[k].trim()) body[k] = k === "name" ? v[k].trim() : (v[k].trim() || null);
      }
      if (!Object.keys(body).length) return;
      if ("name" in body && !body.name) throw new Error("Name can't be blank. Enter a name to save this backflow.");
      await apiRequest(`/api/backflows/${id}`, "PUT", body);
      savedRef.current = { ...savedRef.current, name: v.name, location: v.location, installDate: v.installDate };
      wrote = true;
    } else if (key === "last_test") {
      if (id == null) return;
      if (onFile && choice !== "newer") return; // Matches the tag writes nothing.
      const st = savedTestRef.current;
      if (v.result === "pass" || v.result === "fail") {
        const by = v.testedBy.trim();
        if (!v.testDate || !by) {
          // Never claim a partial test was saved. Back keeps it on screen; Save & exit stops here.
          if (exiting) throw new Error("Enter the test date and tester to save this test, or go back and keep it as a draft.");
          return;
        }
        if (st.result === v.result && st.date === v.testDate && st.by === by && !st.unknown) { setChoice("matches"); return; }
        await apiRequest(`/api/backflows/${id}/log-test`, "POST", { lastTestedDate: v.testDate, lastTestResult: v.result, lastTestedBy: by });
        savedTestRef.current = { result: v.result, date: v.testDate, by, unknown: null };
        // The tech just read this from the tag, so it is the checked on-file test now.
        setChoice("matches");
        wrote = true;
      } else if (v.result) {
        if (st.unknown === v.result && !st.result) return;
        await apiRequest(`/api/backflows/${id}`, "PUT", { testUnknownReason: v.result });
        savedTestRef.current = { ...st, unknown: v.result };
        wrote = true;
      }
    }
    if (wrote) {
      changedRef.current = true;
      void invalidate();
    }
  }

  function finishExit() {
    if (savedIdRef.current == null) { onExit(null); return; }
    if (backflow?.verified && !changedRef.current) { onExit(null); return; }
    onExit(`${displayName} saved. It stays unverified until you finish it.`);
  }

  // Serialized: one action at a time; further taps are ignored.
  async function run(action: Action) {
    if (busyRef.current || photoBlocked) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      if (action.kind === "inactive") {
        if (savedIdRef.current == null) return; // Drafts have nothing to deactivate.
        await apiRequest(`/api/backflows/${savedIdRef.current}`, "PUT", { isActive: false });
        changedRef.current = true;
        void invalidate();
        onExit(`${displayName} marked not at this location.`);
        return;
      }
      if (action.kind === "exit" && stepKey !== "last_test" && partialTest) {
        throw new Error("The last test is missing its date or tester. Finish it on Last test, or clear the result.");
      }
      await saveStep(stepKey, action.kind === "step" && action.to > step, action.kind === "exit");
      if (action.kind === "step") setStep(action.to);
      else if (action.kind === "exit") finishExit();
      else {
        await apiRequest(`/api/backflows/${savedIdRef.current}/field-verify`, "POST");
        void invalidate();
        onExit(`${displayName} verified.`);
      }
    } catch (e) {
      setError({ message: serverMessage(e), retry: () => { void run(action); } });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function saveAndExit() {
    if (busyRef.current || photoBlocked) return;
    if (savedIdRef.current == null) { setDialog("leave"); return; }
    void run({ kind: "exit" });
  }
  function back() {
    if (step === 0) saveAndExit();
    else void run({ kind: "step", to: step - 1 });
  }

  const isReview = stepKey === "review";
  const nextDisabled = busy || photoBlocked || stepNeeded.length > 0;
  const verifyDisabled = busy || reviewNeeded.length > 0 || savedId == null;

  const footer = (
    <>
      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800" data-testid="text-save-error">
          <span className="min-w-0">Couldn't save: {error.message}</span>
          <Button type="button" size="sm" variant="outline" className="h-11 shrink-0 border-red-300 text-red-800" onClick={error.retry} data-testid="button-retry">Retry</Button>
        </div>
      )}
      {!isReview && stepNeeded.length > 0 && (
        <p className="text-sm font-medium text-amber-800" data-testid="text-still-needed">Still needed: {stepNeeded.join(", ")}</p>
      )}
      {isReview ? (
        <Button type="button" className="h-12 w-full text-base" disabled={verifyDisabled} onClick={() => void run({ kind: "verify" })} data-testid="button-verify">
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Verify backflow
        </Button>
      ) : (
        <Button type="button" className="h-12 w-full text-base" disabled={nextDisabled} onClick={() => void run({ kind: "step", to: step + 1 })} data-testid="button-next">
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Next: {BACKFLOW_FLOW_STEPS[step + 1]?.title}
        </Button>
      )}
    </>
  );

  const notHereButton = savedId != null && backflow != null && (
    <button type="button" className="min-h-11 self-start py-2 text-sm font-medium text-red-700 underline-offset-2 hover:underline" onClick={() => setDialog("inactive")} disabled={busy} data-testid="button-not-here">
      This backflow isn't at this location
    </button>
  );

  const isPassFail = values.result === "pass" || values.result === "fail";
  const showEntry = !onFile || choice === "newer";
  const due = isPassFail ? nextDueDate(values.testDate) : null;

  const testEntry = (
    <div className="flex flex-col gap-4" data-testid="test-entry">
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold">Result <span className="text-red-600">*</span></span>
        <div className="flex flex-wrap gap-2">
          {TEST_CHOICES.filter((c) => !onFile || c.value === "pass" || c.value === "fail").map((c) => (
            <DocChip key={c.value} selected={values.result === c.value} onClick={() => set("result", c.value)} testId={`chip-result-${c.value}`}>{c.label}</DocChip>
          ))}
        </div>
      </div>
      {isPassFail && (
        <>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="bf-test-date" className="text-sm font-semibold">Test date <span className="text-red-600">*</span></label>
            <Input id="bf-test-date" type="date" className="h-12 text-base" value={values.testDate} onChange={(e) => set("testDate", e.target.value)} data-testid="input-test-date" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="bf-tested-by" className="text-sm font-semibold">Tested by <span className="text-red-600">*</span></label>
            <Input id="bf-tested-by" className="h-12 text-base" placeholder="Tester or company on the tag" value={values.testedBy} onChange={(e) => set("testedBy", e.target.value)} data-testid="input-tested-by" />
          </div>
          {due && (
            <p className="flex items-center gap-2 text-sm text-slate-700" data-testid="text-next-due">
              <CalendarClock className="h-4 w-4 shrink-0 text-primary" aria-hidden />Next test due {formatDay(due)}
            </p>
          )}
        </>
      )}
    </div>
  );

  const reviewTest = (() => {
    const t = onFile && choice !== "newer"
      ? { r: base?.lastTestResult ?? null, d: base?.lastTestedDate ?? null, by: base?.lastTestedBy ?? null, due: base?.nextTestDueDate ?? null }
      : isPassFail ? { r: values.result, d: values.testDate, by: values.testedBy.trim(), due: nextDueDate(values.testDate) } : null;
    if (t) return `${resultLabel(t.r)} on ${formatDay(t.d)} by ${t.by ?? ""}${t.due ? `\nNext due ${formatDay(t.due)}` : ""}`;
    if (values.result === "never_tested") return "Never tested";
    if (values.result === "no_tag") return "No tag / unknown";
    return "Not set";
  })();

  const rows: [string, string, number][] = [
    ["Photo", values.photo ? "Taken" : "Missing", stepIndex("photo")],
    ["Device", `${[backflowTypeLabel(values.deviceType), values.size].filter(Boolean).join(", ") || "Not set"}\n${[values.brand, values.model].filter(Boolean).join(" ")}`.trim(), stepIndex("device")],
    ["Serial", values.serialNumber || "Not set", stepIndex("device")],
    ["Name", values.name || "Not set", stepIndex("location")],
    ["Location", values.location || "Not set", stepIndex("location")],
    ["Installed", values.installDate ? formatDay(values.installDate) : "Not known", stepIndex("location")],
    ["Last test", reviewTest, stepIndex("last_test")],
  ];

  return (
    <>
      <DocFrame
        title={displayName}
        subtitle={branchName ? `${site.customer.name}, ${branchName}` : site.customer.name}
        onBack={back}
        flow={{
          mode: backflow ? "edit" : "new",
          recordIdentifier: displayName,
          currentStep: step + 1,
          stepTitles: STEP_TITLES,
          onSaveExit: saveAndExit,
          busy: busy || photoBlocked,
          kindLabel: "Backflow",
          icon: ShieldCheck,
        }}
        footer={footer}
        contentDisabled={busy}
        footerOffsetClass={footerOffsetClass}
      >
        {stepKey === "photo" && (
          <section className="flex flex-col gap-3" data-testid="step-bf-photo">
            <h2 className="text-base font-semibold">Device photo</h2>
            <p className="text-sm text-muted-foreground">Get the whole device and the serial plate. Clear dirt off the plate first if you can.</p>
            <DocPhotoField photoId={values.photo} onUploaded={(id) => set("photo", id)} onStateChange={setPhotoState} label="Device photo" />
          </section>
        )}

        {stepKey === "device" && (
          <section className="flex flex-col gap-4" data-testid="step-bf-device">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold">Type <span className="text-red-600">*</span></span>
              <div className="flex flex-wrap gap-2">
                {BACKFLOW_TYPES.map((t) => (
                  <DocChip key={t.value} selected={values.deviceType === t.value} onClick={() => set("deviceType", t.value)} testId={`chip-type-${t.value}`}>{t.label}</DocChip>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold">Size <span className="text-red-600">*</span></span>
              <div className="flex flex-wrap gap-2">
                {BACKFLOW_SIZES.map((z) => (
                  <DocChip key={z} selected={values.size === z} onClick={() => set("size", z)} testId={`chip-size-${z}`}>{z}</DocChip>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold">Brand <span className="text-red-600">*</span></span>
              <div className="flex flex-wrap gap-2">
                {BACKFLOW_BRANDS.map((b) => (
                  <DocChip key={b} selected={!brandOther && values.brand === b} onClick={() => { setBrandOther(false); set("brand", b); }} testId={`chip-bf-brand-${b}`}>{b}</DocChip>
                ))}
                <DocChip selected={brandOther} onClick={() => { if (brandOther) return; setBrandOther(true); set("brand", ""); }} testId="chip-bf-brand-Other">Other</DocChip>
              </div>
              {brandOther && (
                <Input aria-label="Brand" className="h-12 text-base" placeholder="Brand name" value={values.brand} onChange={(e) => set("brand", e.target.value)} data-testid="input-bf-brand" />
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="bf-serial" className="text-sm font-semibold">Serial number <span className="text-red-600">*</span></label>
              <Input id="bf-serial" autoCapitalize="characters" autoCorrect="off" spellCheck={false} className="h-12 text-base uppercase tracking-wide" placeholder="From the serial plate"
                value={values.serialNumber} onChange={(e) => set("serialNumber", e.target.value)} data-testid="input-serial" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="bf-model" className="text-sm font-semibold">Model (if shown)</label>
              <Input id="bf-model" className="h-12 text-base" value={values.model} onChange={(e) => set("model", e.target.value)} data-testid="input-bf-model" />
            </div>
          </section>
        )}

        {stepKey === "location" && (
          <section className="flex flex-col gap-4" data-testid="step-bf-location">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="bf-name" className="text-sm font-semibold">Name <span className="text-red-600">*</span></label>
              <Input id="bf-name" className="h-12 text-base" value={values.name} onChange={(e) => set("name", e.target.value)} data-testid="input-bf-name" />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold">Where is it? <span className="text-red-600">*</span></span>
              <div className="flex flex-wrap gap-2">
                {BACKFLOW_LOCATIONS.map((l) => (
                  <DocChip key={l} selected={values.location === l} onClick={() => set("location", l)} testId={`chip-bf-location-${l}`}>{l}</DocChip>
                ))}
              </div>
              <Input aria-label="Where is it?" className="h-12 text-base" placeholder="Or describe it" value={values.location} onChange={(e) => set("location", e.target.value)} data-testid="input-bf-location" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="bf-install" className="text-sm font-semibold">Install date (if known)</label>
              <Input id="bf-install" type="date" className="h-12 text-base" value={values.installDate} onChange={(e) => set("installDate", e.target.value)} data-testid="input-install-date" />
            </div>
            {notHereButton}
          </section>
        )}

        {stepKey === "last_test" && (
          <section className="flex flex-col gap-4" data-testid="step-bf-last-test">
            <h2 className="text-base font-semibold">Last test</h2>
            {onFile ? (
              <>
                <div className="flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-3 text-sm text-blue-900" data-testid="text-test-on-file">
                  <span className="flex items-start gap-2">
                    <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span>
                      On file: {resultLabel(base?.lastTestResult)} on {formatDay(base?.lastTestedDate)} by {base?.lastTestedBy ?? "unknown tester"}.
                      {base?.nextTestDueDate ? ` Next due ${formatDay(base.nextTestDueDate)}.` : ""}
                    </span>
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <DocChip selected={choice === "matches"} onClick={() => setChoice("matches")} testId="chip-test-matches">Matches the tag</DocChip>
                    <DocChip selected={choice === "newer"} onClick={() => setChoice("newer")} testId="chip-test-newer">Tag shows a newer test</DocChip>
                  </div>
                </div>
                {showEntry && testEntry}
              </>
            ) : testEntry}
          </section>
        )}

        {isReview && (
          <section className="flex flex-col gap-3" data-testid="step-review">
            {values.photo ? (
              <img src={`/api/photos/${values.photo}?variant=medium`} alt="Device photo" className="h-[140px] w-full rounded-xl object-cover" />
            ) : (
              <div className="flex h-[140px] w-full items-center justify-center rounded-xl bg-slate-100 text-sm text-slate-500">No photo yet</div>
            )}
            <dl className="divide-y rounded-2xl border border-slate-200 bg-white">
              {rows.map(([label, value, to]) => {
                const tid = label.toLowerCase().replace(/\s+/g, "-");
                return (
                  <div key={label} className="flex items-center gap-3 px-3.5 py-3">
                    <dt className="w-20 shrink-0 self-start pt-0.5 text-sm text-muted-foreground">{label}</dt>
                    <dd className="min-w-0 flex-1 whitespace-pre-line break-words text-[15px] font-medium" data-testid={`text-review-${tid}`}>{value}</dd>
                    <button type="button" className="min-h-11 px-2 text-sm font-semibold text-primary" disabled={busy} onClick={() => void run({ kind: "step", to })} data-testid={`button-edit-${tid}`}>Edit</button>
                  </div>
                );
              })}
            </dl>
            {reviewNeeded.length > 0 && (
              <p className="text-sm font-medium text-amber-800" data-testid="text-review-gaps">Still needed: {reviewNeeded.join(", ")}</p>
            )}
            {notHereButton}
          </section>
        )}
      </DocFrame>

      <AlertDialog open={dialog !== null} onOpenChange={(o) => { if (!o) setDialog(null); }}>
        <AlertDialogContent>
          {dialog === "leave" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
                <AlertDialogDescription>This backflow hasn't been saved yet.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="min-h-11" data-testid="button-dialog-cancel">Keep editing</AlertDialogCancel>
                <AlertDialogAction className="min-h-11" data-testid="button-dialog-leave" onClick={() => { setDialog(null); onExit(null); }}>Leave</AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
          {dialog === "inactive" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Mark {displayName} as not at this location?</AlertDialogTitle>
                <AlertDialogDescription>It disappears from this list. Its history is kept.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="min-h-11" data-testid="button-dialog-cancel">Cancel</AlertDialogCancel>
                <AlertDialogAction className="min-h-11" data-testid="button-dialog-inactive" onClick={() => { setDialog(null); void run({ kind: "inactive" }); }}>Mark not here</AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
