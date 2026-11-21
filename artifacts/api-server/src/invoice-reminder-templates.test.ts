import assert from "node:assert/strict";
import { it } from "node:test";
import type { Company } from "@workspace/db";
import { pastDueText, REMINDER_EMAIL_KEY, renderReminderEmail, type ReminderTemplateInput } from "./invoice-reminder-templates";
import { defaultEmailWording } from "./outgoing-email/wording";

const input = {
  company: { name: "Green Valley Irrigation", phone: "9705550100" } as Company,
  customerName: "The Ranch",
  invoiceNumber: "INV-123",
  billingMonth: "October 2026",
  billingPeriodRange: "Oct 1 – Oct 31, 2026",
  effectiveDueDate: new Date("2026-11-12"),
  daysOverdue: 12,
  balanceDue: 1200.5,
  note: "Please review <this> & call.\nThank you.",
  attachmentFilename: "Saved copy (Oct & Nov).pdf",
} satisfies Omit<ReminderTemplateInput, "templateKey" | "wording">;

for (const [templateKey, stripe, subjectPrefix] of [
  ["friendly", "#82bf40", "Reminder:"],
  ["firm", "#f0b429", "Past due:"],
  ["final_notice", "#d64545", "Final notice:"],
] as const) {
  it(`${templateKey} uses the catalog, shared facts and saved invoice filename`, () => {
    const wording = defaultEmailWording(REMINDER_EMAIL_KEY[templateKey]);
    const { subject, html, text } = renderReminderEmail({ ...input, templateKey, wording });
    assert.equal(subject, `${subjectPrefix} Invoice INV-123 – The Ranch – October 2026`);
    assert.ok(html.includes(`<tr bgcolor="${stripe}"><td height="5"`));
    assert.match(html, /bgcolor="#1e5c99">\s*<th[^>]*>Balance due<\/th>/);
    assert.match(html, /bgcolor="#f1f7e8"[\s\S]*?A note from Green Valley Irrigation[\s\S]*?Please review &lt;this&gt; &amp; call\.\nThank you\.[\s\S]*?<\/table>/);
    assert.match(html, /Copy of invoice INV-123<\/strong><br><span[^>]*>Saved copy \(Oct &amp; Nov\)\.pdf/);
    assert.match(text, /Invoice: INV-123\nBilling period: Oct 1 – Oct 31, 2026\nDue date: Nov 12, 2026\nStatus: 12 days past due\nBalance due: \$1,200\.50/);
    assert.match(text, /Attached: Saved copy \(Oct & Nov\)\.pdf/);
    assert.doesNotMatch(`${html}\n${text}`, /invoice below|display:\s*flex|<svg|\p{Extended_Pictographic}/iu);
    if (templateKey === "final_notice") {
      assert.match(text, /This is our final notice before we take further steps to collect this balance\./);
    }
  });
}

it("formats today, future and past due dates in plain language", () => {
  assert.equal(pastDueText(0), "due today");
  assert.equal(pastDueText(1), "1 day past due");
  assert.equal(pastDueText(12), "12 days past due");
  assert.equal(pastDueText(-1), "due in 1 day");
  assert.equal(pastDueText(-3), "due in 3 days");
});
