import { describe, it, expect } from "vitest";
import { normaliseForSearch, tokeniseQuery, normalisePart, searchParts } from "./part-search";
import type { Part } from "@workspace/db/schema";

// ─────────────────────────────────────────────────────────────────────────────
// Fixture parts (ids 1–5)
// ─────────────────────────────────────────────────────────────────────────────

function makePart(overrides: Partial<Part> & { id: number; name: string }): Part {
  return {
    companyId: 1,
    description: null,
    sku: null,
    category: null,
    price: "0.00",
    cost: null,
    isActive: true,
    approvalStatus: "approved",
    brand: null,
    material: null,
    size: null,
    fittingType: null,
    detail: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as Part;
}

const PARTS: Part[] = [
  makePart({
    id: 1,
    name: "Hunter 1804 Rotor",
    sku: "HNT-1804",
    brand: "Hunter",
    category: "Rotors",
    description: "Standard 4-inch pop-up rotor head",
    material: "plastic",
    size: "4 inch",
    fittingType: "half-inch",
    detail: "pop-up 4 inch",
  }),
  makePart({
    id: 2,
    name: "Rain Bird 5000 Rotor",
    sku: "RB-5000",
    brand: "Rain Bird",
    category: "Rotors",
    description: "The 1804 style body is used on this rotor",
    material: "plastic",
    size: "5 inch",
    fittingType: "half-inch",
    detail: "pop-up 5 inch",
  }),
  makePart({
    id: 3,
    name: "Orbit Sprinkler Head",
    sku: "ORB-100",
    brand: "Orbit",
    category: "Heads",
    description: "Standard head replacement part",
    material: "brass",
    size: "3 inch",
    fittingType: "quarter-inch",
    detail: "fixed head",
  }),
  makePart({
    id: 4,
    name: "Hunter PGP Rotor",
    sku: "HNT-PGP",
    brand: "Hunter",
    category: "Rotors",
    description: "Professional grade gear-driven rotor",
    material: "plastic",
    size: "6 inch",
    fittingType: "three-quarter-inch",
    detail: "adjustable arc",
  }),
  makePart({
    id: 5,
    name: "Valve 24V Solenoid",
    sku: "VLV-24V",
    brand: "Irritrol",
    category: "Valves",
    description: "24 volt electric solenoid valve",
    material: "brass",
    size: "1 inch",
    fittingType: "one-inch",
    detail: "electric actuated",
  }),
];

const NP = PARTS.map(normalisePart);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function ids(result: Part[]): number[] {
  return result.map((p) => p.id as number);
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalisation pipeline assertions
// ─────────────────────────────────────────────────────────────────────────────

describe("normaliseForSearch", () => {
  it('replaces hyphens and punctuation with spaces: "Rain-Bird 1804!" → "rain bird 1804"', () => {
    expect(normaliseForSearch("Rain-Bird 1804!")).toBe("rain bird 1804");
  });

  it("collapses multiple non-alnum separators to a single space", () => {
    expect(normaliseForSearch("half--inch")).toBe("half inch");
  });

  it("strips diacritics via NFKD", () => {
    expect(normaliseForSearch("café")).toBe("cafe");
  });

  it("returns empty string for null/undefined/empty", () => {
    expect(normaliseForSearch(null)).toBe("");
    expect(normaliseForSearch(undefined)).toBe("");
    expect(normaliseForSearch("")).toBe("");
  });
});

describe("tokeniseQuery", () => {
  it('"HNT-1804" tokenises to ["hnt", "1804"]', () => {
    expect(tokeniseQuery("HNT-1804")).toEqual(["hnt", "1804"]);
  });

  it('"Rain Bird" tokenises to ["rain", "bird"]', () => {
    expect(tokeniseQuery("Rain Bird")).toEqual(["rain", "bird"]);
  });

  it("empty/whitespace-only query returns []", () => {
    expect(tokeniseQuery("")).toEqual([]);
    expect(tokeniseQuery("   ")).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 18 locked searchParts assertions
// ─────────────────────────────────────────────────────────────────────────────

describe("searchParts", () => {
  // 1. Empty query returns all parts unchanged
  it("empty query returns all 5 parts", () => {
    expect(searchParts(NP, "").length).toBe(5);
  });

  // 2. "rotor" matches name/description on parts 1, 2, 4 (all contain "rotor")
  it('query "rotor" returns parts 1, 2 and 4', () => {
    const result = ids(searchParts(NP, "rotor"));
    expect(result).toContain(1);
    expect(result).toContain(2);
    expect(result).toContain(4);
    expect(result).not.toContain(3);
    expect(result).not.toContain(5);
  });

  // 3. "1804" — name word match beats description word match
  it('query "1804" ranks Part 1 (name word) above Part 2 (description word)', () => {
    const result = searchParts(NP, "1804");
    expect(result.length).toBeGreaterThanOrEqual(2);
    const i1 = result.findIndex((p) => p.id === 1);
    const i2 = result.findIndex((p) => p.id === 2);
    expect(i1).toBeGreaterThanOrEqual(0);
    expect(i2).toBeGreaterThanOrEqual(0);
    expect(i1).toBeLessThan(i2);
  });

  // 4. AND semantics: "hunter rotor" must match BOTH tokens — returns 1 and 4 only
  it('AND semantics: "hunter rotor" returns only parts 1 and 4', () => {
    const result = ids(searchParts(NP, "hunter rotor"));
    expect(result.sort()).toEqual([1, 4]);
  });

  // 5. "valve" returns only part 5
  it('query "valve" returns only part 5', () => {
    expect(ids(searchParts(NP, "valve"))).toEqual([5]);
  });

  // 6. Non-matching query returns no results
  it("non-matching query returns empty array", () => {
    expect(searchParts(NP, "xyz-zzznonexistent-abc")).toHaveLength(0);
  });

  // 7. "hunter" returns parts 1 and 4 (brand match)
  it('query "hunter" returns parts 1 and 4', () => {
    const result = ids(searchParts(NP, "hunter"));
    expect(result.sort()).toEqual([1, 4]);
  });

  // 8. SKU tokens after normalisation: "hnt-1804" → tokens ["hnt","1804"]
  it('query "hnt-1804" matches Part 1 by SKU', () => {
    const result = ids(searchParts(NP, "hnt-1804"));
    expect(result).toContain(1);
  });

  // 9. Case-insensitive: "HUNTER" same as "hunter"
  it("matching is case-insensitive", () => {
    const lower = ids(searchParts(NP, "hunter"));
    const upper = ids(searchParts(NP, "HUNTER"));
    expect(lower.sort()).toEqual(upper.sort());
  });

  // 10. Name word match (0.95×100 + 1 name bonus = 96) beats description word match (0.95×25 = 23.75)
  it("name word match scores higher than description word match", () => {
    const result = searchParts(NP, "1804");
    const idx1 = result.findIndex((p) => p.id === 1);
    const idx2 = result.findIndex((p) => p.id === 2);
    expect(idx1).toBeLessThan(idx2);
  });

  // 11. "plastic" (material) returns parts 1, 2 and 4
  it('query "plastic" matches material field and returns 3 results', () => {
    const result = ids(searchParts(NP, "plastic"));
    expect(result.sort()).toEqual([1, 2, 4]);
  });

  // 12. "brass" (material) returns parts 3 and 5
  it('query "brass" matches material field for parts 3 and 5', () => {
    const result = ids(searchParts(NP, "brass"));
    expect(result.sort()).toEqual([3, 5]);
  });

  // 13. "rb-5000" → tokens ["rb","5000"] match Part 2 SKU words
  it('query "rb-5000" matches Part 2 by SKU', () => {
    const result = ids(searchParts(NP, "rb-5000"));
    expect(result).toContain(2);
  });

  // 14. "irritrol" (brand) returns only part 5
  it('query "irritrol" brand match returns only part 5', () => {
    expect(ids(searchParts(NP, "irritrol"))).toEqual([5]);
  });

  // 15. categoryFilter hard-filters results
  it("categoryFilter restricts results to Rotors only", () => {
    const result = searchParts(NP, "", { categoryFilter: "Rotors" });
    expect(result.length).toBe(3);
    const resultIds = ids(result);
    expect(resultIds).toContain(1);
    expect(resultIds).toContain(2);
    expect(resultIds).toContain(4);
    expect(resultIds).not.toContain(3);
    expect(resultIds).not.toContain(5);
  });

  // 16. categoryFilter + query combined
  it("categoryFilter + query: Rotors + hunter returns only parts 1 and 4", () => {
    const result = ids(searchParts(NP, "hunter", { categoryFilter: "Rotors" }));
    expect(result.sort()).toEqual([1, 4]);
  });

  // 17. maxResults option trims results
  it("maxResults option trims to N results", () => {
    expect(searchParts(NP, "", { maxResults: 2 })).toHaveLength(2);
  });

  // 18. Partial prefix token (level 3 — word starts with) matches
  it('prefix token "irr" starts-with matches Part 5 brand (Irritrol)', () => {
    const result = ids(searchParts(NP, "irr"));
    expect(result).toContain(5);
  });
});
