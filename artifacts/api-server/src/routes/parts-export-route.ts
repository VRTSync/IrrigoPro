// Extracted export route for GET /api/parts/export-csv.
// Keeping it in its own module with an injectable storage interface lets
// tests exercise the production handler without touching the real DB.

import type { Express, Request, RequestHandler } from "express";
import type { Part } from "@workspace/db/schema";

export interface PartsExportStorage {
  getParts(companyId: number): Promise<Part[]>;
}

export interface RegisterPartsExportRouteDeps {
  requireAuthentication: RequestHandler;
  applyPricingVisibility: <T>(req: Request, data: T) => T;
  storage: PartsExportStorage;
}

// RFC 4180 field serializer — quotes any field containing comma, double-quote,
// CR, or LF; doubles embedded double-quotes.
export function csvField(value: string | number | boolean | null | undefined): string {
  if (value == null) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

export const CSV_HEADERS = [
  "Part Type",
  "Product/Service Name",
  "SKU",
  "Sales Description",
  "Price",
  "Cost",
  "Brand",
  "Size",
  "Material",
  "Fitting Type",
  "Detail",
  "Active",
  "Approval Status",
  "QuickBooks ID",
] as const;

export function partToRow(p: Part): string {
  return [
    csvField(p.category),
    csvField(p.name),
    csvField(p.sku),
    csvField(p.description),
    csvField(p.price),
    csvField(p.cost),
    csvField(p.brand),
    csvField(p.size),
    csvField(p.material),
    csvField(p.fittingType),
    csvField(p.detail),
    csvField(p.isActive ? "true" : "false"),
    csvField(p.approvalStatus),
    csvField(p.quickbooksId),
  ].join(",");
}

export function buildCsv(parts: Part[]): string {
  const lines: string[] = [CSV_HEADERS.join(",")];
  for (const p of parts) lines.push(partToRow(p));
  return lines.join("\r\n");
}

export function registerPartsExportRoute(
  app: Express,
  { requireAuthentication, applyPricingVisibility, storage }: RegisterPartsExportRouteDeps,
): void {
  app.get("/api/parts/export-csv", requireAuthentication, async (req, res) => {
    const companyId = (req as any).authenticatedUserCompanyId as number | null;
    if (!companyId) {
      res.status(400).json({ message: "Company ID required" });
      return;
    }

    try {
      const rawParts = await storage.getParts(companyId);
      // Sort by category then name (case-insensitive, locale-aware)
      rawParts.sort((a, b) => {
        const catCmp = (a.category ?? "").localeCompare(b.category ?? "");
        if (catCmp !== 0) return catCmp;
        return (a.name ?? "").localeCompare(b.name ?? "");
      });

      // Apply pricing visibility masking (blanks price/cost for field_tech)
      const maskedParts = applyPricingVisibility(req, rawParts) as Part[];
      const csv = buildCsv(maskedParts);

      const date = new Date().toISOString().slice(0, 10);
      const filename = `parts-catalog-${companyId}-${date}.csv`;

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(csv);
    } catch (error) {
      console.error("Error exporting parts CSV:", error);
      res.status(500).json({ message: "Failed to export parts catalog" });
    }
  });
}
