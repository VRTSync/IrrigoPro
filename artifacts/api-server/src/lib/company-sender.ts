import type { Company } from "@workspace/db";
import { storage } from "../storage";
import { db } from "../db";
import { companies } from "@workspace/db/schema";
import { and, eq, isNull } from "drizzle-orm";

export const DEFAULT_FROM_EMAIL =
  process.env.SENDGRID_FROM_EMAIL ||
  process.env.FROM_EMAIL ||
  process.env.POSTMARK_FROM_EMAIL ||
  "estimates@highplainsprop.com";
export const SENDGRID_FROM_NAME = process.env.SENDGRID_FROM_NAME || "High Plains Irrigation Team";

export interface CompanySender {
  from: { email: string; name: string };
  replyTo: string | undefined;
  usingCompanyAddress: boolean;
}

type SenderCompany = Pick<Company, "name" | "email" | "emailSendingDomain" |
  "emailDomainVerifiedAt" | "emailFromName" | "emailFromAddress" | "emailReplyTo">;
const nonBlank = (value: string | null | undefined) => value?.trim() || undefined;

export function senderFromCompany(company: SenderCompany | undefined): CompanySender {
  const address = nonBlank(company?.emailFromAddress);
  const usingCompanyAddress = Boolean(address && company?.emailSendingDomain &&
    company.emailDomainVerifiedAt && address.split("@")[1]?.toLowerCase() === company.emailSendingDomain);
  return {
    from: {
      email: usingCompanyAddress ? address! : DEFAULT_FROM_EMAIL,
      name: nonBlank(company?.emailFromName) || nonBlank(company?.name) || SENDGRID_FROM_NAME,
    },
    replyTo: nonBlank(company?.emailReplyTo) || (usingCompanyAddress ? address : undefined) || nonBlank(company?.email),
    usingCompanyAddress,
  };
}

export async function resolveCompanySender(companyId: number): Promise<CompanySender> {
  return senderFromCompany(await storage.getCompanyProfile(companyId));
}

export async function checkSendingDomain(domain: string): Promise<{ verified: boolean; error: string | null }> {
  const key = process.env.SENDGRID_API_KEY;
  if (!key) return { verified: false, error: "Email is not configured (SENDGRID_API_KEY missing)." };
  try {
    const response = await fetch(`https://api.sendgrid.com/v3/whitelabel/domains?domain=${encodeURIComponent(domain)}&limit=50`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15000),
    });
    if (response.status === 401 || response.status === 403) {
      return { verified: false, error: "The SendGrid API key cannot read Sender Authentication. Give the key read access to Sender Authentication in SendGrid." };
    }
    if (!response.ok) return { verified: false, error: `Could not reach SendGrid (${response.status}).` };
    const entries = await response.json() as Array<{ domain: string; valid: boolean }>;
    const matches = entries.filter((entry) => entry.domain?.toLowerCase() === domain);
    if (matches.some((entry) => entry.valid === true)) return { verified: true, error: null };
    return { verified: false, error: matches.length
      ? `${domain} is in SendGrid but its DNS records are not validated yet.`
      : `${domain} is not an authenticated domain in SendGrid.` };
  } catch (error) {
    return { verified: false, error: `Could not reach SendGrid (${error instanceof Error ? error.message : String(error)}).` };
  }
}

export async function recheckCompanyDomain(companyId: number): Promise<void> {
  const company = await storage.getCompanyProfile(companyId);
  if (!company) return;
  const domain = company.emailSendingDomain;
  const result = domain ? await checkSendingDomain(domain) : null;
  // Do not let a slow check overwrite the verification for a newly assigned domain.
  await db.update(companies).set({
    emailDomainVerifiedAt: result?.verified ? new Date() : null,
    emailDomainCheckedAt: result ? new Date() : null,
    emailDomainCheckError: result?.error ?? null,
  }).where(and(eq(companies.id, companyId), domain ? eq(companies.emailSendingDomain, domain) : isNull(companies.emailSendingDomain)));
}
