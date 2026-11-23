import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("desktop shell overflow", () => {
  it("lets the main column shrink to the available width", () => {
    const shell = readFileSync("src/components/layout/desktop-shell.tsx", "utf8");
    expect(shell).toMatch(/<main className="[^"]*\bmin-w-0\b[^"]*"/);
  });

  it("lets the page wrapper shrink with the main column", () => {
    const shell = readFileSync("src/components/layout/desktop-shell.tsx", "utf8");
    expect(shell).toContain('className="flex-1 min-w-0 bg-gray-50"');
  });

  it("does not add the Replit development banner to the app HTML", () => {
    const html = readFileSync("index.html", "utf8");
    expect(html).not.toContain(["replit", "dev", "banner"].join("-"));
  });
});
