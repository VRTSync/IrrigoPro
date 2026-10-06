---
name: Validation run thread/PID exhaustion
description: Diagnose parallel validation resource failures from actual process limits and logs; preserve user-required gates and use bounded direct runs for evidence.
---

Completion validation runs every registered command **concurrently**. Symptoms of exhaustion:
`Error: EAGAIN`, `pthread_create: Resource temporarily unavailable`, `uv_thread_create`,
tinypool `Worker exited unexpectedly`, pino `ERR_WORKER_INIT_FAILED`.

These are never assertion failures. Confirm by reading the inspect log: if there is no
assertion error, the code under test is not what broke.

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

For a focused Vitest validation under PID pressure, setting only `--maxWorkers=1`
can fail before tests run with "options.minThreads and options.maxThreads must not
conflict." Set **both** `--maxWorkers=1 --minWorkers=1` (or use the single-fork
mode above) and give UI tests a realistic timeout when other jobs share the host.

**Why:** Vitest's configured/default minimum worker count can exceed a CLI
maximum of one; that configuration failure is unrelated to the assertions.

**How to apply:** Limit both worker bounds together only when the user permits changing
or registering focused commands. Preserve existing command flags and timeouts otherwise.
