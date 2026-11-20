import type { Request, RequestHandler } from "express";
import { z } from "zod/v4";
import type { CompanySender } from "../lib/company-sender";

export type OutgoingEmailKind = "invoice";
export interface DraftInput {
  to?: string;
  cc?: string[];
  bcc?: string[];
  subject?: string;
  note?: string;
  options?: Record<string, boolean>;
}
export interface DraftAttachment { filename: string; viewUrl: string }
export interface BuiltDraft {
  sender: CompanySender;
  to: string;
  cc: string[];
  bcc: string[];
  subject: string;
  note: string;
  html: string;
  text: string;
  attachments: DraftAttachment[];
  warnings: string[];
  versionStamp: string;
  options: Record<string, boolean>;
}
export interface OutgoingEmailHandler<E> {
  kind: OutgoingEmailKind;
  capabilities: RequestHandler[];
  options?: { key: string; label: string; default: boolean }[];
  load(req: Request, id: number): Promise<E | null>;
  draft(entity: E, input: DraftInput): Promise<BuiltDraft>;
  send(entity: E, draft: BuiltDraft, req: Request): Promise<{ sentTo: string; sentAt: Date }>;
}

export const draftInputSchema = z.object({
  to: z.string().trim().pipe(z.union([z.literal(""), z.email()])).optional(),
  cc: z.array(z.string().trim().pipe(z.email())).max(5).optional(),
  bcc: z.array(z.string().trim().pipe(z.email())).max(5).optional(),
  subject: z.string().trim().max(200).optional(),
  note: z.string().max(1000).optional(),
  options: z.record(z.string(), z.boolean()).optional(),
});

export const INVOICE_CHANGED = "This invoice changed after you reviewed it. Review it again before sending.";

export class OutgoingEmailError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
