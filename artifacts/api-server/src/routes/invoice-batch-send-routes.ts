import type { Express, Request, RequestHandler, Response } from "express";
import { GetActiveInvoiceBatchResponse, GetInvoiceBatchResponse, PreviewInvoiceBatchBody, PreviewInvoiceBatchResponse } from "@workspace/api-zod";
import { resolveBalanceDue } from "@workspace/shared";
import { senderFromCompany } from "../lib/company-sender";
import { logger } from "../lib/logger";
import { getCurrentInvoiceGuide } from "../lib/platform-documents";
import { createSingleUseConfirmation } from "../lib/single-use-confirmation";
import { classifyForBatch, emailReviewDigest, reviewedInvoiceDraft } from "../outgoing-email/invoice-batch";
import { invoiceBatchStore, summarizeBatch, type BatchLease } from "../outgoing-email/invoice-batch-store";
import { createInvoiceEmailHandler, InvoiceDeliveryError, sendInvoiceEmail } from "../outgoing-email/invoice-handler";
import { OutgoingEmailError } from "../outgoing-email/types";

const ROOT = "/api/outgoing-email";
const CHANGED = "The invoices changed after you reviewed them. Review again. Nothing was sent.";
const RUNNING = "Another batch is still sending for this company.";
const NOT_FOUND = "Invoice batch not found.";
const USED = "This batch was already confirmed. Review again before starting another.";
const confirmation = createSingleUseConfirmation({
  scope: "invoice-batch-send", ttlMs: 15 * 60 * 1000,
  messages: {
    required: "Review the invoices before sending. Nothing was sent.",
    mismatch: CHANGED,
    expired: "The review expired. Review the invoices again. Nothing was sent.",
    used: USED,
  },
});

const defaultDelivery = { draft: createInvoiceEmailHandler().draft, send: sendInvoiceEmail };
type Delivery = typeof defaultDelivery & { getCurrentInvoiceGuide?: typeof getCurrentInvoiceGuide };

function positiveId(raw: unknown): number | null {
  if (typeof raw !== "number" && (typeof raw !== "string" || !/^[1-9]\d*$/.test(raw))) return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 && id <= 2147483647 ? id : null;
}

function companyScope(req: Request): number {
  if (req.authenticatedUserRole === "super_admin") {
    const companyId = positiveId(req.body?.companyId ?? req.query.companyId);
    if (companyId == null) throw new OutgoingEmailError(400, "Choose a company to work with invoice batches.");
    return companyId;
  }
  const companyId = req.authenticatedUserCompanyId;
  if (companyId == null) throw new OutgoingEmailError(404, NOT_FOUND);
  return companyId;
}

function selection(req: Request) {
  if (Array.isArray(req.body?.invoiceIds) && req.body.invoiceIds.length > 200) {
    throw new OutgoingEmailError(400, "Send at most 200 invoices at a time.");
  }
  const parsed = PreviewInvoiceBatchBody.safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new OutgoingEmailError(400, issue.path[0] === "note"
      ? "Enter a note of at most 1,000 characters."
      : "Select between 1 and 200 valid invoices.");
  }
  const { invoiceIds, note = "" } = parsed.data;
  if (invoiceIds.some((id) => !Number.isInteger(id)) || new Set(invoiceIds).size !== invoiceIds.length) {
    throw new OutgoingEmailError(400, "Select unique, valid invoice IDs.");
  }
  return { invoiceIds, note };
}

async function previewBatch(companyId: number, invoiceIds: number[], note: string, delivery: Delivery) {
  const [company, selected] = await Promise.all([
    invoiceBatchStore.company(companyId), invoiceBatchStore.selected(companyId, invoiceIds),
  ]);
  if (!company) throw new OutgoingEmailError(404, "Company not found.");
  const guide = company.attachInvoiceGuide
    ? await (delivery.getCurrentInvoiceGuide ?? getCurrentInvoiceGuide)()
    : undefined;
  const byId = new Map(selected.map((row) => [row.invoice.id, row]));
  const notFound: number[] = [];
  const willSend = [];
  const willSkip = [];
  // Limit concurrent document-version reads. Preview never starts Chromium.
  for (let i = 0; i < invoiceIds.length; i += 6) {
    const rows = await Promise.all(invoiceIds.slice(i, i + 6).map(async (invoiceId) => {
      const row = byId.get(invoiceId);
      if (!row) return { invoiceId, found: false } as const;
      const { invoice, customer, latest } = row;
      const label = { invoiceId, invoiceNumber: invoice.invoiceNumber, customerLabel: customer.irrigoName ?? customer.name };
      const verdict = classifyForBatch(invoice, customer, latest ?? undefined);
      if (!verdict.send) {
        return { found: true, send: false, value: { ...label, reason: verdict.reason, message: verdict.message } } as const;
      }
      const draft = await delivery.draft({ invoice, customer, company, guideSnapshot: guide ?? null }, { note });
      return {
        found: true, send: true, value: {
          ...label, to: verdict.to, subject: draft.subject, amountDue: resolveBalanceDue(invoice),
          versionStamp: draft.versionStamp, reviewedDraft: reviewedInvoiceDraft(draft),
        },
      } as const;
    }));
    for (const row of rows) {
      if (!row.found) notFound.push(row.invoiceId);
      else if (row.send) willSend.push(row.value);
      else willSkip.push(row.value);
    }
  }
  const { from, replyTo } = senderFromCompany(company);
  return { from, replyTo: replyTo ?? null, guide: guide ? { filename: guide.filename } : null, willSend, willSkip, notFound };
}

function fingerprint(userId: number, companyId: number, note: string, preview: Awaited<ReturnType<typeof previewBatch>>) {
  const sorted = [...preview.willSend].sort((a, b) => a.invoiceId - b.invoiceId);
  return JSON.stringify([
    userId, companyId, emailReviewDigest(note),
    sorted.map((row) => [row.invoiceId, row.to, row.subject, row.versionStamp]),
    sorted.map((row) => row.reviewedDraft),
  ]);
}

export async function recoverInterruptedEmailBatches(): Promise<void> {
  for (const { companyId } of await invoiceBatchStore.companiesWithRunningBatches()) {
    await invoiceBatchStore.recover(companyId);
  }
}

export async function runInvoiceBatch(batchId: number, companyId: number, lease: BatchLease, delivery = defaultDelivery) {
  try {
    const batch = await invoiceBatchStore.find(companyId, batchId);
    if (batch?.status !== "running") return;
    for (const item of await invoiceBatchStore.queued(batch)) {
      lease.assertHeld();
      if (!await invoiceBatchStore.markItem(item, "queued", { status: "sending" })) continue;
      let result: Parameters<typeof invoiceBatchStore.markItem>[2];
      try {
        const [[row], company] = await Promise.all([
          invoiceBatchStore.selected(companyId, [item.invoiceId]), invoiceBatchStore.company(companyId),
        ]);
        if (!row || !company) {
          result = { status: "skipped", message: "Invoice is no longer available." };
        } else {
          const { invoice, customer, latest } = row;
          const verdict = classifyForBatch(invoice, customer, latest ?? undefined);
          if (!verdict.send) {
            result = { status: "skipped", message: verdict.message };
          } else {
            const draft = await delivery.draft({ invoice, customer, company }, { note: batch.note });
            if (item.reviewedDraft !== reviewedInvoiceDraft(draft)) {
              result = { status: "failed", message: "The invoice email changed after review. Review and send it again." };
            } else {
              lease.assertHeld();
              const { sentAt } = await delivery.send(invoice, customer, draft, batch.createdByUserId);
              result = { status: "sent", sentAt };
            }
          }
        }
      } catch (error) {
        result = {
          status: "failed",
          message: error instanceof InvoiceDeliveryError ? error.providerMessage
            : error instanceof Error ? error.message : String(error),
        };
      }
      lease.assertHeld();
      await invoiceBatchStore.markItem(item, "sending", result);
    }
    lease.assertHeld();
    await invoiceBatchStore.setBatchStatus(batch, "completed");
  } finally {
    await lease.release();
  }
}

export function registerInvoiceBatchSendRoutes(app: Express, {
  requireAuthentication, requireInvoiceSend, delivery = defaultDelivery,
  schedule = (run: () => Promise<void>) => { setImmediate(() => { void run(); }); },
}: {
  requireAuthentication: RequestHandler; requireInvoiceSend: RequestHandler;
  delivery?: Delivery; schedule?: (run: () => Promise<void>) => void;
}) {
  const guards = [requireAuthentication, requireInvoiceSend];
  const route = (handler: (req: Request, res: Response) => Promise<void>): RequestHandler =>
    async (req, res) => {
      res.set("Cache-Control", "no-store");
      try {
        await handler(req, res);
      } catch (err) {
        if (err instanceof OutgoingEmailError) {
          res.status(err.status).json({ message: err.message, ...err.detail });
        } else {
          (req.log ?? logger).error({ err }, "Invoice batch request failed");
          res.status(500).json({ message: "Could not complete the invoice batch request. Check batch progress before trying again." });
        }
      }
    };
  const launch = (batchId: number, companyId: number, lease: BatchLease) => schedule(async () => {
    try {
      await runInvoiceBatch(batchId, companyId, lease, delivery);
    } catch (err) {
      logger.error({ err, batchId, companyId }, "Invoice batch worker interrupted");
    }
  });
  const find = async (req: Request, companyId: number) => {
    const id = positiveId(req.params.id);
    const batch = id == null ? undefined : await invoiceBatchStore.find(companyId, id);
    if (!batch) throw new OutgoingEmailError(404, NOT_FOUND);
    return batch;
  };
  const actor = (req: Request) => {
    if (req.authenticatedUserId == null) throw new OutgoingEmailError(401, "Sign in to send invoices.");
    return req.authenticatedUserId;
  };

  app.post(`${ROOT}/invoice/batch/preview`, ...guards, route(async (req, res) => {
    const { invoiceIds, note } = selection(req);
    const companyId = companyScope(req);
    const preview = await previewBatch(companyId, invoiceIds, note, delivery);
    const { token, expiresAt } = confirmation.issue(fingerprint(actor(req), companyId, note, preview), new Date());
    res.json(PreviewInvoiceBatchResponse.parse({ ...preview, confirmationToken: token, expiresAt }));
  }));

  app.post(`${ROOT}/invoice/batch`, ...guards, route(async (req, res) => {
    const { invoiceIds, note } = selection(req);
    const companyId = companyScope(req);
    const userId = actor(req);
    const preview = await previewBatch(companyId, invoiceIds, note, delivery);
    const claims = fingerprint(userId, companyId, note, preview);
    const token: unknown = req.body?.confirmationToken;
    const check = confirmation.verify(token, claims, new Date(), { consume: false });
    if (!check.ok) throw new OutgoingEmailError(check.status, check.message, { reason: check.reason });
    if (!preview.willSend.length) throw new OutgoingEmailError(422, "None of the selected invoices can be emailed.");
    const lease = await invoiceBatchStore.tryLease(companyId);
    if (!lease) throw new OutgoingEmailError(409, RUNNING);
    let handedOff = false;
    try {
      if (await invoiceBatchStore.running(companyId)) throw new OutgoingEmailError(409, RUNNING);
      const confirmationDigest = emailReviewDigest(String(token));
      if (await invoiceBatchStore.wasConfirmed(companyId, confirmationDigest)) {
        throw new OutgoingEmailError(409, USED, { reason: "confirmation_used" });
      }
      const confirmed = confirmation.verify(token, claims, new Date());
      if (!confirmed.ok) throw new OutgoingEmailError(confirmed.status, confirmed.message, { reason: confirmed.reason });
      const positions = new Map(invoiceIds.map((id, i) => [id, i]));
      const batch = await invoiceBatchStore.create(companyId, userId, note, confirmationDigest, [
        ...preview.willSend.map((row) => ({
          invoiceId: row.invoiceId, position: positions.get(row.invoiceId)!, status: "queued" as const,
          toEmail: row.to, subject: row.subject, reviewedDraft: row.reviewedDraft,
        })),
        ...preview.willSkip.map((row) => ({
          invoiceId: row.invoiceId, position: positions.get(row.invoiceId)!, status: "skipped" as const, message: row.message,
        })),
      ]);
      res.status(202).json({ batchId: batch.id });
      launch(batch.id, companyId, lease);
      handedOff = true;
    } finally {
      if (!handedOff) await lease.release();
    }
  }));

  app.get(`${ROOT}/batches/active`, ...guards, route(async (req, res) => {
    const companyId = companyScope(req);
    let batch = await invoiceBatchStore.active(companyId);
    if (batch?.status === "running") {
      // Covers rolling restarts: a prior process may still have been alive
      // during this process's initial recovery pass.
      await invoiceBatchStore.recover(companyId);
      batch = await invoiceBatchStore.active(companyId);
    }
    res.json(GetActiveInvoiceBatchResponse.parse(batch ? await invoiceBatchStore.progress(batch) : null));
  }));

  app.get(`${ROOT}/batches/:id`, ...guards, route(async (req, res) => {
    const companyId = companyScope(req);
    let batch = await find(req, companyId);
    if (batch.status === "running") {
      await invoiceBatchStore.recover(companyId);
      batch = await find(req, companyId);
    }
    res.json(GetInvoiceBatchResponse.parse(await invoiceBatchStore.progress(batch)));
  }));

  app.post(`${ROOT}/batches/:id/resume`, ...guards, route(async (req, res) => {
    const companyId = companyScope(req);
    const batch = await find(req, companyId);
    const notInterrupted = new OutgoingEmailError(409, "Only an interrupted batch can be resumed.");
    if (batch.status !== "interrupted") throw notInterrupted;
    const lease = await invoiceBatchStore.tryLease(companyId);
    if (!lease) throw new OutgoingEmailError(409, RUNNING);
    let handedOff = false;
    try {
      if (await invoiceBatchStore.running(companyId)) throw new OutgoingEmailError(409, RUNNING);
      if (!await invoiceBatchStore.setBatchStatus(batch, "running")) throw notInterrupted;
      res.status(202).json({ batchId: batch.id });
      launch(batch.id, companyId, lease);
      handedOff = true;
    } finally {
      if (!handedOff) await lease.release();
    }
  }));
}
