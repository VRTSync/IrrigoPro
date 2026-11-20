import { createHash } from "node:crypto";
import { Router, type Express, type Request, type RequestHandler } from "express";
import { PreviewOutgoingEmailResponse, SendOutgoingEmailResponse } from "@workspace/api-zod";
import { createSingleUseConfirmation } from "../lib/single-use-confirmation";
import { logger } from "../lib/logger";
import { draftInputSchema, draftRefusalSchema, INVOICE_CHANGED, OutgoingEmailError, type BuiltDraft, type OutgoingEmailHandler } from "../outgoing-email/types";

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
    draft.variant ?? "",
    Object.entries(draft.options).sort(([a], [b]) => a.localeCompare(b)),
    draft.sender.from.name, draft.sender.from.email, draft.sender.replyTo ?? null,
    draft.sender.usingCompanyAddress, draft.html, draft.text, draft.attachments, draft.attachmentStamp, draft.warnings,
  ]));
}

export function registerOutgoingEmailRoutes(app: Express, {
  requireAuthentication,
  handlers,
}: {
  requireAuthentication: RequestHandler;
  handlers: Iterable<OutgoingEmailHandler<any>>;
}) {
  const router = Router();
  for (const handler of handlers) {
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
        const variant = parsed.data.variant ?? handler.defaultVariant;
        if (variant !== undefined && !handler.variants?.some(def => def.key === variant)) {
          res.status(400).json({ message: "Unknown email template." });
          return;
        }
        const claims = [
          req.authenticatedUserId, req.authenticatedUserRole === "super_admin" ? "global" : req.authenticatedUserCompanyId,
          handler.kind, id,
        ];
        const bound = (v: string, c: string) => JSON.stringify([...claims, v, c]);
        const now = new Date();
        const supplied: unknown = req.body?.confirmationToken;
        const review = typeof supplied === "string" ? /^([\w-]{43})\.([\w-]{43})\.(\d+\.[\w-]+\.[\w-]+)$/.exec(supplied) : null;
        // Authenticate the original review first. This also detects replay if
        // a successful send has already made this document ineligible.
        if (operation !== "preview") {
          const check = confirmation.verify(review?.[3] ?? supplied, bound(review?.[1] ?? "", review?.[2] ?? ""), now, { consume: false });
          if (!check.ok) {
            res.status(check.status).json({ reason: check.reason, message: check.message });
            return;
          }
        }
        let draft: BuiltDraft;
        try {
          draft = await handler.draft(entity, { ...parsed.data, variant }, req);
        } catch (err) {
          const refusal = draftRefusalSchema.safeParse(err);
          if (refusal.success) {
            const status = operation === "send" && handler.kind === "invoice_reminder" ? 409 : 422;
            const detail = err instanceof OutgoingEmailError ? err.detail : { action: refusal.data.action };
            throw new OutgoingEmailError(status, refusal.data.message, detail);
          }
          throw err;
        }
        const version = digest(draft.versionStamp);
        const content = fingerprint(draft);
        if (operation === "preview") {
          const { token, expiresAt } = confirmation.issue(bound(version, content), now);
          const { sender, versionStamp: _, attachmentStamp: _attachmentStamp, ...visibleDraft } = draft;
          res.json(PreviewOutgoingEmailResponse.parse({
            ...visibleDraft, kind: handler.kind, id, from: sender.from,
            replyTo: sender.replyTo ?? null, usingCompanyAddress: sender.usingCompanyAddress,
            optionDefs: handler.options ?? [], variantDefs: handler.variants ?? [],
            confirmationToken: `${version}.${content}.${token}`, expiresAt,
          }));
          return;
        }

        if (operation === "send" && !draft.to) {
          res.status(422).json({ message: handler.noRecipientMessage ?? "This customer has no billing email. Enter one, or add it in QuickBooks and resync." });
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
        // The draft may await storage, so check again when consuming the review.
        const consumed = confirmation.verify(review[3], bound(version, content), new Date());
        if (!consumed.ok) {
          res.status(consumed.status).json({ reason: consumed.reason, message: consumed.message });
          return;
        }
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
