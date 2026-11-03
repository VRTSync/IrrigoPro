import { eq } from "drizzle-orm";
import { companies } from "@workspace/db/schema";
import { db } from "../db";

export type CustomerRecordsLock = { locked: boolean; systemName: string | null };

/** Reads one company's lock. A missing company reads as unlocked. */
export async function getCustomerRecordsLock(companyId: number): Promise<CustomerRecordsLock> {
  const [row] = await db
    .select({ locked: companies.customerRecordsLocked, systemName: companies.customerRecordsSystemName })
    .from(companies).where(eq(companies.id, companyId)).limit(1);
  return { locked: row?.locked ?? false, systemName: row?.systemName ?? null };
}
