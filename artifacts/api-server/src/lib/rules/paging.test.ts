// Task #569 — focused unit tests for the on-call paging pipeline.
// Covers the contract that ack-in-App-Health resolves the PagerDuty
// page (NOT acknowledges it) and that severity gating + credential
// presence are honored before any HTTP call goes out.

import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";

// The paging module pulls in a DB connection at import time. We swap
// `loadPagingConfig` per-test by reaching into the module namespace,
// and stub `globalThis.fetch` to capture outbound requests.
import * as paging from "./paging";
import type { PagingConfig } from "./paging";
import type { IncidentRow } from "@workspace/db/schema";

type Captured = { url: string; body: any };

function stubFetch(): { calls: Captured[]; restore: () => void } {
  const calls: Captured[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: any) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    return new Response("", { status: 202 });
  }) as any;
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

function fakeIncident(over: Partial<IncidentRow> = {}): IncidentRow {
  return {
    id: 42,
    ruleId: "test.rule",
    severity: "P1",
    status: "open",
    trigger: "auto",
    summary: "Synthetic test incident",
    runbookUrl: "https://wiki/runbook",
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
    details: null,
    fireCount: 1,
    ...over,
  } as IncidentRow;
}

function withConfig(cfg: PagingConfig): () => void {
  paging.__setPagingConfigLoader(async () => cfg);
  return () => paging.__setPagingConfigLoader(null);
}

const FULL_CFG: PagingConfig = {
  pagerDutyEnabled: true,
  pagerDutyRoutingKey: "ROUTING_KEY_TEST_1234",
  slackEnabled: true,
  slackWebhookUrl: "https://hooks.slack.com/services/T/B/X",
  pageSeverities: ["P1", "P2"],
};

describe("paging — notifyIncidentAcked", () => {
  let restoreCfg: () => void;
  let fetchStub: ReturnType<typeof stubFetch>;

  beforeEach(() => {
    restoreCfg = withConfig(FULL_CFG);
    fetchStub = stubFetch();
  });
  afterEach(() => {
    restoreCfg();
    fetchStub.restore();
  });

  it("sends event_action='resolve' to PagerDuty when an incident is acked", async () => {
    await paging.notifyIncidentAcked(
      fakeIncident({ severity: "P1" }),
      { id: "test.rule", runbookUrl: "https://wiki/runbook" },
      "alice",
    );
    const pd = fetchStub.calls.find((c) => c.url.includes("pagerduty"));
    assert.ok(pd, "expected a PagerDuty call");
    assert.equal(pd!.body.event_action, "resolve",
      "ack must resolve the page, not acknowledge it");
    assert.equal(pd!.body.dedup_key, "irrigopro-incident-42",
      "ack must target the same dedup_key the open page used");
    assert.equal(pd!.body.routing_key, FULL_CFG.pagerDutyRoutingKey);
  });

  it("sends event_action='trigger' with severity-mapped payload on open", async () => {
    await paging.notifyIncidentOpened(
      fakeIncident({ severity: "P1" }),
      { id: "test.rule", runbookUrl: "https://wiki/runbook" },
    );
    const pd = fetchStub.calls.find((c) => c.url.includes("pagerduty"));
    assert.ok(pd);
    assert.equal(pd!.body.event_action, "trigger");
    assert.equal(pd!.body.payload.severity, "critical", "P1 → critical");
    assert.equal(pd!.body.dedup_key, "irrigopro-incident-42");
  });

  it("sends event_action='resolve' on auto-resolve", async () => {
    await paging.notifyIncidentResolved(
      fakeIncident({ severity: "P2" }),
      { id: "test.rule", runbookUrl: "https://wiki/runbook" },
    );
    const pd = fetchStub.calls.find((c) => c.url.includes("pagerduty"));
    assert.ok(pd);
    assert.equal(pd!.body.event_action, "resolve");
  });
});

describe("paging — gating", () => {
  let fetchStub: ReturnType<typeof stubFetch>;
  beforeEach(() => { fetchStub = stubFetch(); });
  afterEach(() => { fetchStub.restore(); });

  it("does nothing when severity is not in pageSeverities", async () => {
    const restore = withConfig({ ...FULL_CFG, pageSeverities: ["P1"] });
    try {
      await paging.notifyIncidentOpened(
        fakeIncident({ severity: "P3" }),
        { id: "test.rule", runbookUrl: "https://wiki/runbook" },
      );
      assert.equal(fetchStub.calls.length, 0,
        "P3 must not page when only P1 is configured");
    } finally { restore(); }
  });

  it("skips PagerDuty when disabled even if routing key is present", async () => {
    const restore = withConfig({
      ...FULL_CFG, pagerDutyEnabled: false, slackEnabled: false,
    });
    try {
      await paging.notifyIncidentOpened(
        fakeIncident(),
        { id: "test.rule", runbookUrl: "https://wiki/runbook" },
      );
      assert.equal(fetchStub.calls.length, 0);
    } finally { restore(); }
  });

  it("skips PagerDuty when routing key is empty even if enabled", async () => {
    const restore = withConfig({
      ...FULL_CFG, pagerDutyRoutingKey: "", slackEnabled: false,
    });
    try {
      await paging.notifyIncidentOpened(
        fakeIncident(),
        { id: "test.rule", runbookUrl: "https://wiki/runbook" },
      );
      const pd = fetchStub.calls.find((c) => c.url.includes("pagerduty"));
      assert.equal(pd, undefined);
    } finally { restore(); }
  });
});

describe("paging — toPublicConfig", () => {
  it("masks the routing key and never returns the slack webhook url", () => {
    const pub = paging.toPublicConfig({
      ...FULL_CFG,
      pagerDutyRoutingKey: "abcdefghij1234",
    });
    assert.equal(pub.pagerDutyRoutingKeyMasked, "*****1234");
    assert.equal(pub.pagerDutyRoutingKeyConfigured, true);
    assert.equal(pub.slackWebhookConfigured, true);
    assert.ok(!("pagerDutyRoutingKey" in pub));
    assert.ok(!("slackWebhookUrl" in pub));
  });

  it("reports unconfigured when fields are blank", () => {
    const pub = paging.toPublicConfig({
      ...FULL_CFG,
      pagerDutyRoutingKey: "",
      slackWebhookUrl: "",
    });
    assert.equal(pub.pagerDutyRoutingKeyConfigured, false);
    assert.equal(pub.slackWebhookConfigured, false);
    assert.equal(pub.pagerDutyRoutingKeyMasked, "");
  });
});

void mock; // appease unused import lint if mock isn't used
