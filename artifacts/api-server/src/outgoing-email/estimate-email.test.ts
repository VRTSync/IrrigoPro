import assert from "node:assert/strict";
import { it, mock } from "node:test";
import type { Company, Customer, Estimate } from "@workspace/db";
import type { EstimateEmailData } from "../email-service";
import { DEFAULT_WORDING, fillWording } from "./wording";

const company = {
  id: 7, name: "Evergreen Irrigation", logo: "/api/company-logo/test-logo",
  email: "office@example.invalid", phone: "3035550100", website: "example.invalid", address: "1 Field Lane",
  emailFromAddress: "estimates@example.invalid", emailReplyTo: "reply@example.invalid",
  emailSendingDomain: "example.invalid", emailDomainVerifiedAt: new Date("2026-11-01"),
} as Company;
const customers = new Map<number, Customer>([
  [1, { id: 1, companyId: company.id, irrigoName: "The Orchard", name: "Orchard LLC" } as Customer],
  [2, { id: 2, companyId: 999, irrigoName: "Foreign Tenant Label", name: "Foreign Tenant Name" } as Customer],
]);
type Message = {
  to: string; from: { email: string; name: string }; replyTo?: string;
  subject: string; html: string; text: string; categories: string[];
};
const messages: Message[] = [];
const companyLookups: number[] = [];
mock.module("../db", { namedExports: { db: {} } });
mock.module("../storage", { namedExports: { storage: {
  async getCompanyProfile(id: number) {
    companyLookups.push(id);
    return id === company.id ? company : undefined;
  },
  async getCustomer(id: number) { return customers.get(id); },
} } });
mock.module("@sendgrid/mail", { defaultExport: {
  setApiKey() {},
  async send(message: Message) { messages.push(message); },
} });
mock.property(process, "env", { SENDGRID_API_KEY: "test-only-key", APP_BASE_URL: "https://irrigation.example.invalid" });
const { EmailService } = await import("../email-service");
const { buildEstimateApprovalEmail, ESTIMATE_PREVIEW_LINK } = await import("./estimate-email");
const { buildEmailZoneGroups } = await import("./estimate-detail");
mock.restoreAll();

const line = {
  description: "Replace & tune <main valve>", partName: "Valve", quantity: 2,
  partPrice: 500, laborHours: 2.25, partsCost: 1000, laborCost: 234.56, lineTotal: 1234.56,
};
const base: EstimateEmailData = {
  sender: { from: { name: company.name, email: "estimates@example.invalid" }, usingCompanyAddress: true, replyTo: "reply@example.invalid" },
  estimateId: 17, estimateNumber: "EST-50123", customerName: "Estimate customer", customerLabel: "The Orchard",
  customerEmail: "customer@example.invalid", projectName: "West Garden", companyId: company.id, companyProfile: company,
  approvalToken: "unused-preview-token", estimateDate: "11/20/2026", totalAmount: "$1,234.56",
  partsSubtotal: 1000, laborSubtotal: 234.56, totalLaborHours: 2.25, items: [line],
};
const liveUrl = "https://irrigation.example.invalid/estimate-approval/example";
const links = { approveUrl: liveUrl, rejectUrl: `${liveUrl}?intent=reject`, viewUrl: liveUrl };

it("renders the flat estimate, escapes free text, and omits staff names", async () => {
  const data = {
    ...base, createdBy: "Internal Staff Name", workDescription: "Check <north beds>\nConfirm layout.",
    note: "Office note <as typed>", items: [line, { ...line, description: "", partName: "Backup nozzle" }],
  };
  const { html, text, subject } = await buildEstimateApprovalEmail(data, links);
  assert.equal(subject, "Irrigation Estimate #50123 – The Orchard");
  for (const pattern of [/bgcolor="#82bf40"/, /Approval needed/, /Approve estimate/, />Decline</,
    /Estimate total/, /Check &lt;north beds&gt;\nConfirm layout/, /A note from Evergreen Irrigation/,
    /Office note &lt;as typed&gt;/, /Replace &amp; tune &lt;main valve&gt;/, /Backup nozzle/, /\$1,234\.56/]) {
    assert.match(html, pattern);
  }
  assert.match(text, /- Replace & tune <main valve> × 2  \$1,234\.56/);
  assert.match(text, /Parts: \$1,000\.00\nLabor · 2\.25 h: \$234\.56/);
  assert.match(text, /View the full estimate online: https:\/\/irrigation\.example\.invalid\/estimate-approval\/example/);
  assert.doesNotMatch(html + text, /Internal Staff Name|Prepared by|<button/);
  assert.doesNotMatch(html, /about:blank|links are created when sent/);
});

it("uses the existing inspection group order, including the unzoned label", async () => {
  const items = [
    { ...line, controllerLetter: "B", zoneNumber: 2, description: "Lateral line" },
    { ...line, controllerLetter: "A", zoneNumber: 4, description: "Rotor head" },
    { ...line, description: "Unzoned work" },
    { ...line, controllerLetter: "A", zoneNumber: 1, description: "Spray nozzle" },
    { ...line, controllerLetter: "A", zoneNumber: 4, description: "Drip hose" },
  ];
  const { html, text } = await buildEstimateApprovalEmail({ ...base, isInspectionOrigin: true, items }, links);
  const groups = buildEmailZoneGroups(items, 0);
  assert.deepEqual(groups.map(group => group.zoneLabel), [
    "Zone 0", "Controller A · Zone 1", "Controller A · Zone 4", "Controller B · Zone 2",
  ]);
  let previous = html.indexOf("Work included");
  for (const group of groups) {
    assert.match(html, new RegExp(`<tr bgcolor="#f5f8fb"><th[^>]*>${group.zoneLabel}<\\/th>`));
    for (const part of [group.zoneLabel, ...group.items.map(item => item.description)]) {
      const at = html.indexOf(part, previous + 1);
      assert.ok(at > previous, `${part} should appear in its group's order`);
      previous = at;
    }
  }
  assert.match(text, /Controller A · Zone 4\n- Rotor head [^\n]*\n- Drip hose/);
});

it("uses three harmless preview links with a notice before the full-estimate link", async () => {
  const { html, text } = await buildEstimateApprovalEmail(base, {
    approveUrl: ESTIMATE_PREVIEW_LINK, rejectUrl: ESTIMATE_PREVIEW_LINK, viewUrl: ESTIMATE_PREVIEW_LINK,
  });
  assert.equal(html.split(ESTIMATE_PREVIEW_LINK).length - 1, 3);
  assert.match(html, /Approve estimate[\s\S]*?>Decline<[\s\S]*?\(links are created when sent\)[\s\S]*?View the full estimate online/);
  assert.doesNotMatch(html + text, /\/estimate-approval\/|unused-preview-token/);
});

it("shows the estimate PDF in both versions only when a filename is supplied", async () => {
  const filename = "Estimate-EST-50123.pdf";
  const attached = await buildEstimateApprovalEmail({ ...base, attachmentFilename: filename }, links);
  const none = await buildEstimateApprovalEmail(base, links);
  assert.match(attached.html, /<strong[^>]*>Estimate<\/strong><br><span[^>]*>Estimate-EST-50123\.pdf/);
  assert.ok(attached.text.includes(`Attached: ${filename}`));
  assert.ok(!(none.html + none.text).includes(filename));
});

it("links the pinned spot only when both coordinates exist and keeps facts in order", async () => {
  const data = {
    ...base, projectAddress: "2 Field Lane", workLocationAddress: "North gate",
    workLocationLat: "39.75", workLocationLng: "-104.99", branchName: "North",
    controllerLetter: "A", zoneNumber: 4,
  };
  const { html, text } = await buildEstimateApprovalEmail(data, links);
  assert.match(html, /href="https:\/\/www\.google\.com\/maps\/search\/\?api=1&amp;query=39\.75,-104\.99"[^>]*>North gate/);
  assert.match(text, /Project: West Garden\nLocation: 2 Field Lane\nPinned spot: North gate \(https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=39\.75,-104\.99\)\nBranch: North\nController \/ zone: Controller A · Zone 4\nEstimate date: 11\/20\/2026/);
  const noAddress = await buildEstimateApprovalEmail({ ...data, workLocationAddress: null }, links);
  assert.match(noAddress.html, />View on map<\/a>/);
  for (const missing of [{ workLocationLat: null }, { workLocationLng: "" }]) {
    const incomplete = await buildEstimateApprovalEmail({ ...data, ...missing }, links);
    assert.doesNotMatch(incomplete.html + incomplete.text, /maps\.google|google\.com\/maps|Pinned spot/);
  }
});

const estimate = {
  id: base.estimateId, estimateNumber: base.estimateNumber, customerName: base.customerName,
  projectName: base.projectName, customerId: 1, companyId: company.id, totalAmount: "1234.56",
} as Estimate;
const decision = { to: base.customerEmail, estimate, decidedAt: new Date("2026-11-21T04:00:00Z") };

it("sends approved and declined confirmations with catalog subjects, Denver dates, and company identity", async () => {
  for (const approved of [true, false]) {
    await EmailService.sendApprovalConfirmation({ ...decision, approved });
    const message = messages.at(-1)!;
    const wording = DEFAULT_WORDING[approved ? "estimate_approved" : "estimate_declined"];
    assert.equal(message.subject, fillWording(wording.subject, { estimateNumber: "50123", customerName: "The Orchard" }));
    assert.equal(message.to, decision.to);
    assert.deepEqual(message.from, base.sender.from);
    assert.equal(message.replyTo, base.sender.replyTo);
    assert.deepEqual(message.categories, ["estimate-confirmation"]);
    assert.match(message.html, new RegExp(`bgcolor="${approved ? "#82bf40" : "#9fb3c8"}"><td height="5"`));
    assert.match(message.html, /Hello The Orchard,/);
    assert.match(message.text, new RegExp(`Estimate: #50123\\nProject: West Garden\\n${approved ? "Approved" : "Declined"} on: Nov 20, 2026`));
    if (approved) {
      assert.match(message.html, /<tr bgcolor="#1e5c99">[\s\S]*?Approved total[\s\S]*?\$1,234\.56/);
    } else {
      assert.doesNotMatch(message.html + message.text, /Approved total|\$1,234\.56/);
    }
    assert.doesNotMatch(message.html + message.text, /A note from|Attached:|Approve estimate|View the full estimate online|Your Irrigation Team/);
  }
});

it("uses only the estimate tenant's company and falls back to the estimate customer when the linked row is foreign", async () => {
  await EmailService.sendApprovalConfirmation({ ...decision, estimate: { ...estimate, customerId: 2 }, approved: true });
  const { subject, html, text, to } = messages.at(-1)!;
  assert.equal(companyLookups.at(-1), estimate.companyId);
  assert.equal(to, decision.to);
  assert.equal(subject, "Estimate #50123 approved – Estimate customer");
  assert.match(html, /Hello Estimate customer,/);
  assert.match(text, /Hello Estimate customer,/);
  assert.doesNotMatch(subject + html + text, /Foreign Tenant/);
});
