import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("desktop shell overflow", () => {
  it("lets the sidebar inset shrink to the available width", () => {
    const sidebar = readFileSync("src/components/ui/sidebar.tsx", "utf8");
    expect(sidebar).toContain('"relative flex w-full min-w-0 flex-1 flex-col bg-background"');
  });

  it("lets the page wrapper shrink with the inset", () => {
    const shell = readFileSync("src/components/layout/desktop-shell.tsx", "utf8");
    expect(shell).toContain('className="flex-1 min-w-0 bg-gray-50"');
  });

  it("does not add the Replit development banner to the app HTML", () => {
    const html = readFileSync("index.html", "utf8");
    expect(html).not.toContain(["replit", "dev", "banner"].join("-"));
  });
});
