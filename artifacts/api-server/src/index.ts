import { createApp } from "./app";
import { resolveChromiumExecutable } from "./chromium-resolver";
import { logger } from "./lib/logger";
import { auditQbTokenEnvironments } from "./qb-boot-audit";
import { validateAspireEncryptionKey } from "./services/aspire-token-service";
import { startAspireCron } from "./cron/aspire-cron";


try {
  const chromiumPath = resolveChromiumExecutable();
  logger.info({ chromiumPath }, "Chromium resolved for PDF generation");
} catch (err) {
  logger.warn(
    { err: err instanceof Error ? err.message : String(err) },
    "Chromium not resolved at startup — PDF generation will fail until a Chromium binary is available",
  );
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Hard-fail if ASPIRE_ENCRYPTION_KEY is missing or malformed.
// All environments require this key — it is used for credential encryption,
// not just in production. The error message explains exactly what to do.
validateAspireEncryptionKey();

function auditProductionEnv(): void {
  if (process.env["NODE_ENV"] !== "production") return;
  const required = [
    "QUICKBOOKS_CLIENT_ID",
    "QUICKBOOKS_CLIENT_SECRET",
    "QUICKBOOKS_REDIRECT_URI",
  ] as const;
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length === 0) {
    logger.info("[boot] QB env vars present");
  } else {
    logger.warn(
      { missing },
      `[boot] QB env vars missing: ${missing.join(", ")} — QuickBooks integration will be unavailable until these are set`,
    );
  }
}

auditProductionEnv();

const { httpServer } = await createApp();

// Mission 7 — start Aspire cron scheduler (health check 02:00 UTC, full sync 03:00 UTC).
// Fire-and-forget; must not block the server from accepting requests.
try {
  startAspireCron();
} catch (err) {
  logger.warn(
    { err: err instanceof Error ? err.message : String(err) },
    "[boot] Aspire cron failed to start — scheduled syncs will not run until restart",
  );
}

// Phase 5a — QB Harden #5: scan existing QB rows for credential/env mismatches.
// Fire-and-forget; must not block the server from accepting requests.
auditQbTokenEnvironments().catch((err) => {
  logger.warn(
    { err: err instanceof Error ? err.message : String(err) },
    "[boot] QB token environment audit threw unexpectedly",
  );
});

httpServer.listen(port, () => {
  logger.info({ port }, "Server listening");
});
