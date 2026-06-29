// Task #1624 — Public approval page full estimate detail.
//
// Static-source guards that verify the key structural properties of the
// upgraded estimate-approval page without needing a real browser or API.
// Follows the same pattern as approval-signature-block.test.tsx.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const APPROVAL_PAGE_PATH = path.resolve(import.meta.dirname, "estimate-approval.tsx");
const BACKEND_HANDLER_PATH = path.resolve(
  import.meta.dirname,
  "../../../api-server/src/routes/estimate-routes.ts",
);

const src = fs.readFileSync(APPROVAL_PAGE_PATH, "utf8");

const backend = fs.readFileSync(BACKEND_HANDLER_PATH, "utf8");

// ─── Scope of Work section ────────────────────────────────────────────────────

describe("Scope of Work section", () => {
  it("renders a separate 'Scope of Work' section header", () => {
    expect(src).toContain("Scope of Work");
  });

  it("gates the scope section on workDescription being present", () => {
    expect(src).toContain("estimate.workDescription");
    // The section should be conditionally rendered
    expect(src).toMatch(/estimate\.workDescription.*&&/s);
  });

  it("workDescription is NOT embedded inside the Project section anymore", () => {
    // Find the Project section block
    const projectIdx = src.indexOf("Project");
    const scopeIdx = src.indexOf("Scope of Work");
    // Scope of Work section header must appear AFTER Project
    expect(projectIdx).toBeGreaterThan(0);
    expect(scopeIdx).toBeGreaterThan(projectIdx);
  });
});

// ─── Location block ───────────────────────────────────────────────────────────

describe("Location block with map link", () => {
  it("renders a 'Work Location' section", () => {
    expect(src).toContain("Work Location");
  });

  it("builds a Google Maps URL from lat/lng", () => {
    expect(src).toContain("google.com/maps");
    expect(src).toContain("workLocationLat");
    expect(src).toContain("workLocationLng");
  });

  it("renders a 'View on map' link when lat/lng are present", () => {
    expect(src).toContain("View on map");
    expect(src).toContain('data-testid="view-on-map-link"');
  });

  it("gates the location block on lat/lng or workLocationAddress being present", () => {
    expect(src).toContain("hasLatLng");
    expect(src).toContain("workLocationAddress");
  });

  it("includes MapPin icon for the location block", () => {
    expect(src).toContain("MapPin");
  });
});

// ─── Per-line Labor column in the standard flat table ────────────────────────

describe("Per-line Labor column in standard flat table", () => {
  it("renders a 'Labor' column header in the flat table", () => {
    expect(src).toContain(">Labor<");
  });

  it("renders a 'Line Total' column header in the flat table", () => {
    expect(src).toContain(">Line Total<");
  });

  it("renders a 'Unit Price' column header (not just 'Unit $')", () => {
    expect(src).toContain(">Unit Price<");
  });

  it("computes per-item labor amount from laborHours × laborRate", () => {
    expect(src).toContain("itLaborHrs * laborRate");
    expect(src).toContain("itLaborAmt");
  });

  it("computes line total as parts total + labor amount per item", () => {
    expect(src).toContain("itPartsTotal + itLaborAmt");
    expect(src).toContain("itLineTotal");
  });

  it("shows labor hours with toFixed(2) format when laborHours > 0", () => {
    expect(src).toContain("itLaborHrs.toFixed(2)");
    expect(src).toContain("itLaborHrs > 0");
  });

  it("shows a dash for items with zero labor hours", () => {
    // The dash placeholder for 0-labor rows
    expect(src).toMatch(/itLaborHrs > 0.*?—/s);
  });

  it("attaches a per-item testid to the labor cell for testing targeting", () => {
    expect(src).toContain('data-testid={`item-labor-${it.id}`}');
  });
});

// ─── Reconciling totals block ─────────────────────────────────────────────────

describe("Reconciling totals block", () => {
  it("renders a Parts Subtotal line", () => {
    expect(src).toContain("Parts Subtotal");
    expect(src).toContain('data-testid="parts-subtotal"');
  });

  it("renders a Labor subtotal line with hours × rate formula", () => {
    expect(src).toContain("Labor (");
    expect(src).toContain('data-testid="labor-subtotal"');
    // Should show hours × rate formula
    expect(src).toContain("totalLaborHours.toFixed(2)");
    expect(src).toContain("laborRate");
  });

  it("renders a Grand Total line", () => {
    expect(src).toContain("Grand Total");
    expect(src).toContain('data-testid="grand-total"');
  });

  it("wraps the reconciling block in an approval-totals-block testid", () => {
    expect(src).toContain('data-testid="approval-totals-block"');
  });

  it("computes partsSubtotal from server value with local fallback", () => {
    expect(src).toContain("estimate.partsSubtotal");
    expect(src).toContain("parseFloat(String(estimate.partsSubtotal))");
  });

  it("computes laborSubtotal from server value with local fallback", () => {
    expect(src).toContain("estimate.laborSubtotal");
    expect(src).toContain("totalLaborHours * laborRate");
  });

  it("gates labor row on non-zero labor hours or subtotal", () => {
    expect(src).toContain("totalLaborHours > 0 || laborSubtotal > 0");
  });
});

// ─── Zone-grouped layout for inspection estimates ─────────────────────────────

describe("Zone-grouped layout for inspection estimates", () => {
  it("imports isInspectionOriginEstimate from the zone-grouping library", () => {
    expect(src).toContain("isInspectionOriginEstimate");
    expect(src).toContain("estimate-zone-grouping");
  });

  it("imports EstimateZoneGroupedView component", () => {
    expect(src).toContain("EstimateZoneGroupedView");
    expect(src).toContain("estimate-zone-grouped-view");
  });

  it("uses isInspection flag to branch between zone-grouped and flat table", () => {
    expect(src).toContain("const isInspection = isInspectionOriginEstimate(itemsForZone)");
  });

  it("renders EstimateZoneGroupedView for inspection estimates", () => {
    expect(src).toContain("<EstimateZoneGroupedView");
  });

  it("passes canSeePricing=true so customers can see all pricing", () => {
    expect(src).toContain("canSeePricing={true}");
  });

  it("passes showTotalsFooter=true so the totals block shows inside zone view", () => {
    expect(src).toContain("showTotalsFooter={true}");
  });

  it("shows 'Inspection Findings & Repairs' heading for inspection estimates", () => {
    expect(src).toContain("Inspection Findings & Repairs");
  });

  it("shows 'Line Items' heading for standard estimates", () => {
    expect(src).toContain('"Line Items"');
  });
});

// ─── EstimateView type — new fields ──────────────────────────────────────────

describe("EstimateView type completeness", () => {
  it("declares workLocationLat in the estimate type", () => {
    expect(src).toContain("workLocationLat: string | null");
  });

  it("declares workLocationLng in the estimate type", () => {
    expect(src).toContain("workLocationLng: string | null");
  });

  it("declares workLocationAddress in the estimate type", () => {
    expect(src).toContain("workLocationAddress: string | null");
  });

  it("declares partsSubtotal in the estimate type", () => {
    expect(src).toContain("partsSubtotal: string | number | null");
  });

  it("declares laborSubtotal in the estimate type", () => {
    expect(src).toContain("laborSubtotal: string | number | null");
  });

  it("declares controllerLetter on items for zone routing", () => {
    expect(src).toContain("controllerLetter: string | null");
  });

  it("declares zoneNumber on items for zone routing", () => {
    expect(src).toContain("zoneNumber: number | null");
  });

  it("declares issueType on items for zone routing", () => {
    expect(src).toContain("issueType: string | null");
  });
});

// ─── Photos and attachments ───────────────────────────────────────────────────

describe("Photos and attachments display", () => {
  it("renders site photos in a gallery with per-photo testids", () => {
    expect(src).toContain('data-testid={`approval-photo-${i}`}');
  });

  it("renders attachments with per-attachment testids", () => {
    expect(src).toContain('data-testid={`approval-attachment-${i}`}');
  });

  it("renders Paperclip icon on attachment items", () => {
    expect(src).toContain("Paperclip");
  });

  it("renders attachment links as anchor tags when URL is linkable", () => {
    expect(src).toContain("isLinkableUrl(url)");
    expect(src).toContain('rel="noopener noreferrer"');
  });
});

// ─── Approve / decline flows unchanged ───────────────────────────────────────

describe("Approve and decline flows", () => {
  it("still renders the Approve Estimate button", () => {
    expect(src).toContain('data-testid="approval-approve-btn"');
    expect(src).toContain("Approve Estimate");
  });

  it("still renders the Decline Estimate button", () => {
    expect(src).toContain('data-testid="approval-reject-btn"');
    expect(src).toContain("Decline Estimate");
  });

  it("still opens the sign-to-approve sheet on approve click", () => {
    expect(src).toContain("sign-sheet-open");
    expect(src).toContain("Sign to Approve");
  });

  it("still shows confirm-decline screen before posting to API", () => {
    expect(src).toContain("confirm-reject");
    expect(src).toContain('data-testid="confirm-reject-confirm-btn"');
  });

  it("still POSTs to approve-via-token endpoint", () => {
    expect(src).toContain("approve-via-token");
  });

  it("still POSTs to reject-via-token endpoint", () => {
    expect(src).toContain("reject-via-token");
  });
});

// ─── Backend: view-by-token payload completeness ─────────────────────────────

describe("Backend view-by-token payload", () => {
  it("includes workLocationLat in the response", () => {
    expect(backend).toContain("workLocationLat: full.workLocationLat");
  });

  it("includes workLocationLng in the response", () => {
    expect(backend).toContain("workLocationLng: full.workLocationLng");
  });

  it("includes workLocationAddress in the response", () => {
    expect(backend).toContain("workLocationAddress: full.workLocationAddress");
  });

  it("includes partsSubtotal in the response", () => {
    expect(backend).toContain("partsSubtotal: full.partsSubtotal");
  });

  it("includes laborSubtotal in the response", () => {
    expect(backend).toContain("laborSubtotal: full.laborSubtotal");
  });

  it("includes controllerLetter per item for zone routing", () => {
    expect(backend).toContain("controllerLetter: (it as any).controllerLetter");
  });

  it("includes zoneNumber per item for zone routing", () => {
    expect(backend).toContain("zoneNumber: (it as any).zoneNumber");
  });

  it("includes issueType per item for zone routing", () => {
    expect(backend).toContain("issueType: (it as any).issueType");
  });

  it("fetches finding photos from wet_check_photos when originWetCheckId is set", () => {
    expect(backend).toContain("originWetCheckId");
    expect(backend).toContain("wetCheckPhotos");
    expect(backend).toContain("wetCheckPhotos.wetCheckId");
  });

  it("de-duplicates finding photos that already appear in site photos", () => {
    expect(backend).toContain("filter((u) => !sitePhotos.includes(u))");
  });

  it("does not require authentication — no requireAuthentication call on this route", () => {
    const tokenRouteBlock = backend.slice(
      backend.indexOf("view-by-token/:token"),
      backend.indexOf("view-by-token/:token") + 2000,
    );
    expect(tokenRouteBlock).not.toContain("requireAuthentication");
  });

  it("returns 404 for unknown tokens (no data leakage)", () => {
    expect(backend).toContain('error: "not_found"');
  });

  it("returns 410 for expired tokens (separate from unknown)", () => {
    expect(backend).toContain('error: "expired"');
  });

  it("only returns the single estimate matched by the token (no cross-tenant leakage)", () => {
    // The handler finds the estimate by token match and fetches only that one
    expect(backend).toContain("e.approvalToken === token");
    expect(backend).toContain("storage.getEstimate(summary.id)");
  });
});
