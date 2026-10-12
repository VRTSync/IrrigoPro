---
name: Validation run thread/PID exhaustion
description: Diagnose parallel validation resource failures from actual process limits and logs; preserve user-required gates and use bounded direct runs for evidence.
---

Completion validation runs four serial lanes concurrently. Symptoms of exhaustion:
`Error: EAGAIN`, `pthread_create: Resource temporarily unavailable`, `uv_thread_create`,
tinypool `Worker exited unexpectedly`, pino `ERR_WORKER_INIT_FAILED`.

These are never assertion failures. Confirm by reading the inspect log: if there is no
assertion error, the code under test is not what broke.

The gate now uses four serial lanes, so resource errors with this bounded fan-out
are regressions to investigate, not background noise. Four bounds top-level suite
trees only; Node/Vitest threads and workers are not capped at four. Preserve the
diagnostic cautions below: assertion failures, infrastructure failures, and missing
results are different evidence, and an unavailable result is never a pass.

**Why:** a previous container had a 1024-process cgroup cap and roughly 309 PIDs in use
at idle. The cap is environment-dependent, not a project constant. Each Vitest suite
spawns pnpm, Node, and workers, while Node itself uses multiple threads. Large parallel
runs can exhaust that budget. An inability to retrieve validation results is not, by
itself, evidence of process exhaustion.

**How to apply — and when to STOP:**
1. Read `/sys/fs/cgroup/pids.max` and `/sys/fs/cgroup/pids.current`, then inspect actual
   command logs before diagnosing resource exhaustion.
2. Re-run the affected suites directly with the original registered commands, serially
   or with user-approved bounded batches. Do not change assertions, worker flags, or
   timeouts when the user requires the commands and gate to remain unchanged.
3. Retry completion once only if the user has not instructed you to stop.
4. **Stop condition:** If consecutive runs fail with confirmed resource errors and a
   shifting failure set, stop repeating the same oversized fan-out. Report direct-run
   evidence separately from completion-gate status. Do not bypass the gate when the user
   requires it unchanged; passing direct runs do not authorize a validation skip.

A shifting failure set with resource errors is a useful diagnostic signal, not proof
that every unreported failure has the same cause.

Under bounded-lane load, distinguish test lifecycle races from product failures:
awaiting one scheduler tick is not necessarily joining work started by another
tick. Tests must observe durable completion/requeue state before changing a
failure fixture, advancing an injected clock, or asserting delivery.

**Why:** An offline recovery test advanced through a background dispatch using a
single event-loop turn, while another test spent most of its timed body importing
an unrelated closed wizard. Neither isolated pass nor a concurrency-only failure
alone identified the cause.

**How to apply:** Measure import versus render/assertion cost, validate fixtures
against the real response contract, and await the actual outcome. Keep relevant
components real; isolate unrelated features locally rather than widening
timeouts. Verify targeted fixes under the unchanged concurrent lanes.

For a focused Vitest validation under PID pressure, setting only `--maxWorkers=1`
can fail before tests run with "options.minThreads and options.maxThreads must not
conflict." Set **both** `--maxWorkers=1 --minWorkers=1` (or use the single-fork
mode above) and give UI tests a realistic timeout when other jobs share the host.

**Why:** Vitest's configured/default minimum worker count can exceed a CLI
maximum of one; that configuration failure is unrelated to the assertions.

**How to apply:** Limit both worker bounds together only when the user permits changing
or registering focused commands. Preserve existing command flags and timeouts otherwise.

## Merge setup and retired workflow processes
Inspect live processes as well as the current workflow list after removing many
workflows. Retired test process trees can outlive their configuration while setup
is waiting to finish; do not infer bounded load from the new lane configuration.

**Why:** A merge setup timed out under leftover retired check processes even though
the four replacement lanes were idle. The SIGTERM in the typecheck log came from
the setup deadline, not a reported compiler diagnostic. No OOM kill or PID-limit
failure was recorded.

**How to apply:** Match retired commands and isolated process groups before stopping
obsolete checks; never broadly kill Node processes. Keep merge-time compiler work
serial without removing coverage or altering the four validation lane commands.
Re-run setup and distinguish its result from completion-lane validation.

After reconciliation, check managed workflow status rather than trusting the
reconciliation success flag alone.

**Why:** Leftover dev servers can still serve a healthy preview while replacement
managed workflows fail with port-in-use errors, so a screenshot alone misses the
ownership problem.

**How to apply:** Identify the actual listener, its artifact working directory,
and its process group before stopping an obsolete server; restart the existing
managed service and verify its running state and expected port.
