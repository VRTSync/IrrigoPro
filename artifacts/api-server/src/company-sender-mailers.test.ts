import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { CompanySender } from "./lib/company-sender";
import type { EstimateEmailData } from "./email-service";

const sent: any[] = [];
mock.module("./db", { namedExports: { db: {} } });
mock.module("@sendgrid/mail", { defaultExport: {
  setApiKey() {},
  async send(message: unknown) { sent.push(message); return [{ statusCode: 202 }]; },
} });
mock.module("./storage", { namedExports: { storage: {
  async getCompanyProfile() { return { name: "Company signature", email: "signature@example.com" }; },
} } });
// Test-only configuration; no real credential is read or used.
mock.property(process, "env", {
  SENDGRID_API_KEY: "test-only-key", SENDGRID_FROM_EMAIL: "platform@example.com", SENDGRID_FROM_NAME: "Platform",
});
const { EmailService } = await import("./email-service");
const { senderFromCompany } = await import("./lib/company-sender");
mock.restoreAll();

const companySender: CompanySender = {
  from: { email: "billing@company.test", name: "Company" },
  replyTo: "replies@company.test", usingCompanyAddress: true,
};
const estimate: EstimateEmailData = {
  sender: companySender, estimateId: 1, estimateNumber: "50000", customerName: "Customer",
  customerLabel: "Customer",
  customerEmail: "customer@example.com", projectName: "Test project", totalAmount: "$10.00",
  approvalToken: "test-token", estimateDate: "2026-11-18", createdBy: "Office", companyId: 1,
};
const report = {
  to: "customer@example.com", customerName: "Customer", propertyAddress: null,
  companyName: "Company signature", companyEmail: "signature@example.com", companyPhone: null,
  pdfBuffer: Buffer.from("test-pdf"),
};
describe("customer-facing mailers use the resolved identity", () => {
  it("sends both reports with the exact reviewed content and copied recipients", async () => {
    sent.length = 0;
    const reviewed = { subject: "Reviewed subject", html: "<p>Reviewed report</p>", text: "Reviewed report", filename: "Reviewed.pdf" };
    const recipients = { cc: ["cc@example.com"], bcc: ["bcc@example.com"] };
    const reviewedReport = { ...report, ...recipients, sender: companySender, reviewed };
    await EmailService.sendWetCheckReport({ ...reviewedReport, wetCheckId: 1, technicianName: null, inspectionDate: "November 18, 2026" });
    await EmailService.sendIrrigationProfileReport({ ...reviewedReport, customerId: 1 });
    assert.equal(sent.length, 2);
    for (const message of sent) {
      assert.equal(message.to, report.to);
      assert.deepEqual(message.cc, recipients.cc);
      assert.deepEqual(message.bcc, recipients.bcc);
      assert.equal(message.subject, reviewed.subject);
      assert.equal(message.html, reviewed.html);
      assert.equal(message.text, reviewed.text);
      assert.equal(message.attachments[0].filename, reviewed.filename);
      assert.equal(message.attachments[0].type, "application/pdf");
      assert.equal(message.attachments[0].content, report.pdfBuffer.toString("base64"));
    }
    assert.deepEqual(sent.map(message => message.categories), [["wet-check-report"], ["irrigation-profile-report"]]);
  });

  for (const [label, sender] of [
    ["authenticated", companySender],
    ["platform fallback", senderFromCompany({
      name: "Company", email: "office@company.test", emailSendingDomain: null,
      emailDomainVerifiedAt: null, emailFromName: "Company", emailFromAddress: null,
      emailReplyTo: "replies@company.test",
    })],
    ["no Reply-To", { ...companySender, replyTo: undefined }],
  ] as const) {
    it(`uses ${label} in all six customer email paths without changing signatures or attachments`, async () => {
      sent.length = 0;
      await EmailService.sendEstimateApprovalEmail({ ...estimate, sender });
      await EmailService.sendApprovalConfirmation("customer@example.com", "50000", true, sender);
      await EmailService.sendApprovalConfirmation("customer@example.com", "50000", false, sender);
      assert.equal((await EmailService.sendInvoiceDetailPdf("customer@example.com", "Customer", "IR-1008", Buffer.from("test-pdf"), {
        sender, subject: "Reviewed invoice", html: "<p>Reviewed body</p>", text: "Reviewed body",
        cc: ["cc@example.com"], bcc: ["bcc@example.com"], filename: "Reviewed invoice.pdf",
      })).success, true);
      await EmailService.sendWetCheckReport({ ...report, sender, wetCheckId: 1, technicianName: null, inspectionDate: "November 18, 2026" });
      await EmailService.sendIrrigationProfileReport({ ...report, sender, customerId: 1 });
      assert.equal(sent.length, 6);
      for (const message of sent) {
        assert.deepEqual(message.from, sender.from);
        if (sender.replyTo) assert.equal(message.replyTo, sender.replyTo);
        else assert.equal(Object.hasOwn(message, "replyTo"), false);
      }
      for (const index of [3, 4, 5]) assert.equal(sent[index].attachments[0].content, Buffer.from("test-pdf").toString("base64"));
      assert.equal(sent[3].subject, "Reviewed invoice");
      assert.equal(sent[3].html, "<p>Reviewed body</p>");
      assert.equal(sent[3].text, "Reviewed body");
      assert.deepEqual(sent[3].cc, ["cc@example.com"]);
      assert.deepEqual(sent[3].bcc, ["bcc@example.com"]);
      assert.equal(sent[3].attachments[0].filename, "Reviewed invoice.pdf");
      assert.match(sent[0].html, /Company signature/);
      assert.match(sent[4].text, /signature@example.com/);
    });
  }
});
