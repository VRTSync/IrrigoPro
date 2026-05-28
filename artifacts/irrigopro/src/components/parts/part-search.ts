import type { Part } from "@workspace/db/schema";

// ─────────────────────────────────────────────────────────────────────────────
// Field weights
// ─────────────────────────────────────────────────────────────────────────────

const FIELD_WEIGHT = {
  name:        100,
  sku:          80,
  brand:        50,
  category:     40,
  description:  25,
  material:     20,
  size:         20,
  fittingType:  20,
  detail:       15,
} as const;

export type SearchableField = keyof typeof FIELD_WEIGHT;

// ─────────────────────────────────────────────────────────────────────────────
// Normalisation helpers
//
// Pipeline: NFKD → lowercase → strip diacritics → replace non-alnum runs with
// a single space → trim.
// Example: "Rain-Bird 1804!" → "rain bird 1804"
// ─────────────────────────────────────────────────────────────────────────────

export function normaliseForSearch(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function tokeniseQuery(query: string): string[] {
  return normaliseForSearch(query)
    .split(" ")
    .filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────────
// NormalisedPart — pre-computed per-field strings and word arrays
// ─────────────────────────────────────────────────────────────────────────────

export interface NormalisedPart {
  raw: Part;
  name:        string;
  sku:         string;
  brand:       string;
  category:    string;
  description: string;
  material:    string;
  size:        string;
  fittingType: string;
  detail:      string;
  nameWords:        string[];
  skuWords:         string[];
  brandWords:       string[];
  categoryWords:    string[];
  descriptionWords: string[];
  materialWords:    string[];
  sizeWords:        string[];
  fittingTypeWords: string[];
  detailWords:      string[];
}

function splitWords(s: string): string[] {
  return s.split(" ").filter(Boolean);
}

export function normalisePart(part: Part): NormalisedPart {
  const name        = normaliseForSearch(part.name);
  const sku         = normaliseForSearch((part as any).sku);
  const brand       = normaliseForSearch((part as any).brand);
  const category    = normaliseForSearch(part.category);
  const description = normaliseForSearch(part.description);
  const material    = normaliseForSearch((part as any).material);
  const size        = normaliseForSearch((part as any).size);
  const fittingType = normaliseForSearch((part as any).fittingType);
  const detail      = normaliseForSearch((part as any).detail);

  return {
    raw: part,
    name, sku, brand, category, description, material, size, fittingType, detail,
    nameWords:        splitWords(name),
    skuWords:         splitWords(sku),
    brandWords:       splitWords(brand),
    categoryWords:    splitWords(category),
    descriptionWords: splitWords(description),
    materialWords:    splitWords(material),
    sizeWords:        splitWords(size),
    fittingTypeWords: splitWords(fittingType),
    detailWords:      splitWords(detail),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4-level field scorer
//
// Level 1 (1.00): field as a whole equals token exactly
// Level 2 (0.95): any word in the field equals the token
// Level 3 (0.80): any word in the field starts with the token
// Level 4 (0.50): field as a whole contains the token
// ─────────────────────────────────────────────────────────────────────────────

function fieldScore(field: string, fw: string[], token: string): number {
  if (!field) return 0;
  if (field === token)                     return 1.00;
  if (fw.some((w) => w === token))         return 0.95;
  if (fw.some((w) => w.startsWith(token))) return 0.80;
  if (field.includes(token))               return 0.50;
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// searchParts — AND-semantics across tokens
// ─────────────────────────────────────────────────────────────────────────────

export interface SearchPartsOptions {
  /** Hard-filter to parts whose `category` equals this value (case-insensitive NFKD). */
  categoryFilter?: string | null;
  /** Maximum number of results to return (default: unlimited). */
  maxResults?: number;
}

/**
 * Score and rank parts against a query string.
 *
 * AND-semantics: every token must match at least one field, or the part is
 * excluded. The score for a token is the best weighted field match.
 * Final score sums across tokens, plus a +1 name tie-break bonus.
 * Equal scores are broken by stable secondary sort on normalised name (A→Z).
 *
 * Empty query: returns all parts (after any categoryFilter) sorted alphabetically
 * by normalised name.
 */
export function searchParts(
  normalisedParts: NormalisedPart[],
  query: string,
  options?: SearchPartsOptions,
): Part[] {
  const { categoryFilter, maxResults } = options ?? {};

  const catFilter = normaliseForSearch(categoryFilter);

  const candidates = catFilter
    ? normalisedParts.filter((np) => np.category === catFilter)
    : normalisedParts;

  const tokens = tokeniseQuery(query);

  if (tokens.length === 0) {
    const sorted = [...candidates].sort((a, b) => a.name.localeCompare(b.name));
    const parts = sorted.map((np) => np.raw);
    return maxResults !== undefined ? parts.slice(0, maxResults) : parts;
  }

  const scored: { np: NormalisedPart; score: number }[] = [];

  for (const np of candidates) {
    let total = 0;
    let allMatch = true;

    for (const token of tokens) {
      let best = 0;
      let bestIsName = false;

      const checks: [string, string[], number, boolean][] = [
        [np.name,        np.nameWords,        FIELD_WEIGHT.name,        true],
        [np.sku,         np.skuWords,         FIELD_WEIGHT.sku,         false],
        [np.brand,       np.brandWords,       FIELD_WEIGHT.brand,       false],
        [np.category,    np.categoryWords,    FIELD_WEIGHT.category,    false],
        [np.description, np.descriptionWords, FIELD_WEIGHT.description, false],
        [np.material,    np.materialWords,    FIELD_WEIGHT.material,    false],
        [np.size,        np.sizeWords,        FIELD_WEIGHT.size,        false],
        [np.fittingType, np.fittingTypeWords, FIELD_WEIGHT.fittingType, false],
        [np.detail,      np.detailWords,      FIELD_WEIGHT.detail,      false],
      ];

      for (const [fv, fw, weight, isName] of checks) {
        const fs = fieldScore(fv, fw, token) * weight;
        if (fs > best) {
          best = fs;
          bestIsName = isName;
        }
      }

      if (best === 0) { allMatch = false; break; }
      total += best;
      // +1 tie-break per token whose best match is in the name field
      if (bestIsName) total += 1;
    }

    if (!allMatch) continue;

    scored.push({ np, score: total });
  }

  // Primary: score descending; secondary: normalised name ascending (stable)
  scored.sort((a, b) =>
    b.score !== a.score
      ? b.score - a.score
      : a.np.name.localeCompare(b.np.name),
  );

  const parts = scored.map((s) => s.np.raw);
  return maxResults !== undefined ? parts.slice(0, maxResults) : parts;
}
