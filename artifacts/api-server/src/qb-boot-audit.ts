/**
 * Phase 5a — QB Harden #5: boot-time credential environment audit.
 *
 * Queries every quickbooks_integration row and logs a P1 warning for any row
 * whose tokenEnvironment does not match the server's expected environment
 * (derived from NODE_ENV).  No rows are modified or disconnected.
 */
import { db, quickbooksIntegration } from "@workspace/db";
import { logger } from "./lib/logger";

export async function auditQbTokenEnvironments(): Promise<void> {
  const serverEnv =
    process.env["NODE_ENV"] === "production" ? "production" : "sandbox";
  try {
    const rows = await db
      .select({
        companyId: quickbooksIntegration.companyId,
        realmId: quickbooksIntegration.realmId,
        tokenEnvironment: quickbooksIntegration.tokenEnvironment,
      })
      .from(quickbooksIntegration);

    for (const row of rows) {
      if (row.tokenEnvironment !== serverEnv) {
        logger.warn(
          {
            companyId: row.companyId,
            realmId: row.realmId,
            tokenEnvironment: row.tokenEnvironment,
            serverEnvironment: serverEnv,
          },
          `[boot] QB credential environment mismatch — tokenEnvironment="${row.tokenEnvironment}" but server is "${serverEnv}"`,
        );
      }
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[boot] QB environment audit failed — could not query quickbooks_integration",
    );
  }
}
