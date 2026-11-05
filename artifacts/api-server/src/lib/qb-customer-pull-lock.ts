/** A dedicated session owns both lock operations, never a pooled one-off query. */
export function createCustomerPullRealmLock(pool: {
  connect(): Promise<{
    query(sql: string, values: string[]): Promise<{ rows: Array<{ acquired?: boolean }> }>;
    release(error?: Error): void;
  }>;
}) {
  return async function withRealmLock<T>(realmId: string, fn: () => Promise<T>):
    Promise<{ acquired: true; value: T } | { acquired: false }> {
    const client = await pool.connect();
    let acquired = false;
    let releaseError: Error | undefined;
    try {
      const result = await client.query(
        "SELECT pg_try_advisory_lock(hashtext('qb-customer-pull:' || $1::text)) AS acquired", [realmId]);
      acquired = result.rows[0]?.acquired === true;
      if (!acquired) return { acquired: false };
      return { acquired: true, value: await fn() };
    } finally {
      try {
        if (acquired) await client.query(
          "SELECT pg_advisory_unlock(hashtext('qb-customer-pull:' || $1::text))", [realmId]);
      } catch (error) {
        // Never return a potentially still-locked session to the pool.
        releaseError = error instanceof Error ? error : new Error(String(error));
        throw error;
      } finally {
        client.release(releaseError);
      }
    }
  };
}
