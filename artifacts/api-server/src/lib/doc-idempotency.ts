import { and, eq } from "drizzle-orm";
import { irrigationControllers, irrigationPrograms, irrigationBackflows } from "@workspace/db";
import { db } from "../db";

export class DocClientIdConflict extends Error {
  constructor() { super("That client id belongs to another record"); }
}
type Kind = "controller" | "program" | "backflow";
type Parent = { customerId?: number; branchName?: string; controllerId?: number };

// The caller must establish parent ownership before entering this helper.
// Re-read after ANY create failure: existing parent locks may turn a concurrent
// replay into a letter/name conflict before it reaches the client-id index.
export async function idempotentDocCreate<T>(
  kind: Kind, companyId: number, clientId: string | undefined, parent: Parent, create: () => Promise<T>,
): Promise<{ row: T; replayed: boolean }> {
  const table = kind === "controller" ? irrigationControllers : kind === "program" ? irrigationPrograms : irrigationBackflows;
  const find = async (): Promise<T | null> => {
    if (!clientId) return null;
    const [row] = await db.select().from(table).where(and(eq(table.companyId, companyId), eq(table.clientId, clientId)));
    if (!row) return null;
    for (const [key, value] of Object.entries(parent)) {
      if ((row as unknown as Record<string, unknown>)[key] !== value) throw new DocClientIdConflict();
    }
    return row as T;
  };
  const existing = await find();
  if (existing) return { row: existing, replayed: true };
  try { return { row: await create(), replayed: false }; }
  catch (error) {
    const raced = await find();
    if (raced) return { row: raced, replayed: true };
    throw error;
  }
}
