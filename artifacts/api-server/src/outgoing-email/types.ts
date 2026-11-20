import type { Request, RequestHandler } from "express";
import { z } from "zod/v4";
import type { CompanySender } from "../lib/company-sender";

export type OutgoingEmailKind = "invoice" | "estimate" | "estimate_resend" | "invoice_reminder" | "wet_check_report" | "irrigation_profile_report";
export interface DraftInput {
  to?: string;
  cc?: string[];
  bcc?: string[];
  subject?: string;
  note?: string;
  options?: Record<string, boolean>;
  variant?: string;
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
  attachmentStamp?: string;
  options: Record<string, boolean>;
  variant: string | null;
}
export interface OutgoingEmailHandler<E> {
  kind: OutgoingEmailKind;
  capabilities: RequestHandler[];
  noRecipientMessage?: string;
  options?: { key: string; label: string; default: boolean }[];
  variants?: { key: string; label: string }[];
  defaultVariant?: string;
  load(req: Request, id: number): Promise<E | null>;
  draft(entity: E, input: DraftInput, req: Request): Promise<BuiltDraft>;
  renderAttachment?(entity: E): Promise<{ filename: string; buffer: Buffer }>;
  send(entity: E, draft: BuiltDraft, req: Request): Promise<{ sentTo: string; sentAt: Date }>;
}

export const draftInputSchema = z.object({
  to: z.string().trim().pipe(z.union([z.literal(""), z.email()])).optional(),
  cc: z.array(z.string().trim().pipe(z.email())).max(5).optional(),
  bcc: z.array(z.string().trim().pipe(z.email())).max(5).optional(),
  subject: z.string().trim().max(200).optional(),
  note: z.string().max(1000).optional(),
  options: z.record(z.string(), z.boolean()).optional(),
  variant: z.string().optional(),
});

export const draftRefusalSchema = z.object({
  status: z.literal(422),
  message: z.string(),
  action: z.object({ kind: z.string(), label: z.string() }).optional(),
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
