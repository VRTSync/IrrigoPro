import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { lanes, root, runLane } from "./run-validation-lane.mjs";

const manifest = JSON.parse(readFileSync(resolve(root, "scripts/validation-lanes.json"), "utf8"));

// Discover the actual workspace directories, including nested integration packages.
function workspacePackages() {
  const yaml = readFileSync(resolve(root, "pnpm-workspace.yaml"), "utf8");
  const patterns = yaml.split(/\n\s*\n/)[0].split("\n").slice(1)
    .map(line => line.match(/^\s*-\s*['"]?([^'"]+?)['"]?\s*$/)?.[1]).filter(Boolean);
  const packages = new Map();
  for (const pattern of patterns) {
    if (pattern.endsWith("/*") && !existsSync(resolve(root, pattern.slice(0, -2)))) continue;
    const dirs = pattern.endsWith("/*")
      ? readdirSync(resolve(root, pattern.slice(0, -2)), { withFileTypes: true })
        .filter(entry => entry.isDirectory()).map(entry => `${pattern.slice(0, -1)}${entry.name}`)
      : [pattern];
    for (const dir of dirs) {
      const path = resolve(root, dir, "package.json");
      if (existsSync(path)) packages.set(JSON.parse(readFileSync(path, "utf8")).name, resolve(root, dir));
    }
  }
  return packages;
}

function validateStructure(value) {
  assert.deepEqual(Object.keys(value).sort(), [...lanes].sort(), "Exactly the four expected lanes are required");
  const names = new Set();
  const commands = new Set();
  for (const entries of Object.values(value)) {
    assert.ok(Array.isArray(entries) && entries.length > 0, "Each lane must contain entries");
    for (const entry of entries) {
      assert.equal(typeof entry.name, "string");
      assert.equal(typeof entry.command, "string");
      assert.ok(entry.name.trim() && entry.command.trim(), "Entries must be nonempty");
      assert.ok(!names.has(entry.name), `Duplicate name: ${entry.name}`);
      assert.ok(!commands.has(entry.command), `Duplicate command: ${entry.name}`);
      names.add(entry.name);
      commands.add(entry.command);
    }
  }
}

function namedPaths(command, packages) {
  const paths = [];
  let cwd = root;
  // Each shell invocation has its own filter context; && does not retain a pnpm filter.
  for (const segment of command.split("&&")) {
    const tokens = (segment.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? [])
      .map(token => token.replace(/^(['"])(.*)\1$/, "$2"));
    if (tokens[0] === "cd") cwd = resolve(cwd, tokens[1]);
    const filterIndex = tokens.indexOf("--filter");
    const filter = filterIndex >= 0 ? tokens[filterIndex + 1]
      : tokens.find(token => token.startsWith("--filter="))?.slice(9);
    const packageRoot = filter ? packages.get(filter) : cwd;
    if (filter) assert.ok(packageRoot, `Unknown workspace package: ${filter}`);
    for (const token of tokens) {
      if (/\.test\.(ts|tsx|cjs)$/.test(token)) paths.push(resolve(packageRoot, token));
    }
  }
  return paths;
}

function scanTests(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? scanTests(path) : /\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

test("manifest has exactly four lanes and unique names and commands", () => {
  validateStructure(manifest);
  assert.equal(manifest.types[0].name, "validation-lanes-manifest");
  assert.equal(manifest.types[0].command, "node --test scripts/validation-lanes.test.mjs");
});

test("guard rejects duplicates and unexpected lanes", () => {
  for (const property of ["name", "command"]) {
    const bad = structuredClone(manifest);
    bad.web[0][property] = bad["api-field"][0][property];
    assert.throws(() => validateStructure(bad), /Duplicate/);
  }
  assert.throws(() => validateStructure({ ...manifest, unexpected: [] }));
});

test("named test paths exist; report unnamed source tests without failing", () => {
  const packages = workspacePackages();
  const named = new Set(Object.values(manifest).flat().flatMap(entry => namedPaths(entry.command, packages)));
  for (const path of named) assert.ok(existsSync(path), `Missing test: ${relative(root, path)}`);
  const all = ["artifacts/api-server/src", "artifacts/irrigopro/src", "lib/shared/src"]
    .flatMap(dir => scanTests(resolve(root, dir)));
  const counted = all.filter(path => named.has(path));
  console.log(`Manifest names ${named.size} distinct test paths; ${counted.length}/${all.length} source-tree test files named.`);
  for (const path of all.filter(path => !named.has(path))) console.warn(`WARNING unlisted test: ${relative(root, path)}`);
});

test("mixed chained commands change workspace package context", () => {
  const packages = workspacePackages();
  const command = "pnpm --filter @workspace/api-server exec node src/example.test.ts && pnpm --filter @workspace/irrigopro exec vitest src/example.test.tsx && pnpm --filter @workspace/shared exec node src/example.test.cjs";
  assert.deepEqual(namedPaths(command, packages), [
    resolve(packages.get("@workspace/api-server"), "src/example.test.ts"),
    resolve(packages.get("@workspace/irrigopro"), "src/example.test.tsx"),
    resolve(packages.get("@workspace/shared"), "src/example.test.cjs"),
  ]);
  assert.deepEqual(namedPaths(manifest.types[0].command, packages), []);
});

test("runner is serial, continues after exit/signal/spawn failures and summarizes", () => {
  const calls = [];
  const logs = [];
  const outcomes = [{ status: 3 }, { signal: "SIGTERM" }, { error: { code: "ENOENT" } }, { status: 0 }];
  const entries = outcomes.map((_, i) => ({ name: `entry-${i}`, command: `command-${i}` }));
  assert.equal(runLane("types", entries, (program, args, options) => {
    calls.push(args[1]);
    assert.equal(program, "bash");
    assert.equal(options.cwd, root);
    assert.equal(options.stdio, "inherit");
    return outcomes[calls.length - 1];
  }, line => logs.push(line)), 1);
  assert.deepEqual(calls, entries.map(entry => entry.command));
  assert.ok(logs.includes("LANE types: 1 passed, 3 failed"));
  assert.ok(logs.some(line => line.includes("SIGNAL SIGTERM")));
  assert.ok(logs.some(line => line.includes("ERROR ENOENT")));
  assert.equal(runLane("types", [entries[0]], () => ({ status: 0 }), () => {}), 0);
  assert.equal(runLane("types", entries, () => { throw new Error("spawn failed"); }, () => {}), 1);
});

test("invalid lane arguments exit 2 and list valid lanes, from any cwd", () => {
  for (const args of [[], ["unknown"], ["types", "extra"]]) {
    const child = spawnSync(process.execPath, [resolve(root, "scripts/run-validation-lane.mjs"), ...args], { cwd: "/tmp", encoding: "utf8" });
    assert.equal(child.status, 2);
    for (const lane of lanes) assert.ok(child.stderr.includes(lane));
  }
});

test("real synchronous children use the runner root and continue after failure and signal", t => {
  const dir = mkdtempSync(resolve(tmpdir(), "validation-runner-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(resolve(dir, "scripts"));
  writeFileSync(resolve(dir, "scripts/run-validation-lane.mjs"), readFileSync(resolve(root, "scripts/run-validation-lane.mjs")));
  writeFileSync(resolve(dir, "scripts/validation-lanes.json"), JSON.stringify({
    types: [
      { name: "first", command: "printf 'first\\n' > order; exit 7" },
      { name: "signal", command: "printf 'signal\\n' >> order; kill -TERM $$" },
      { name: "last", command: "test \"$(cat order)\" = \"$(printf 'first\\nsignal')\" && printf 'last\\n' >> order" },
    ],
  }));
  const child = spawnSync(process.execPath, [resolve(dir, "scripts/run-validation-lane.mjs"), "types"], { cwd: "/", encoding: "utf8" });
  assert.equal(child.status, 1);
  assert.equal(readFileSync(resolve(dir, "order"), "utf8"), "first\nsignal\nlast\n");
  assert.match(child.stdout, /first \| FAIL 7/);
  assert.match(child.stdout, /signal \| SIGNAL SIGTERM/);
  assert.match(child.stdout, /LANE types: 1 passed, 2 failed/);
});
