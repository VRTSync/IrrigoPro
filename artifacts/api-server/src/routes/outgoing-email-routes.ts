import { createHash } from "node:crypto";
import { Router, type Express, type Request, type RequestHandler } from "express";
import { PreviewOutgoingEmailResponse, SendOutgoingEmailResponse } from "@workspace/api-zod";
import { createSingleUseConfirmation } from "../lib/single-use-confirmation";
import { logger } from "../lib/logger";
import { createOutgoingEmailHandlers } from "../outgoing-email/registry";
import { draftInputSchema, INVOICE_CHANGED, OutgoingEmailError, type BuiltDraft, type OutgoingEmailHandler } from "../outgoing-email/types";

const messages = {
  required: "Review the email before sending. Nothing was sent.",
  mismatch: "This email changed after you reviewed it. Review it again before sending. Nothing was sent.",
  expired: "The review expired. Review the email again before sending. Nothing was sent.",
  used: "This email was already sent from this review.",
};
const confirmation = createSingleUseConfirmation({ scope: "outgoing-email", ttlMs: 15 * 60 * 1000, messages });
const digest = (value: string) => createHash("sha256").update(value).digest("base64url");
const recipients = (values: string[]) => values.map(value => value.toLowerCase()).sort();

function fingerprint(draft: BuiltDraft) {
  return digest(JSON.stringify([
    draft.to, recipients(draft.cc), recipients(draft.bcc), draft.subject, digest(draft.note),
    Object.entries(draft.options).sort(([a], [b]) => a.localeCompare(b)),
    draft.sender.from.name, draft.sender.from.email, draft.sender.replyTo ?? null,
    draft.sender.usingCompanyAddress, draft.html, draft.text, draft.attachments, draft.warnings,
  ]));
}

export function registerOutgoingEmailRoutes(app: Express, {
  requireAuthentication,
  handlers,
  recordLifecycleAudit,
}: {
  requireAuthentication: RequestHandler;
  handlers?: Iterable<OutgoingEmailHandler<any>>;
  recordLifecycleAudit?: Parameters<typeof createOutgoingEmailHandlers>[0];
}) {
  const router = Router();
  for (const handler of handlers ?? createOutgoingEmailHandlers(recordLifecycleAudit)) {
    const action = (operation: "preview" | "send" | "attachment"): RequestHandler<{ id: string }> => async (req, res) => {
      res.set("Cache-Control", "no-store");
      const id = Number(req.params.id);
      if (!/^[1-9]\d*$/.test(req.params.id) || !Number.isSafeInteger(id)) {
        res.status(404).json({ message: "Document not found." });
        return;
      }
      try {
        const entity = await handler.load(req, id);
        if (!entity) {
          res.status(404).json({ message: "Document not found." });
          return;
        }
        const parsed = draftInputSchema.safeParse(req.body === undefined ? {} : req.body);
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          res.status(400).json({ message: `${issue.path.join(".") || "Draft"}: ${issue.message}` });
          return;
        }
        const draft = await handler.draft(entity, parsed.data);
        const claims = [
          req.authenticatedUserId, req.authenticatedUserRole === "super_admin" ? "global" : req.authenticatedUserCompanyId,
          handler.kind, id,
        ];
        const version = digest(draft.versionStamp);
        const content = fingerprint(draft);
        const bound = (v: string, c: string) => JSON.stringify([...claims, v, c]);
        const now = new Date();
        if (operation === "preview") {
          const { token, expiresAt } = confirmation.issue(bound(version, content), now);
          const { sender, versionStamp: _, ...visibleDraft } = draft;
          res.json(PreviewOutgoingEmailResponse.parse({
            ...visibleDraft, kind: handler.kind, id, from: sender.from,
            replyTo: sender.replyTo ?? null, usingCompanyAddress: sender.usingCompanyAddress,
            optionDefs: handler.options ?? [], confirmationToken: `${version}.${content}.${token}`, expiresAt,
          }));
          return;
        }

        if (operation === "send" && !draft.to) {
          res.status(422).json({ message: handler.noRecipientMessage ?? "This customer has no billing email. Enter one, or add it in QuickBooks and resync." });
          return;
        }
        const supplied: unknown = req.body?.confirmationToken;
        const review = typeof supplied === "string" ? /^([\w-]{43})\.([\w-]{43})\.(\d+\.[\w-]+\.[\w-]+)$/.exec(supplied) : null;
        // Authenticate the original snapshot first, so we can distinguish an
        // invoice edit from a field edit and detect replay after state changes.
        const check = confirmation.verify(review?.[3] ?? supplied, bound(review?.[1] ?? version, review?.[2] ?? content), now, { consume: false });
        if (!check.ok) {
          res.status(check.status).json({ reason: check.reason, message: check.message });
          return;
        }
        if (!review || review[1] !== version || (operation === "send" && review[2] !== content)) {
          res.status(409).json({
            reason: "confirmation_mismatch",
            message: review && review[1] !== version && handler.kind === "invoice" ? INVOICE_CHANGED : messages.mismatch,
          });
          return;
        }
        if (operation === "attachment" && handler.renderAttachment) {
          // View only needs the signed attachment version, not the editable
          // message fields. A review with no attachment has a different version.
          const file = await handler.renderAttachment(entity);
          res.attachment(file.filename).type("application/pdf").send(file.buffer);
          return;
        }
        // No await between the check and consumption: concurrent requests in
        // the same process cannot share a review.
        confirmation.verify(review[3], bound(version, content), now);
        res.json(SendOutgoingEmailResponse.parse(await handler.send(entity, draft, req as Request)));
      } catch (err) {
        if (err instanceof OutgoingEmailError) {
          res.status(err.status).json({ message: err.message, ...err.detail });
          return;
        }
        (req.log ?? logger).error({ err, kind: handler.kind, id }, "Outgoing email request failed");
        res.status(500).json({
          message: operation === "send"
            ? "Could not finish sending the email. Check delivery history before trying again."
            : operation === "attachment" ? "Could not preview the attachment." : "Could not preview the email.",
        });
      }
    };
    router.post(`/${handler.kind}/:id/preview`, ...handler.capabilities, action("preview"));
    router.post(`/${handler.kind}/:id/send`, ...handler.capabilities, action("send"));
    if (handler.renderAttachment) {
      router.post(`/${handler.kind}/:id/attachment`, ...handler.capabilities, action("attachment"));
    }
  }
  router.use((_req, res) => { res.status(404).json({ message: "Email kind not found." }); });
  app.use("/api/outgoing-email", requireAuthentication, router);
}
