import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// The parts module imports the storage singleton. Inspect its registrations
// without connecting to a database.
const routes = readFileSync(new URL("./parts-routes.ts", import.meta.url), "utf8");
const storage = readFileSync(new URL("../storage.ts", import.meta.url), "utf8");

function getHandler(path: string) {
  const registration = `app.get("${path}",`;
  const start = routes.indexOf(registration);
  const end = routes.indexOf("\n  });", start);
  assert.ok(start >= 0 && end > start, `Missing GET ${path} handler`);
  return routes.slice(start, end);
}

describe("Parts read access", () => {
  it("requires authentication as the first middleware on catalog and popular reads", () => {
    for (const path of ["/api/parts", "/api/parts/popular"]) {
      assert.match(getHandler(path), /^app\.get\("[^"]+",\s*requireAuthentication\s*,/);
    }
  });

  it("queries the catalog with company scope and strips pricing for field techs", () => {
    const catalog = getHandler("/api/parts");
    assert.match(catalog, /storage\.getParts\(\s*companyId\s*\)/);
    assert.match(catalog, /res\.json\(applyPricingVisibility\(req, parts\)\)/);
  });

  it("ranks parts only in the authenticated company and applies pricing visibility", () => {
    const popular = getHandler("/api/parts/popular");
    assert.match(popular, /const companyId = req\.authenticatedUserCompanyId;/);
    assert.match(popular, /if \(companyId == null\)\s*\{[^}]*res\.json\(\[\]\);\s*return;/);
    assert.match(popular, /storage\.getPopularParts\(companyId, limit\)/);
    assert.match(popular, /res\.json\(applyPricingVisibility\(req, popularParts\)\)/);
    assert.doesNotMatch(popular, /\|\|\s*1\b/);
  });

  it("does not expose the unused search and detail reads", () => {
    assert.doesNotMatch(routes, /app\.get\(\s*"\/api\/parts\/(?:search|:id)"/);
    assert.doesNotMatch(storage, /\bsearchParts\b/);
  });
});
