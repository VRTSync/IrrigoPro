const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const script = path.join(__dirname, "post-merge.sh");

function runSetup(t, output, exitCode = 0) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "post-merge-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const calls = path.join(dir, "calls");
  fs.writeFileSync(path.join(dir, "pnpm"), `#!/bin/bash
printf '%s\\n' "$*" >> "$CALLS"
if [[ "$*" == "--filter @workspace/db push" ]]; then
  if read -r answer; then
    echo "Unexpected stdin input" >&2
    exit 99
  fi
  printf '%s\\n' "$PUSH_OUTPUT"
  exit "$PUSH_EXIT"
fi
`, { mode: 0o755 });
  const result = spawnSync("bash", [script], {
    encoding: "utf8",
    input: "yes\n",
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      CALLS: calls,
      PUSH_OUTPUT: output,
      PUSH_EXIT: String(exitCode),
    },
  });
  assert.ifError(result.error);
  return { ...result, calls: fs.readFileSync(calls, "utf8") };
}

for (const message of ["[✓] Changes applied", "[i] No changes detected"]) {
  test(`setup continues after ${message}`, (t) => {
    const result = runSetup(t, message);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.calls, /--filter @workspace\/db verify\nrun typecheck\n$/);
    assert.doesNotMatch(result.calls, /push-force|--force/);
  });
}

for (const prompt of [
  "You are about to drop a table. Do you want to continue?",
  "Is retired_at created or renamed from another column?",
  "You are about to truncate a table. Do you want to continue?",
]) {
  test(`setup stops on unanswered prompt: ${prompt}`, (t) => {
    const result = runSetup(t, prompt);
    assert.equal(result.status, 1);
    assert.ok(result.stdout.includes(prompt), "The prompt must remain visible");
    assert.match(result.stderr, /No prompt was answered/);
    assert.doesNotMatch(result.calls, /verify|typecheck|push-force|--force/);
  });
}

test("setup stops on push failure even if output contains a completion message", (t) => {
  const result = runSetup(t, "[✓] Changes applied", 7);
  assert.equal(result.status, 7);
  assert.doesNotMatch(result.calls, /verify|typecheck/);
});
