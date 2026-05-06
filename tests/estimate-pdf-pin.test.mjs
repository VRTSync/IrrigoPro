import { test, describe } from "node:test";
import assert from "node:assert/strict";

const { buildEstimateHtml } = await import("../server/estimate-pdf.ts");

const baseEstimate = {
  id: 1,
  estimateNumber: "EST-0042",
  customerName: "Jane Doe",
  customerEmail: "jane@example.com",
  customerPhone: "555-1234",
  customerAddress: "123 Garden Ln",
  projectName: "Backyard Drip System",
  projectAddress: "123 Garden Ln, Springfield",
  projectDescription: "Replace failing drip zones",
  estimateDate: new Date("2026-05-04T00:00:00Z"),
  createdBy: "Alice Tech",
  laborRate: "75",
  totalAmount: "1234.56",
  status: "pending",
  items: [
    {
      partName: "Hunter PGP Head",
      description: "Replace 3 broken sprinkler heads",
      quantity: 3,
      partPrice: "12.50",
      laborHours: "0.50",
      totalPrice: "37.50",
    },
  ],
};

describe("Estimate PDF — pinned work location (Task #348)", () => {
  test("HTML includes coordinates and Google Maps link when pin is saved", () => {
    const html = buildEstimateHtml({
      ...baseEstimate,
      workLocationLat: "37.7749295",
      workLocationLng: "-122.4194155",
      workLocationAddress: "Pinned spot near front gate",
      controllerLetter: "A",
      zoneNumber: 5,
    });

    assert.ok(
      html.includes("Pinned Work Location"),
      "HTML should include Pinned Work Location section",
    );
    assert.ok(
      html.includes("37.774929, -122.419415"),
      "HTML should include the formatted lat/lng coordinates",
    );
    assert.ok(
      html.includes(
        "https://www.google.com/maps/search/?api=1&amp;query=37.7749295,-122.4194155",
      ),
      "HTML should include the Google Maps link with raw lat/lng",
    );
    assert.ok(
      html.includes("Pinned spot near front gate"),
      "HTML should include the saved work location address",
    );
    assert.ok(
      html.includes("Controller A") && html.includes("Zone 5"),
      "HTML should include the controller letter and zone number",
    );
    assert.ok(
      html.includes("123 Garden Ln, Springfield"),
      "HTML should still include the project address alongside the pin",
    );
  });

  test("HTML omits the pin section when no coordinates are saved", () => {
    const html = buildEstimateHtml({ ...baseEstimate });
    assert.ok(
      !html.includes("Pinned Work Location"),
      "HTML must not render the pin section without coordinates",
    );
    assert.ok(
      !html.includes("google.com/maps"),
      "HTML must not include any map link when no pin is saved",
    );
    assert.ok(
      html.includes("123 Garden Ln, Springfield"),
      "HTML still shows the project address",
    );
  });
});
