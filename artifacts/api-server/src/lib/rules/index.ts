import type { Rule } from "./types";
import { photoUploadFailureRateRule } from "./photo-upload-failure-rate";
import { errorRateSpikeRule } from "./error-rate-spike";
import { syncQueueStuckRule } from "./sync-queue-stuck";
import { apiP95BreachRule } from "./api-p95-breach";
import { regressionAfterDeployRule } from "./regression-after-deploy";
import { integrationDownRule } from "./integration-down";
import { authBruteForceRule } from "./auth-brute-force";
import { tenantIsolatedFailureRule } from "./tenant-isolated-failure";

// All rules evaluated by the runner each minute. Order is informational
// only; evaluation is independent per rule.
export const ALL_RULES: Rule[] = [
  photoUploadFailureRateRule,
  errorRateSpikeRule,
  syncQueueStuckRule,
  apiP95BreachRule,
  regressionAfterDeployRule,
  integrationDownRule,
  authBruteForceRule,
  tenantIsolatedFailureRule,
];

export type { Rule, RuleEvalResult, Severity } from "./types";
