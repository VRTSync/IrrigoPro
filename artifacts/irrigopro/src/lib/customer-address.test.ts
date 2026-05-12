import { describe, expect, test } from "vitest";
import {
  composeCustomerAddress,
  composeStructuredAddress,
  displayCustomerAddress,
} from "./customer-address";

describe("composeStructuredAddress", () => {
  test("returns empty string when nothing is set", () => {
    expect(composeStructuredAddress(null)).toBe("");
    expect(composeStructuredAddress(undefined)).toBe("");
    expect(composeStructuredAddress({})).toBe("");
    expect(
      composeStructuredAddress({ street: "", city: null, state: undefined }),
    ).toBe("");
  });

  test("combines all parts in US format", () => {
    expect(
      composeStructuredAddress({
        street: "123 Main St",
        city: "Springfield",
        state: "IL",
        zip: "62704",
      }),
    ).toBe("123 Main St, Springfield, IL 62704");
  });

  test("includes country when provided", () => {
    expect(
      composeStructuredAddress({
        street: "1 Yonge St",
        city: "Toronto",
        state: "ON",
        zip: "M5E 1W7",
        country: "Canada",
      }),
    ).toBe("1 Yonge St, Toronto, ON M5E 1W7, Canada");
  });

  test("handles partial data (city + state only)", () => {
    expect(
      composeStructuredAddress({ city: "Springfield", state: "IL" }),
    ).toBe("Springfield, IL");
  });

  test("handles zip only", () => {
    expect(composeStructuredAddress({ zip: "62704" })).toBe("62704");
  });

  test("handles street only", () => {
    expect(composeStructuredAddress({ street: "123 Main St" })).toBe(
      "123 Main St",
    );
  });
});

describe("composeCustomerAddress", () => {
  test("returns empty string for empty / null customer", () => {
    expect(composeCustomerAddress(null)).toBe("");
    expect(composeCustomerAddress(undefined)).toBe("");
    expect(composeCustomerAddress({ address: "" })).toBe("");
  });

  test("appends USA when no structured country is set", () => {
    expect(
      composeCustomerAddress({
        street: "123 Main St",
        city: "Springfield",
        state: "IL",
        zip: "62704",
      }),
    ).toBe("123 Main St, Springfield, IL 62704, USA");
  });

  test("trusts an explicit US country and does not double-append", () => {
    expect(
      composeCustomerAddress({
        street: "123 Main St",
        city: "Springfield",
        state: "IL",
        zip: "62704",
        country: "USA",
      }),
    ).toBe("123 Main St, Springfield, IL 62704, USA");
  });

  test("trusts an explicit non-US country and does NOT append USA", () => {
    expect(
      composeCustomerAddress({
        street: "1 Yonge St",
        city: "Toronto",
        state: "ON",
        zip: "M5E 1W7",
        country: "Canada",
      }),
    ).toBe("1 Yonge St, Toronto, ON M5E 1W7, Canada");
  });

  test("falls back to legacy address when no structured parts", () => {
    expect(
      composeCustomerAddress({ address: "123 Main St, Springfield, IL" }),
    ).toBe("123 Main St, Springfield, IL, USA");
  });

  test("does not double-append USA on legacy address that already has it", () => {
    expect(
      composeCustomerAddress({
        address: "123 Main St, Springfield, IL, USA",
      }),
    ).toBe("123 Main St, Springfield, IL, USA");
    expect(
      composeCustomerAddress({
        address: "123 Main St, Springfield, IL, United States",
      }),
    ).toBe("123 Main St, Springfield, IL, United States");
  });

  test("structured parts take precedence over legacy address", () => {
    expect(
      composeCustomerAddress({
        address: "stale single line",
        street: "123 Main St",
        city: "Springfield",
        state: "IL",
        zip: "62704",
      }),
    ).toBe("123 Main St, Springfield, IL 62704, USA");
  });
});

describe("displayCustomerAddress", () => {
  test("prefers structured address without country hint", () => {
    expect(
      displayCustomerAddress({
        street: "123 Main St",
        city: "Springfield",
        state: "IL",
        zip: "62704",
      }),
    ).toBe("123 Main St, Springfield, IL 62704");
  });

  test("falls back to legacy address when no structured parts", () => {
    expect(
      displayCustomerAddress({ address: "123 Main St, Springfield, IL" }),
    ).toBe("123 Main St, Springfield, IL");
  });

  test("returns empty string when neither is set", () => {
    expect(displayCustomerAddress(null)).toBe("");
    expect(displayCustomerAddress({})).toBe("");
  });
});
