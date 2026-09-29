/** Catalog labor for one finding. Invalid or sub-unit quantities count as one. */
export function catalogLaborHours(
  perUnit: string | number | null | undefined,
  quantity: number | string | null | undefined,
): number {
  const hours = parseFloat(String(perUnit)) || 0;
  const q = typeof quantity === "number" ? quantity : parseInt(String(quantity ?? "1"), 10);
  return hours * (isNaN(q) || q < 1 ? 1 : q);
}