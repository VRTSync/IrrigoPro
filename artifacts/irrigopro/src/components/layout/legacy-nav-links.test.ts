import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "vitest";

it("uses legacy navigation paths only in bookmark route declarations", () => {
  const root = join(import.meta.dirname, "../..");
  const legacy = /(["'`])(\/wet-checks\/admin|\/manager\/wet-checks|\/wet-checks\/pending-review|\/billing\/dashboard|\/manager|\/operations)\1/g;
  const redirectFiles = new Set(["App.tsx", "components/company-admin-app.tsx"]);
  const violations: string[] = [];

  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.[cm]?[jt]sx?$/.test(entry.name) || /\.(test|spec)\.[^.]+$/.test(entry.name)) continue;
    const file = join(entry.parentPath, entry.name);
    const sourcePath = relative(root, file);
    if (sourcePath === "pages/customer-billing.tsx") continue;

    const source = readFileSync(file, "utf8")
      // Blank only the path attribute, not the file or the whole line.
      .replace(/(<Route\s+[^<>]*?\bpath\s*=\s*)(["'`])([^"'`]+)\2/g, (match, prefix, quote, path) =>
        redirectFiles.has(sourcePath) ? `${prefix}${quote}${" ".repeat(path.length)}${quote}` : match,
      );
    for (const match of source.matchAll(legacy)) {
      const line = source.slice(0, match.index).split("\n").length;
      violations.push(`${sourcePath}:${line}: ${match[2]}`);
    }
  }

  expect(violations).toEqual([]);
});
