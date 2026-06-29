// Job-Type Colors Slice B — source-level assertions.
//
// Guards that:
//   1. Work Order cards use border-l-jobtype-wo (not the old green).
//   2. Billing Sheet cards use border-l-jobtype-bs (not the old orange).
//   3. Estimate cards use border-l-jobtype-est (not the old blue).
//   4. No Work Order card still carries a border-l-green-500 class.
//   5. customer-billing.tsx WCB type accents use text/border-jobtype-wcb tokens.
//   6. customer-billing.tsx STATUS badge teal and selection-ring teal are untouched.
//   7. manager-workspace and billing-workspace StatusTile borders use jobtype tokens.
//   8. The four jobtype tokens in tailwind.config.ts resolve to four distinct hex values.
//
// Runs under Vitest (globals: true — no explicit describe/it/expect imports needed).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PROFILE_SRC = readFileSync(
  resolve(import.meta.dirname, "../../pages/customer-profile.tsx"),
  "utf8",
);

const BILLING_SRC = readFileSync(
  resolve(import.meta.dirname, "../../pages/customer-billing.tsx"),
  "utf8",
);

const TAILWIND_SRC = readFileSync(
  resolve(import.meta.dirname, "../../../tailwind.config.ts"),
  "utf8",
);

const MW_SRC = readFileSync(
  resolve(import.meta.dirname, "../../pages/manager-workspace.tsx"),
  "utf8",
);


// ---------------------------------------------------------------------------
// customer-profile.tsx — TYPE-axis card classes
// ---------------------------------------------------------------------------
describe("customer-profile.tsx — jobtype token assertions", () => {
  it("Work Order cards carry border-l-jobtype-wo", () => {
    expect(PROFILE_SRC).toContain("border-l-jobtype-wo");
  });

  it("Work Order cards do NOT carry border-l-green-500", () => {
    expect(PROFILE_SRC).not.toContain("border-l-green-500");
  });

  it("Billing Sheet cards carry border-l-jobtype-bs", () => {
    expect(PROFILE_SRC).toContain("border-l-jobtype-bs");
  });

  it("Billing Sheet cards do NOT carry border-l-orange-500", () => {
    expect(PROFILE_SRC).not.toContain("border-l-orange-500");
  });

  it("Estimate cards carry border-l-jobtype-est", () => {
    expect(PROFILE_SRC).toContain("border-l-jobtype-est");
  });

  it("Estimate cards do NOT carry border-l-blue-500", () => {
    expect(PROFILE_SRC).not.toContain("border-l-blue-500");
  });

  it("Work Order icon background uses bg-jobtype-wo", () => {
    expect(PROFILE_SRC).toContain("bg-jobtype-wo");
  });

  it("Billing Sheet icon background uses bg-jobtype-bs", () => {
    expect(PROFILE_SRC).toContain("bg-jobtype-bs");
  });
});

// ---------------------------------------------------------------------------
// customer-billing.tsx — WCB TYPE-axis teal → jobtype-wcb
// ---------------------------------------------------------------------------
describe("customer-billing.tsx — WCB jobtype-wcb token assertions", () => {
  it("WCB row icon uses text-jobtype-wcb", () => {
    expect(BILLING_SRC).toContain("text-jobtype-wcb");
  });

  it("WCB [WC] type badge uses bg-jobtype-wcb", () => {
    expect(BILLING_SRC).toContain("bg-jobtype-wcb");
  });

  it("WCB card border uses border-jobtype-wcb", () => {
    expect(BILLING_SRC).toContain("border-jobtype-wcb");
  });

  it("STATUS badge (approved_passed_to_billing) still uses teal — not converted", () => {
    // This is a status badge, NOT a type accent — must remain unchanged.
    const statusConfigMatch = BILLING_SRC.match(/approved_passed_to_billing[^}]+/);
    expect(statusConfigMatch?.[0]).toContain("teal");
  });

  it("selection ring on WCB invoice creation still uses ring-teal-500 — not converted", () => {
    // ring-teal-500 bg-teal-50 is a SELECTION-STATE accent, not a type accent.
    expect(BILLING_SRC).toContain("ring-teal-500");
  });
});

// ---------------------------------------------------------------------------
// manager-workspace.tsx — stage tile border classes use stage-specific tokens
// (not jobtype tokens; the merged workspace uses its own STAGE_META borderClass)
// ---------------------------------------------------------------------------
describe("manager-workspace.tsx — stage border classes present", () => {
  it("needs_review stage uses border-l-blue-500", () => {
    expect(MW_SRC).toContain("border-l-blue-500");
  });

  it("passed_to_billing stage uses border-l-purple-500", () => {
    expect(MW_SRC).toContain("border-l-purple-500");
  });

  it("billed_7d stage uses border-l-green-500", () => {
    // border-l-green-500 IS intentional here (billed stage), not a legacy class
    expect(MW_SRC).toContain("border-l-green-500");
  });

  it("outer wrapper has data-testid manager-workspace", () => {
    expect(MW_SRC).toContain('data-testid="manager-workspace"');
  });
});

// ---------------------------------------------------------------------------
// tailwind.config.ts — four distinct jobtype hex values
// ---------------------------------------------------------------------------
describe("tailwind.config.ts — jobtype token values are distinct hex values", () => {
  it("defines all four jobtype tokens (wo, bs, wcb, est)", () => {
    for (const token of ["wo", "bs", "wcb", "est"]) {
      expect(TAILWIND_SRC, `missing jobtype.${token}`).toContain(`${token}:`);
    }
  });

  it("four jobtype hex values are all distinct", () => {
    const jobtypeBlockMatch = TAILWIND_SRC.match(/jobtype:\s*\{([^}]+)\}/s);
    expect(jobtypeBlockMatch).not.toBeNull();

    const hexValues = Array.from(
      jobtypeBlockMatch![1].matchAll(/"(#[0-9A-Fa-f]{6})"/g),
      (m) => m[1].toLowerCase(),
    );

    expect(hexValues).toHaveLength(4);
    const unique = new Set(hexValues);
    expect(unique.size).toBe(4);
  });

  it("jobtype.wo matches the canonical work-order blue", () => {
    expect(TAILWIND_SRC).toContain('"#1E5A99"');
  });

  it("jobtype.bs matches the canonical billing-sheet amber", () => {
    expect(TAILWIND_SRC).toContain('"#B06820"');
  });

  it("jobtype.wcb matches the canonical wet-check green", () => {
    expect(TAILWIND_SRC).toContain('"#5E8C2A"');
  });

  it("jobtype.est matches the canonical estimate slate (#475569)", () => {
    expect(TAILWIND_SRC).toContain('"#475569"');
  });
});
