import assert from "node:assert/strict";
import { it } from "node:test";
import { displayWebsite, formatPhone, renderEmailLayout, type EmailLayoutInput } from "./layout";
import { DEFAULT_WORDING, fillWording, PLACEHOLDERS, WORDING_FIELDS, type EmailKey, type Wording } from "./wording";

const fixture: EmailLayoutInput = {
  company: {
    name: "High Plains & Co.", logo: "company-logos/test-logo", phone: "7208109673",
    email: "office@example.invalid", address: "100 Main St", website: "https://www.highplainsprop.com/",
  },
  subject: "Invoice <600>",
  docType: "Invoice",
  docNumber: "IR-1008",
  stripe: "green",
  wording: {
    eyebrow: "October 2026 · Irrigation", headline: "Your October 2026 invoice is ready",
    intro: "Your invoice is attached.", closing: "Questions? Reply to this email.",
  },
  customerName: "The Ranch",
  note: "<script>alert('note');</script>\nSecond line",
  facts: [{ label: "Invoice", value: "IR-1008" }],
  total: { label: "Amount due", value: "$3,346.48" },
  attachments: [{ title: "Billing detail report", filename: "The Ranch & Co.pdf" }],
};

it("fills letter-only placeholders as plain text without replacing the substituted values", () => {
  assert.equal(fillWording("Hello {customerName}. Welcome to {companyName}!", {
    customerName: "Ranch <North> {companyName}", companyName: "A & B",
  }), "Hello Ranch <North> {companyName}. Welcome to A & B!");
  assert.equal(fillWording("{name}? {name}! {name}. {name1}", { name: "Ranch" }), "Ranch? Ranch! Ranch. {name1}");
});

it("drops only sentences with empty values and keeps punctuation not followed by whitespace", () => {
  assert.equal(fillWording(" Questions?  Call us at {companyPhone}.\nVisit irrigopro.com! {companyEmail}", {
    companyPhone: "", companyEmail: "",
  }), "Questions? Visit irrigopro.com!");
  assert.equal(fillWording("Call {companyPhone}.", { companyPhone: "" }), "");
});

it("throws for unknown and case-mismatched placeholders even in a sentence that would be dropped", () => {
  assert.throws(() => fillWording("{companyPhone} or {CompanyPhone}.", { companyPhone: "" }), /Unknown email placeholder: CompanyPhone/);
  assert.throws(() => fillWording("{constructor}", {}), /Unknown email placeholder: constructor/);
});

it("every approved wording field uses only placeholders allowed for that email", () => {
  for (const [key, wording] of Object.entries(DEFAULT_WORDING) as [EmailKey, Wording][]) {
    const values = Object.fromEntries(PLACEHOLDERS[key].map(name => [name, name]));
    for (const field of WORDING_FIELDS) {
      assert.notEqual(wording[field], "");
      assert.doesNotMatch(fillWording(wording[field], values), /\{[^}]*\}/);
    }
  }
});

it("renders email-safe table markup and plain text with the same customer content", (t) => {
  t.mock.property(process, "env", { APP_BASE_URL: "https://example.invalid/" });
  const { html, text } = renderEmailLayout(fixture);
  assert.match(html, /^<!doctype html>\s*<html lang="en">/);
  assert.match(html, /<meta name="color-scheme" content="light">/);
  assert.match(html, /<meta name="supported-color-schemes" content="light">/);
  assert.match(html, /<title>Invoice &lt;600&gt;<\/title>/);
  assert.match(html, /width="600" bgcolor="#ffffff" style="width:100%;max-width:600px/);
  assert.match(html, /bgcolor="#82bf40".*height="5"/);
  assert.match(html, /A note from High Plains &amp; Co\./);
  assert.match(html, /&lt;script&gt;alert\(&#39;note&#39;\);&lt;\/script&gt;\nSecond line/);
  assert.doesNotMatch(html, /display:\s*(?:flex|grid)|<svg|linear-gradient|<script/i);
  assert.match(html, /src="https:\/\/example\.invalid\/api\/company-logo\/test-logo"[^>]*width="64" height="64"/);
  assert.match(html, /bgcolor="#102a43"[\s\S]*test-logo"[^>]*width="44" height="44"/);
  assert.match(html, /100 Main St · \(720\) 810-9673/);
  assert.match(html, /mailto:office@example\.invalid/);
  assert.match(html, /href="https:\/\/www\.highplainsprop\.com\/"[^>]*>highplainsprop\.com<\/a>/);
  assert.match(html, /src="https:\/\/example\.invalid\/email\/irrigopro-wordmark\.png" height="20" alt="IrrigoPro"/);
  assert.match(html, /The Ranch &amp; Co\.pdf/);
  assert.match(text, /A note from High Plains & Co\.: <script>.*<\/script>\nSecond line/);
  assert.match(text, /Invoice: IR-1008\nAmount due: \$3,346\.48/);
  assert.match(text, /Attached: The Ranch & Co\.pdf/);
  assert.match(text, /Thank you,\nHigh Plains & Co\.\n\n100 Main St · \(720\) 810-9673\n/);
});

it("omits the company logo, blank contacts and a whitespace-only note without stray separators", () => {
  const { html, text } = renderEmailLayout({
    ...fixture, company: { ...fixture.company, logo: null, phone: " ", email: null, website: null }, note: "\n ",
  });
  const header = html.slice(html.indexOf('bgcolor="#1e5c99"'), html.indexOf('bgcolor="#82bf40"'));
  assert.doesNotMatch(header, /<img/);
  assert.equal(html.match(/<img/g)?.length, 1, "only the IrrigoPro wordmark should remain");
  assert.match(html, /<strong>High Plains &amp; Co\.<\/strong><br>100 Main St\s+<\/td>/);
  assert.doesNotMatch(html, /A note from|mailto:|\(720\)/);
  assert.match(text, /\n\n100 Main St$/);
});

it("links only HTTPS facts and escapes the visible value and URL", () => {
  const { html, text } = renderEmailLayout({
    ...fixture,
    facts: [
      { label: "Pinned spot", value: "East & west", href: "https://example.invalid/map?a=1&b=2" },
      { label: "Insecure spot", value: "Plain text", href: "http://other.example.invalid" },
      { label: "Unsafe spot", value: "Also plain", href: "javascript:alert(1)" },
    ],
  });
  assert.match(html, /href="https:\/\/example\.invalid\/map\?a=1&amp;b=2" style="color:#1e5c99;font-weight:bold;">East &amp; west<\/a>/);
  assert.match(text, /Pinned spot: East & west \(https:\/\/example\.invalid\/map\?a=1&b=2\)\nInsecure spot: Plain text\nUnsafe spot: Also plain/);
  assert.doesNotMatch(html + text, /other\.example\.invalid|javascript:/);
});

it("renders optional estimate content in the shared layout with escaped action labels and URLs", () => {
  const { html, text } = renderEmailLayout({
    ...fixture, docType: "Estimate", total: undefined,
    detailHtml: '<table role="presentation"><tr><td>Controller &amp; wiring</td></tr></table>',
    detailText: "Controller & wiring",
    actions: {
      primary: { label: "Approve <estimate>", href: "https://example.invalid/review?token=a&intent=approve" },
      secondary: { label: "Decline", href: "about:blank#link-created-when-sent" },
      link: { label: "View & print", href: "https://example.invalid/view" },
    },
  });
  assert.match(html, /Controller &amp; wiring[\s\S]*Approve &lt;estimate&gt;[\s\S]*Decline[\s\S]*View &amp; print[\s\S]*Billing detail report/);
  assert.match(html, /href="https:\/\/example\.invalid\/review\?token=a&amp;intent=approve"/);
  assert.match(html, /href="about:blank#link-created-when-sent"/);
  assert.match(text, /Controller & wiring[\s\S]*Approve <estimate>: https:\/\/example\.invalid\/review\?token=a&intent=approve/);
  assert.doesNotMatch(html, /Amount due/);
});

it("formats US phone numbers and displays a website without its prefix or trailing slash", () => {
  assert.equal(formatPhone("7208109673"), "(720) 810-9673");
  assert.equal(formatPhone("+1 720 810 9673"), "(720) 810-9673");
  assert.equal(formatPhone(" 720-810-9673 x103 "), "720-810-9673 x103");
  assert.equal(formatPhone(null), "");
  assert.equal(displayWebsite("https://www.highplainsprop.com/"), "highplainsprop.com");
  assert.equal(displayWebsite("www.example.invalid/path/"), "example.invalid/path");
  assert.equal(displayWebsite(undefined), "");
});
