import { sql } from "drizzle-orm";
import { db } from "../../db";
import { appSettings, type IncidentRow } from "@workspace/db/schema";
import { logger } from "../../logger";
import type { Rule } from "./types";

// Task #569 — Page on-call when a critical incident fires.
//
// The detection engine (Task #553) writes rows to `incidents` and
// shows them on the App Health dashboard. This module wires those
// transitions into PagerDuty (Events API v2) and/or Slack so a P1
// or P2 actually pages someone within a minute.
//
// Configuration is stored as a single JSON blob in `app_settings`
// under the key `oncallPaging`. Super admins manage it from the
// "Integrations" tab. The blob is never returned over the wire with
// the raw routing key — only an `*****1234` mask — so a session
// hijack of the App Health page can't lift the credential.

const SETTINGS_KEY = "oncallPaging";
const APP_BASE_URL = process.env.APP_BASE_URL || "https://app.irrigopro.com";
const PAGERDUTY_EVENTS_URL = "https://events.pagerduty.com/v2/enqueue";

export type PagingConfig = {
  pagerDutyEnabled: boolean;
  pagerDutyRoutingKey: string; // 32-char Events API v2 integration key
  slackEnabled: boolean;
  slackWebhookUrl: string;
  pageSeverities: Array<"P1" | "P2" | "P3" | "P4">;
  updatedAt?: string;
  updatedBy?: string | null;
};

export type PagingConfigPublic = Omit<
  PagingConfig,
  "pagerDutyRoutingKey" | "slackWebhookUrl"
> & {
  pagerDutyRoutingKeyMasked: string;
  pagerDutyRoutingKeyConfigured: boolean;
  slackWebhookConfigured: boolean;
};

const DEFAULT_CONFIG: PagingConfig = {
  pagerDutyEnabled: false,
  pagerDutyRoutingKey: "",
  slackEnabled: false,
  slackWebhookUrl: "",
  pageSeverities: ["P1", "P2"],
};

function mask(secret: string): string {
  if (!secret) return "";
  if (secret.length <= 4) return "****";
  return `*****${secret.slice(-4)}`;
}

// Indirection so tests can inject a fake config without standing up
// a Postgres. Production code never touches `__setPagingConfigLoader`.
let configLoader: () => Promise<PagingConfig> = loadPagingConfigFromDb;
export function __setPagingConfigLoader(fn: (() => Promise<PagingConfig>) | null): void {
  configLoader = fn ?? loadPagingConfigFromDb;
}

export function loadPagingConfig(): Promise<PagingConfig> {
  return configLoader();
}

async function loadPagingConfigFromDb(): Promise<PagingConfig> {
  try {
    const r = await db
      .select()
      .from(appSettings)
      .where(sql`${appSettings.key} = ${SETTINGS_KEY}`);
    const raw = r[0]?.value;
    if (!raw) return { ...DEFAULT_CONFIG };
    const parsed = JSON.parse(raw) as Partial<PagingConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      pageSeverities:
        Array.isArray(parsed.pageSeverities) && parsed.pageSeverities.length > 0
          ? (parsed.pageSeverities.filter((s) =>
              ["P1", "P2", "P3", "P4"].includes(s),
            ) as PagingConfig["pageSeverities"])
          : DEFAULT_CONFIG.pageSeverities,
    };
  } catch (err) {
    logger.warn("loadPagingConfig failed", "paging", { err: String(err) });
    return { ...DEFAULT_CONFIG };
  }
}

export function toPublicConfig(c: PagingConfig): PagingConfigPublic {
  const {
    pagerDutyRoutingKey,
    slackWebhookUrl,
    ...rest
  } = c;
  return {
    ...rest,
    pagerDutyRoutingKeyMasked: mask(pagerDutyRoutingKey),
    pagerDutyRoutingKeyConfigured: pagerDutyRoutingKey.length > 0,
    slackWebhookConfigured: slackWebhookUrl.length > 0,
  };
}

export async function savePagingConfig(
  next: PagingConfig,
  actorLabel: string | null,
): Promise<void> {
  const merged: PagingConfig = {
    ...next,
    updatedAt: new Date().toISOString(),
    updatedBy: actorLabel,
  };
  const value = JSON.stringify(merged);
  await db.execute(sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (${SETTINGS_KEY}, ${value}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `);
}

// Stable PagerDuty dedup_key per incident so resolve/ack target the
// same alert that fire opened.
function dedupKey(incidentId: number): string {
  return `irrigopro-incident-${incidentId}`;
}

function incidentLink(incidentId: number): string {
  return `${APP_BASE_URL}/super-admin/app-health?incident=${incidentId}`;
}

function pagerDutySeverity(sev: string): "critical" | "error" | "warning" | "info" {
  switch (sev) {
    case "P1":
      return "critical";
    case "P2":
      return "error";
    case "P3":
      return "warning";
    default:
      return "info";
  }
}

async function postJson(
  url: string,
  body: unknown,
  label: string,
): Promise<void> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.warn(`${label} delivery failed`, "paging", {
        status: res.status,
        body: text.slice(0, 500),
      });
    }
  } catch (err) {
    logger.warn(`${label} delivery threw`, "paging", { err: String(err) });
  }
}

async function sendPagerDutyEvent(
  cfg: PagingConfig,
  action: "trigger" | "resolve" | "acknowledge",
  incident: IncidentRow,
  rule: { id: string; runbookUrl: string },
): Promise<void> {
  if (!cfg.pagerDutyEnabled || !cfg.pagerDutyRoutingKey) return;
  const payload: Record<string, unknown> = {
    routing_key: cfg.pagerDutyRoutingKey,
    event_action: action,
    dedup_key: dedupKey(incident.id),
  };
  if (action === "trigger") {
    payload.payload = {
      summary: `[${incident.severity}] ${incident.summary}`,
      source: "irrigopro-app-health",
      severity: pagerDutySeverity(incident.severity),
      component: rule.id,
      group: "irrigopro",
      class: rule.id,
      custom_details: {
        ruleId: rule.id,
        incidentId: incident.id,
        runbookUrl: rule.runbookUrl,
        appHealthUrl: incidentLink(incident.id),
        affectedCompanies: incident.affectedCompanies,
        affectedUsers: incident.affectedUsers,
        details: incident.details,
      },
    };
    payload.links = [
      { href: incidentLink(incident.id), text: "Open in App Health" },
      { href: rule.runbookUrl, text: "Runbook" },
    ];
    payload.client = "IrrigoPro App Health";
    payload.client_url = incidentLink(incident.id);
  }
  await postJson(PAGERDUTY_EVENTS_URL, payload, "PagerDuty");
}

async function sendSlackMessage(
  cfg: PagingConfig,
  kind: "fire" | "resolve" | "ack",
  incident: IncidentRow,
  rule: { id: string; runbookUrl: string },
  actorLabel?: string | null,
): Promise<void> {
  if (!cfg.slackEnabled || !cfg.slackWebhookUrl) return;
  const sevEmoji =
    incident.severity === "P1"
      ? ":rotating_light:"
      : incident.severity === "P2"
        ? ":warning:"
        : ":information_source:";
  const verb =
    kind === "fire"
      ? `${sevEmoji} *${incident.severity} incident OPEN*`
      : kind === "ack"
        ? `:eyes: *${incident.severity} incident ACKED*${actorLabel ? ` by ${actorLabel}` : ""}`
        : `:white_check_mark: *${incident.severity} incident RESOLVED*`;
  const text = [
    verb,
    `*Rule:* \`${rule.id}\``,
    `*Summary:* ${incident.summary}`,
    `*Runbook:* ${rule.runbookUrl}`,
    `*App Health:* ${incidentLink(incident.id)}`,
  ].join("\n");
  await postJson(cfg.slackWebhookUrl, { text }, "Slack");
}

// Public hooks called by the runner / routes.

function shouldPage(cfg: PagingConfig, severity: string): boolean {
  return cfg.pageSeverities.includes(severity as PagingConfig["pageSeverities"][number]);
}

export async function notifyIncidentOpened(
  incident: IncidentRow,
  rule: Pick<Rule, "id" | "runbookUrl">,
): Promise<void> {
  const cfg = await loadPagingConfig();
  if (!shouldPage(cfg, incident.severity)) return;
  await Promise.all([
    sendPagerDutyEvent(cfg, "trigger", incident, rule),
    sendSlackMessage(cfg, "fire", incident, rule),
  ]);
}

export async function notifyIncidentResolved(
  incident: IncidentRow,
  rule: Pick<Rule, "id" | "runbookUrl">,
): Promise<void> {
  const cfg = await loadPagingConfig();
  if (!shouldPage(cfg, incident.severity)) return;
  await Promise.all([
    sendPagerDutyEvent(cfg, "resolve", incident, rule),
    sendSlackMessage(cfg, "resolve", incident, rule),
  ]);
}

export async function notifyIncidentAcked(
  incident: IncidentRow,
  rule: Pick<Rule, "id" | "runbookUrl">,
  actorLabel: string | null,
): Promise<void> {
  const cfg = await loadPagingConfig();
  if (!shouldPage(cfg, incident.severity)) return;
  // Task #569 — acknowledging an incident in App Health is the
  // operator saying "I've got it"; per the spec we resolve the
  // PagerDuty page so on-call rotation isn't paged again. Slack
  // gets an "ACKED by <user>" note since it doesn't have a notion
  // of an open alert to close.
  await Promise.all([
    sendPagerDutyEvent(cfg, "resolve", incident, rule),
    sendSlackMessage(cfg, "ack", incident, rule, actorLabel),
  ]);
}

// Synchronous "send a synthetic page right now" for the test button
// in the Integrations tab. Bypasses severity gating but still
// respects the per-channel enable flag + credential presence.
export async function sendTestPage(): Promise<{
  pagerDuty: boolean;
  slack: boolean;
}> {
  const cfg = await loadPagingConfig();
  const fakeIncident = {
    id: 0,
    ruleId: "synthetic.test-page",
    severity: "P2",
    status: "open",
    trigger: "manual",
    summary: "Test page from IrrigoPro App Health",
    runbookUrl: "https://wiki.irrigopro.local/runbooks/test",
    ownerUserId: null,
    ownerLabel: null,
    startedAt: new Date(),
    lastFiringAt: new Date(),
    cleanSinceAt: null,
    mitigatedAt: null,
    resolvedAt: null,
    ackedAt: null,
    affectedCompanies: [],
    affectedUsers: [],
    details: { test: true },
    fireCount: 1,
  } as unknown as IncidentRow;
  const rule = {
    id: "synthetic.test-page",
    runbookUrl: "https://wiki.irrigopro.local/runbooks/test",
  };
  await Promise.all([
    sendPagerDutyEvent(cfg, "trigger", fakeIncident, rule),
    sendSlackMessage(cfg, "fire", fakeIncident, rule),
  ]);
  return {
    pagerDuty: cfg.pagerDutyEnabled && cfg.pagerDutyRoutingKey.length > 0,
    slack: cfg.slackEnabled && cfg.slackWebhookUrl.length > 0,
  };
}
