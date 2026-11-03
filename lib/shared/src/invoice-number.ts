export const IRRIGO_INVOICE_PREFIX = "IR-";

export function formatIrrigoInvoiceNumber(n: number): string {
  if (!Number.isInteger(n) || n <= 0) throw new RangeError("Invoice counter must be a positive integer");
  return `${IRRIGO_INVOICE_PREFIX}${n}`;
}

export function isIrrigoInvoiceNumber(value: string): boolean {
  return /^IR-[1-9][0-9]*$/.test(value);
}
