import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const lanes = ["api-billing", "api-field", "web", "types"];

export function runLane(lane, entries, spawn = spawnSync, log = console.log) {
  const results = [];
  for (const [index, entry] of entries.entries()) {
    log(`=== [${lane}] (${index + 1}/${entries.length}) ${entry.name} ===`);
    const start = performance.now();
    let child;
    try {
      child = spawn("bash", ["-c", entry.command], { stdio: "inherit", cwd: root });
    } catch (error) {
      child = { error };
    }
    const passed = !child.error && !child.signal && child.status === 0;
    const status = child.error ? `ERROR ${child.error.code ?? child.error.message}`
      : child.signal ? `SIGNAL ${child.signal}`
        : passed ? "PASS" : `FAIL ${child.status ?? "unknown"}`;
    const result = { name: entry.name, status, seconds: ((performance.now() - start) / 1000).toFixed(2), passed };
    results.push(result);
    log(`${result.name} | ${result.status} | ${result.seconds}`);
  }
  log("\nname | status | seconds");
  for (const result of results) log(`${result.name} | ${result.status} | ${result.seconds}`);
  const passed = results.filter(result => result.passed).length;
  log(`LANE ${lane}: ${passed} passed, ${results.length - passed} failed`);
  return results.some(result => !result.passed) ? 1 : 0;
}

export function main(args = process.argv.slice(2)) {
  if (args.length !== 1 || !lanes.includes(args[0])) {
    console.error(`Usage: node scripts/run-validation-lane.mjs <lane>\nValid lanes: ${lanes.join(", ")}`);
    return 2;
  }
  const manifest = JSON.parse(readFileSync(resolve(root, "scripts/validation-lanes.json"), "utf8"));
  return runLane(args[0], manifest[args[0]]);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
