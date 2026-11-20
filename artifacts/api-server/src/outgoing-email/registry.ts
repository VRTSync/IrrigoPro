import { createInvoiceEmailHandler } from "./invoice-handler";
import type { OutgoingEmailHandler } from "./types";

const invoice = createInvoiceEmailHandler();
export const outgoingEmailHandlers = new Map<string, OutgoingEmailHandler<any>>([
  [invoice.kind, invoice],
]);

export function getHandler(kind: string): OutgoingEmailHandler<any> | null {
  return outgoingEmailHandlers.get(kind) ?? null;
}
