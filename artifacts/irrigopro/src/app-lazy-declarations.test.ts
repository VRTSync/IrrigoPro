import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const source = readFileSync("src/App.tsx", "utf8");

it("uses every lazy page declared in App", () => {
  const declarations = Array.from(source.matchAll(/^const (\w+) = lazy(Page)?\(/gm));
  const uncommentedSource = source.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "");
  expect(declarations.length).toBeGreaterThan(0);

  for (const [, name] of declarations) {
    // A comment or an import string mentioning the name is not a route use.
    const usage = new RegExp(`(?:\\bcomponent\\s*=\\s*\\{\\s*${name}\\s*\\}|<${name}(?=[\\s/>]))`);
    expect(uncommentedSource, `${name} has no route use`).toMatch(usage);
  }
});
