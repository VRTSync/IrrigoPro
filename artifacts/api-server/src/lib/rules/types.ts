// Task #553 — App Health Phase 4: Incidents detection engine.
//
// Each rule evaluates a single condition against the live telemetry
// (client_errors / audit_log / field_work_sessions / access-log
// snapshot) and returns whether it is currently firing. The runner
// turns a sequence of evaluations into an `incidents` row that
// transitions open → mitigated (10m clean) → resolved (30m clean).

export type Severity = "P1" | "P2" | "P3" | "P4";

export type RuleEvalResult = {
  firing: boolean;
  /** Short human summary used as the banner headline. */
  summary: string;
  /** Distinct company ids the rule observed in this firing. */
  affectedCompanies?: number[];
  /** Distinct user ids the rule observed in this firing. */
  affectedUsers?: number[];
  /** Free-form details (counts, thresholds, sample values). */
  details?: Record<string, unknown>;
};

export interface Rule {
  /** Stable slug — also the dedupe key for open incidents. */
  id: string;
  severity: Severity;
  /** Pointer to the runbook on the wiki / README. */
  runbookUrl: string;
  /** Cheap, idempotent. Must not throw — return firing=false on error. */
  evaluate(now: Date): Promise<RuleEvalResult>;
  /** Optional side-effect on every firing tick (e.g. lock the user). */
  onFire?(result: RuleEvalResult): Promise<void>;
}

const RUNBOOK_BASE = "https://wiki.irrigopro.local/runbooks";

export function runbook(id: string): string {
  return `${RUNBOOK_BASE}/${id}`;
}
