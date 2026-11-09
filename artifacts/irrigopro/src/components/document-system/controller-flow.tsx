import { useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, Info, Loader2, Minus, Plus } from "lucide-react";
import type { DocumentationControllerGraph, DocumentationSite } from "@workspace/api-client-react";
import { controllerDocumentationGaps, type ControllerDocInput, type DocGap } from "@workspace/shared";
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
import { CLOCK_LOCATIONS, CONTROLLER_BRANDS, CONTROLLER_MODELS, QUICK_ZONE_COUNTS, serverMessage } from "./constants";
import { useInvalidateDocSite } from "./use-doc-site";

// Slice 4 steps. Slice 5 inserts zone_types, programs and run_times before review.
export const FLOW_STEPS = [
  { key: "photo", title: "Clock photo" },
  { key: "details", title: "Clock details" },
  { key: "zone_count", title: "Zone count" },
  { key: "review", title: "Review" },
] as const;
type StepKey = (typeof FLOW_STEPS)[number]["key"];
const STEP_TITLES = FLOW_STEPS.map((s) => s.title);
const LATER_STEPS = new Set(["zone_types", "programs", "run_times"]);

type Values = {
  photo: string | null;
  name: string;
  location: string;
  brand: string;
  model: string;
  totalZones: number | null;
};

type Action =
  | { kind: "step"; to: number }
  | { kind: "exit" }
  | { kind: "verify" }
  | { kind: "inactive" };

type SaveResult = "ok" | "failed" | "needs-confirm";

function valuesOf(c: DocumentationControllerGraph | null): Values {
  return {
    photo: c?.settingsPhotoUrl ?? null,
    name: c?.name ?? "",
    location: c?.location ?? "",
    brand: c?.brand ?? "",
    model: c?.model ?? "",
    totalZones: c?.totalZones ?? null,
  };
}

function resizeZones(zones: ControllerDocInput["zones"], n: number | null): ControllerDocInput["zones"] {
  if (!n || n < 1) return [];
  const kept = zones.filter((z) => z.zoneNumber <= n);
  const have = new Set(kept.map((z) => z.zoneNumber));
  for (let i = 1; i <= n; i++) {
    if (!have.has(i)) kept.push({ zoneNumber: i, zoneTypeConfirmed: false, programId: null, runTimeMinutes: 0 });
  }
  return kept;
}

export function initialStepFor(c: DocumentationControllerGraph | null): number {
  if (!c) return 0;
  if (c.verified) return FLOW_STEPS.length - 1;
  for (let i = 0; i < FLOW_STEPS.length - 1; i++) {
    if (c.gaps.some((g) => g.step === FLOW_STEPS[i].key)) return i;
  }
  return FLOW_STEPS.length - 1;
}

export interface ControllerFlowProps {
  customerId: number;
  branchName: string;
  site: DocumentationSite;
  /** Snapshot of the controller when the flow opened; null = Add controller. */
  controller: DocumentationControllerGraph | null;
  onExit: (flash: string | null) => void;
  footerOffsetClass?: string;
}

export function ControllerFlow({ customerId, branchName, site, controller, onExit, footerOffsetClass }: ControllerFlowProps) {
  const invalidate = useInvalidateDocSite(customerId, branchName);
  const [step, setStep] = useState(() => initialStepFor(controller));
  const [values, setValues] = useState<Values>(() => valuesOf(controller));
  const savedRef = useRef<Values>(valuesOf(controller));
  const savedIdRef = useRef<number | null>(controller?.id ?? null);
  const [savedId, setSavedId] = useState<number | null>(controller?.id ?? null);
  const [createdLetter, setCreatedLetter] = useState<string | null>(null);
  const changedRef = useRef(false);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; retry: () => void } | null>(null);
  const [dialog, setDialog] = useState<null | { type: "retire"; action: Action } | { type: "leave" } | { type: "inactive" }>(null);
  const [officeZones] = useState<number | null>(controller?.totalZones ?? null);
  // True once the user deliberately picks a count on this step (stepper, input,
  // quick chip or "Matches"). Until then a header/record mismatch stays a gap.
  const [zoneTouched, setZoneTouched] = useState(false);
  const reconciledRef = useRef<number | null>(null);
  const [photoState, setPhotoState] = useState<"idle" | "uploading" | "failed">("idle");
  const photoBlocked = photoState !== "idle";
  const [brandOther, setBrandOther] = useState(() => !!controller?.brand && !CONTROLLER_BRANDS.includes(controller.brand));

  const live = useMemo(
    () => (savedId == null ? null : site.controllers.find((c) => c.id === savedId) ?? null),
    [site, savedId],
  );
  const base = live ?? controller;
  const letter = live?.letter ?? controller?.letter ?? createdLetter ?? "";
  const stepKey: StepKey = FLOW_STEPS[step].key;

  const draftInput: ControllerDocInput = useMemo(() => {
    const zones = base?.zones ?? [];
    return {
      settingsPhotoUrl: values.photo,
      name: values.name,
      location: values.location,
      brand: values.brand,
      model: values.model,
      totalZones: values.totalZones,
      programs: base?.programs ?? [],
      zones: !zoneTouched || zones.length === values.totalZones ? zones : resizeZones(zones, values.totalZones),
    };
  }, [base, values, zoneTouched]);
  const allGaps: DocGap[] = useMemo(() => controllerDocumentationGaps(draftInput), [draftInput]);
  const stepGaps = allGaps.filter((g) => g.step === stepKey);
  const laterGaps = allGaps.some((g) => LATER_STEPS.has(g.step));

  const set = <K extends keyof Values>(k: K, v: Values[K]) => {
    if (k === "totalZones") setZoneTouched(true);
    setValues((prev) => ({ ...prev, [k]: v }));
  };

  const retireRange = (() => {
    const was = savedRef.current.totalZones;
    const now = values.totalZones;
    if (savedIdRef.current == null || !was || !now || now >= was) return null;
    return { from: now + 1, to: was };
  })();

  // ── Saving (D11): only the fields this step changed ────────────────────────
  async function saveStep(key: StepKey, confirmedRetire: boolean, forward: boolean): Promise<SaveResult> {
    const saved = savedRef.current;
    const v = values;
    const id = savedIdRef.current;
    if (key === "photo") {
      if (id == null || !v.photo || v.photo === saved.photo) return "ok";
      await apiRequest(`/api/irrigation-controllers/${id}/photo`, "POST", { url: v.photo });
      savedRef.current = { ...savedRef.current, photo: v.photo };
    } else if (key === "details") {
      if (id == null) {
        const complete = [v.name, v.location, v.brand, v.model].every((s) => s.trim());
        // A draft row is only created by a complete forward Next; Back keeps the local draft.
        if (!complete || !forward) return "ok";
        const created = await apiRequest(`/api/customers/${customerId}/controllers-profile`, "POST", {
          name: v.name.trim(), location: v.location.trim(), brand: v.brand.trim(), model: v.model.trim(),
          branchName, settingsPhotoUrl: v.photo,
        });
        const newId = Number(created?.id);
        if (!Number.isFinite(newId)) throw new Error("The server did not return the new controller.");
        savedIdRef.current = newId;
        setSavedId(newId);
        if (created?.letter) setCreatedLetter(String(created.letter));
        savedRef.current = { ...savedRef.current, name: v.name, location: v.location, brand: v.brand, model: v.model, photo: v.photo };
      } else {
        const body: Record<string, string | null> = {};
        for (const k of ["name", "location", "brand", "model"] as const) {
          if (v[k] !== saved[k]) body[k] = k === "name" ? v[k].trim() : (v[k].trim() || null);
        }
        if (!Object.keys(body).length) return "ok";
        if ("name" in body && !body.name) throw new Error("Name can't be blank. Enter a name to save this clock.");
        await apiRequest(`/api/irrigation-controllers/${id}`, "PUT", body);
        savedRef.current = { ...savedRef.current, name: v.name, location: v.location, brand: v.brand, model: v.model };
      }
    } else if (key === "zone_count") {
      const n = v.totalZones;
      if (id == null || n == null || n < 1 || n > 100) return "ok";
      const graphCount = base?.zones.length ?? 0;
      const reconcile = zoneTouched && graphCount !== n && reconciledRef.current !== n;
      if (n === saved.totalZones && !reconcile) return "ok";
      if (saved.totalZones && n < saved.totalZones && !confirmedRetire) return "needs-confirm";
      await apiRequest(`/api/irrigation-controllers/${id}/zone-count`, "PUT", { totalZones: n });
      savedRef.current = { ...savedRef.current, totalZones: n };
      reconciledRef.current = n;
    } else {
      return "ok";
    }
    changedRef.current = true;
    void invalidate();
    return "ok";
  }

  function finishExit() {
    if (savedIdRef.current == null) { onExit(null); return; }
    if (controller?.verified && !changedRef.current) { onExit(null); return; }
    onExit(`Controller ${letter} saved. It stays unverified until you finish it.`);
  }

  // Serialized: one action runs at a time; further taps are ignored.
  async function run(action: Action, confirmedRetire = false) {
    if (busyRef.current || photoBlocked) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      if (action.kind === "inactive") {
        const id = savedIdRef.current!;
        await apiRequest(`/api/irrigation-controllers/${id}`, "PUT", { isActive: false });
        changedRef.current = true;
        void invalidate();
        onExit(`Controller ${letter} marked not at this location.`);
        return;
      }
      const res = await saveStep(stepKey, confirmedRetire, action.kind === "step" && action.to > step);
      if (res === "needs-confirm") { setDialog({ type: "retire", action }); return; }
      if (action.kind === "step") setStep(action.to);
      else if (action.kind === "exit") finishExit();
      else if (action.kind === "verify") {
        const id = savedIdRef.current!;
        await apiRequest(`/api/irrigation-controllers/${id}/field-verify`, "POST");
        void invalidate();
        onExit(`Controller ${letter} verified.`);
      }
    } catch (e) {
      setError({ message: serverMessage(e), retry: () => { void run(action, confirmedRetire); } });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function saveAndExit() {
    if (busyRef.current || photoBlocked) return;
    if (savedIdRef.current == null) { setDialog({ type: "leave" }); return; }
    void run({ kind: "exit" });
  }
  function back() {
    if (step === 0) saveAndExit();
    else void run({ kind: "step", to: step - 1 });
  }

  const isReview = stepKey === "review";
  const nextTitle = !isReview ? FLOW_STEPS[step + 1].title : null;
  const nextDisabled = busy || photoBlocked || stepGaps.length > 0;
  const verifyDisabled = busy || allGaps.length > 0 || savedId == null;

  const footer = (
    <>
      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800" data-testid="text-save-error">
          <span className="min-w-0">Couldn't save: {error.message}</span>
          <Button type="button" size="sm" variant="outline" className="h-9 shrink-0 border-red-300 text-red-800" onClick={error.retry} data-testid="button-retry">
            Retry
          </Button>
        </div>
      )}
      {!isReview && stepGaps.length > 0 && (
        <p className="text-sm font-medium text-amber-800" data-testid="text-still-needed">
          Still needed: {stepGaps.map((g) => g.label).join(", ")}
        </p>
      )}
      {isReview ? (
        <Button type="button" className="h-12 w-full text-base" disabled={verifyDisabled} onClick={() => void run({ kind: "verify" })} data-testid="button-verify">
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Verify controller {letter}
        </Button>
      ) : (
        <Button type="button" className="h-12 w-full text-base" disabled={nextDisabled} onClick={() => void run({ kind: "step", to: step + 1 })} data-testid="button-next">
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Next: {nextTitle}
        </Button>
      )}
    </>
  );

  const notHereButton = savedId != null && controller != null && (
    <button type="button" className="self-start py-2 text-sm font-medium text-red-700 underline-offset-2 hover:underline" onClick={() => setDialog({ type: "inactive" })} disabled={busy} data-testid="button-not-here">
      This clock isn't at this location
    </button>
  );

  const brandModels = CONTROLLER_MODELS[values.brand] ?? [];

  return (
    <>
      <DocFrame
        title={values.name.trim() || (controller ? "Unnamed controller" : "New controller")}
        subtitle={branchName ? `${site.customer.name}, ${branchName}` : site.customer.name}
        onBack={back}
        flow={{
          mode: controller ? "edit" : "new",
          recordIdentifier: `${letter || "New"} · ${values.name.trim() || "Unnamed"}`,
          currentStep: step + 1,
          stepTitles: STEP_TITLES,
          onSaveExit: saveAndExit,
          busy: busy || photoBlocked,
        }}
        footer={footer}
        footerOffsetClass={footerOffsetClass}
      >
        {stepKey === "photo" && (
          <section className="flex flex-col gap-3" data-testid="step-photo">
            <h2 className="text-base font-semibold">Clock photo</h2>
            <p className="text-sm text-muted-foreground">Open the clock and photograph the face so the programs are readable.</p>
            <DocPhotoField photoId={values.photo} onUploaded={(id) => set("photo", id)} onStateChange={setPhotoState} />
          </section>
        )}

        {stepKey === "details" && (
          <section className="flex flex-col gap-4" data-testid="step-details">
            <p className="rounded-xl bg-slate-100 px-3.5 py-2.5 text-sm text-slate-700" data-testid="text-letter-note">
              {savedId != null && letter
                ? `This clock is letter ${letter}. The letter never changes when you rename it.`
                : "A letter is assigned when you save."}
            </p>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="doc-name" className="text-sm font-semibold">Name <span className="text-red-600">*</span></label>
              <Input id="doc-name" className="h-12 text-base" placeholder="e.g. Clubhouse Clock" value={values.name} onChange={(e) => set("name", e.target.value)} data-testid="input-name" />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold">Where is it? <span className="text-red-600">*</span></span>
              <div className="flex flex-wrap gap-2">
                {CLOCK_LOCATIONS.map((l) => (
                  <DocChip key={l} selected={values.location === l} onClick={() => set("location", l)} testId={`chip-location-${l}`}>{l}</DocChip>
                ))}
              </div>
              <Input aria-label="Where is it?" className="h-12 text-base" placeholder="Or describe it" value={values.location} onChange={(e) => set("location", e.target.value)} data-testid="input-location" />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold">Brand <span className="text-red-600">*</span></span>
              <div className="flex flex-wrap gap-2">
                {CONTROLLER_BRANDS.map((b) => (
                  <DocChip
                    key={b}
                    selected={!brandOther && values.brand === b}
                    onClick={() => {
                      setBrandOther(false);
                      if (values.brand !== b) setValues((p) => ({ ...p, brand: b, model: "" }));
                    }}
                    testId={`chip-brand-${b}`}
                  >{b}</DocChip>
                ))}
                <DocChip
                  selected={brandOther}
                  onClick={() => {
                    if (brandOther) return;
                    setBrandOther(true);
                    setValues((p) => ({ ...p, brand: "", model: "" }));
                  }}
                  testId="chip-brand-Other"
                >Other</DocChip>
              </div>
              {brandOther && (
                <Input aria-label="Brand" className="h-12 text-base" placeholder="Brand name" value={values.brand}
                  onChange={(e) => { const b = e.target.value; setValues((p) => ({ ...p, brand: b, model: "" })); }}
                  data-testid="input-brand" />
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold">Model <span className="text-red-600">*</span></span>
              {brandModels.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {brandModels.map((m) => (
                    <DocChip key={m} selected={values.model === m} onClick={() => set("model", m)} testId={`chip-model-${m}`}>{m}</DocChip>
                  ))}
                </div>
              )}
              <Input aria-label="Model" className="h-12 text-base" placeholder="Model" value={values.model} onChange={(e) => set("model", e.target.value)} data-testid="input-model" />
            </div>
            {notHereButton}
          </section>
        )}

        {stepKey === "zone_count" && (
          <section className="flex flex-col gap-4" data-testid="step-zone-count">
            <h2 className="text-base font-semibold">How many zones does this clock run?</h2>
            {officeZones != null && officeZones > 0 && (
              <div className="flex flex-col gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-3 text-sm text-blue-900">
                <span className="flex items-start gap-2"><Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />The office has {officeZones} zones on file for this clock.</span>
                <div><DocChip selected={values.totalZones === officeZones} onClick={() => set("totalZones", officeZones)} testId="chip-office-zones">Matches, use {officeZones}</DocChip></div>
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <Button type="button" variant="outline" className="h-[60px] w-[60px] rounded-xl" aria-label="Fewer zones"
                onClick={() => set("totalZones", Math.max(1, (values.totalZones ?? 1) - 1))} data-testid="button-zones-minus">
                <Minus className="h-6 w-6" />
              </Button>
              <input
                type="number" inputMode="numeric" min={1} max={100}
                aria-label="Zone count"
                className="h-[60px] min-w-0 flex-1 rounded-xl border border-slate-300 bg-white text-center text-3xl font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-primary"
                value={values.totalZones ?? ""}
                onChange={(e) => {
                  const n = e.target.value === "" ? null : Math.trunc(Number(e.target.value));
                  set("totalZones", n == null || Number.isNaN(n) ? null : Math.min(100, n));
                }}
                data-testid="input-zone-count"
              />
              <Button type="button" variant="outline" className="h-[60px] w-[60px] rounded-xl" aria-label="More zones"
                onClick={() => set("totalZones", Math.min(100, (values.totalZones ?? 0) + 1))} data-testid="button-zones-plus">
                <Plus className="h-6 w-6" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {QUICK_ZONE_COUNTS.map((n) => (
                <DocChip key={n} selected={values.totalZones === n} onClick={() => set("totalZones", n)} testId={`chip-zones-${n}`}>{n}</DocChip>
              ))}
            </div>
            {retireRange && (
              <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800" data-testid="text-retire-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                Zones {retireRange.from} to {retireRange.to} will be retired. Their history and billing are kept; they just stop showing in pickers.
              </p>
            )}
          </section>
        )}

        {isReview && (
          <section className="flex flex-col gap-3" data-testid="step-review">
            {values.photo ? (
              <img src={`/api/photos/${values.photo}?variant=medium`} alt="Clock photo" className="h-[140px] w-full object-cover rounded-xl" />
            ) : (
              <div className="flex h-[140px] w-full items-center justify-center rounded-xl bg-slate-100 text-sm text-slate-500">No photo yet</div>
            )}
            <dl className="divide-y rounded-2xl border border-slate-200 bg-white">
              {([
                ["Photo", values.photo ? "Taken" : "Missing", 0],
                ["Name", values.name || "Not set", 1],
                ["Location", values.location || "Not set", 1],
                ["Brand", [values.brand, values.model].filter(Boolean).join(" ") || "Not set", 1],
                ["Zones", values.totalZones ? String(values.totalZones) : "Not set", 2],
              ] as const).map(([label, value, to]) => (
                <div key={label} className="flex items-center gap-3 px-3.5 py-3">
                  <dt className="w-20 shrink-0 text-sm text-muted-foreground">{label}</dt>
                  <dd className="min-w-0 flex-1 truncate text-[15px] font-medium" data-testid={`text-review-${label.toLowerCase()}`}>{value}</dd>
                  <button type="button" className="min-h-11 px-2 text-sm font-semibold text-primary" disabled={busy} onClick={() => void run({ kind: "step", to })} data-testid={`button-edit-${label.toLowerCase()}`}>
                    Edit
                  </button>
                </div>
              ))}
            </dl>
            {allGaps.length > 0 && (
              <p className="text-sm font-medium text-amber-800" data-testid="text-review-gaps">
                Still needed: {allGaps.map((g) => g.label).join(", ")}
              </p>
            )}
            {laterGaps && (
              <Link href={`/customers/${customerId}/irrigation-profile`} className="text-sm font-medium text-primary underline" data-testid="link-finish-in-profile">
                Finish zone types, programs and run times in Controllers &amp; Zones
              </Link>
            )}
            {notHereButton}
          </section>
        )}
      </DocFrame>

      <AlertDialog open={dialog !== null} onOpenChange={(o) => { if (!o) setDialog(null); }}>
        <AlertDialogContent>
          {dialog?.type === "retire" && retireRange && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Retire zones {retireRange.from} to {retireRange.to}?</AlertDialogTitle>
                <AlertDialogDescription>Their history and billing are kept; they just stop showing in pickers.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="button-dialog-cancel">Cancel</AlertDialogCancel>
                <AlertDialogAction data-testid="button-dialog-retire" onClick={() => { const a = dialog.action; setDialog(null); void run(a, true); }}>Retire</AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
          {dialog?.type === "leave" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
                <AlertDialogDescription>This controller hasn't been saved yet.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="button-dialog-cancel">Keep editing</AlertDialogCancel>
                <AlertDialogAction data-testid="button-dialog-leave" onClick={() => { setDialog(null); onExit(null); }}>Leave</AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
          {dialog?.type === "inactive" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Mark controller {letter} as not at this location?</AlertDialogTitle>
                <AlertDialogDescription>It disappears from this list. History and billing are kept.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="button-dialog-cancel">Cancel</AlertDialogCancel>
                <AlertDialogAction data-testid="button-dialog-inactive" onClick={() => { setDialog(null); void run({ kind: "inactive" }); }}>Mark not here</AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
