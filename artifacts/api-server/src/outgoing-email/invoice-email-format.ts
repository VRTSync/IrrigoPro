export const invoiceShortDate = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
});
const monthAndDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
export const invoiceCurrency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function billingDateRange(invoice: { periodStart: Date | string; periodEnd: Date | string }): string {
  const start = new Date(invoice.periodStart);
  const end = new Date(invoice.periodEnd);
  const startFormat = start.getUTCFullYear() === end.getUTCFullYear() ? monthAndDay : invoiceShortDate;
  return `${startFormat.format(start)} – ${invoiceShortDate.format(end)}`;
}
