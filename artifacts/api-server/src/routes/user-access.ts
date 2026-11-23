import { z } from "zod/v4";

const SECRET_USER_FIELDS = [
  "password", "mfaSecret", "mfaBackupCodes",
  "passwordResetToken", "passwordResetExpires",
  "emailVerificationToken", "emailVerificationExpires",
  "hourlyWage",
] as const;

export function toPublicUser<T extends Record<string, unknown>>(
  user: T,
): Omit<T, typeof SECRET_USER_FIELDS[number]> {
  const publicUser = { ...user };
  for (const field of SECRET_USER_FIELDS) delete publicUser[field];
  return publicUser;
}

export type ManageVerdict = "ok" | "forbidden" | "not_found";

type UserIdentity = { id: number; role: string; companyId: number | null };

export function canManageUser(
  caller: { id?: number; role?: string; companyId?: number | null },
  target: UserIdentity | undefined,
  action: "manage" | "delete" | "deactivate",
): ManageVerdict {
  if (!target) return "not_found";
  const removingSelf = action !== "manage" && target.id === caller.id;
  if (caller.role === "super_admin") return removingSelf ? "forbidden" : "ok";
  if (caller.role !== "company_admin") return "forbidden";
  if (target.companyId !== caller.companyId || target.role === "super_admin") return "not_found";
  return removingSelf ? "forbidden" : "ok";
}

export const selfProfilePatch = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().email().max(320).optional(),
}).strict();
