import { companyEmailWording } from "@workspace/db/schema";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { wordingFields, type EmailKey } from "./wording";

export function emailWordingScope(companyId: number, key: EmailKey) {
  return and(eq(companyEmailWording.companyId, companyId), eq(companyEmailWording.emailKey, key));
}

export async function findEmailWordingOverride(companyId: number, key: EmailKey) {
  const [row] = await db.select().from(companyEmailWording).where(emailWordingScope(companyId, key));
  return row ? wordingFields(row) : undefined;
}
