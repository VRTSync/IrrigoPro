import { describe, it, expect } from "vitest";
import { isLikelyEdgeError } from "./engine";

describe("isLikelyEdgeError (Task #469)", () => {
  it("treats application/json 4xx as a real API error (not edge)", () => {
    expect(
      isLikelyEdgeError("application/json; charset=utf-8", '{"message":"Forbidden"}'),
    ).toBe(false);
  });

  it("treats HTML 4xx as edge so the engine retries", () => {
    expect(
      isLikelyEdgeError(
        "text/html; charset=utf-8",
        "<!doctype html><html><head><title>403</title></head><body>403 Forbidden</body></html>",
      ),
    ).toBe(true);
  });

  it("treats text/plain 4xx as edge so the engine retries", () => {
    expect(isLikelyEdgeError("text/plain", "Forbidden")).toBe(true);
  });

  it("treats a missing content-type with empty body (preflight reject) as edge", () => {
    expect(isLikelyEdgeError("", "")).toBe(true);
  });

  it("treats a missing content-type with HTML body as edge", () => {
    expect(isLikelyEdgeError("", "<html><body>403</body></html>")).toBe(true);
  });

  it("treats a missing content-type with parseable JSON body as a real API error", () => {
    expect(isLikelyEdgeError("", '{"message":"nope"}')).toBe(false);
  });

  it("treats any other non-JSON content-type as edge", () => {
    expect(isLikelyEdgeError("text/xml", "<error/>")).toBe(true);
    expect(isLikelyEdgeError("application/octet-stream", "")).toBe(true);
  });
});
