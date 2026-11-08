import type { Role } from "./roles.js";

export type ApiRule = { method: "GET" | "POST" | "PUT" | "DELETE"; pattern: RegExp };

// Deliberately absent: GET /api/customers (full billing rows), GET
// /api/customers/:id/controllers-profile (lazy-seeds), GET
// /api/irrigation-controllers/:id, GET /api/customers/:id/backflows, and every
// equipment delete. Slim documentation reads/verification are reserved here;
// this module does not implement those future endpoints.
export const SYSTEM_DOCUMENTER_API: readonly ApiRule[] = [
  { method: "GET", pattern: /^\/api\/system-documentation\/sites$/ },
  { method: "GET", pattern: /^\/api\/system-documentation\/customers\/\d+\/site$/ },
  { method: "POST", pattern: /^\/api\/system-documentation\/customers\/\d+\/site\/(no-backflow|verify)$/ },
  { method: "POST", pattern: /^\/api\/customers\/\d+\/controllers-profile$/ },
  { method: "PUT", pattern: /^\/api\/irrigation-controllers\/\d+$/ },
  { method: "POST", pattern: /^\/api\/irrigation-controllers\/\d+\/(programs|photo|field-verify)$/ },
  { method: "PUT", pattern: /^\/api\/irrigation-controllers\/\d+\/(zone-count|zones\/bulk)$/ },
  { method: "PUT", pattern: /^\/api\/irrigation-programs\/\d+$/ },
  { method: "DELETE", pattern: /^\/api\/irrigation-programs\/\d+$/ },
  { method: "POST", pattern: /^\/api\/customers\/\d+\/backflows$/ },
  { method: "PUT", pattern: /^\/api\/backflows\/\d+$/ },
  { method: "POST", pattern: /^\/api\/backflows\/\d+\/(log-test|field-verify)$/ },
  { method: "POST", pattern: /^\/api\/upload\/photo$/ },
  { method: "POST", pattern: /^\/api\/upload\/photo\/finalize$/ },
  { method: "POST", pattern: /^\/api\/photos\/signed-urls$/ },
  { method: "GET", pattern: /^\/api\/photos\/.+$/ },
];

export const ROLE_API_ALLOWLISTS: Partial<Record<Role, readonly ApiRule[]>> = {
  system_documenter: SYSTEM_DOCUMENTER_API,
};

export function hasRoleApiAllowlist(role: string | null | undefined): boolean {
  return typeof role === "string" && Object.prototype.hasOwnProperty.call(ROLE_API_ALLOWLISTS, role);
}

export function isApiAllowedForRole(role: string | null | undefined, method: string, path: string): boolean {
  if (!hasRoleApiAllowlist(role)) return true;
  const normalizedMethod = method.toUpperCase();
  const effectiveMethod = normalizedMethod === "HEAD" ? "GET" : normalizedMethod;
  const pathname = path.split("?")[0];
  return ROLE_API_ALLOWLISTS[role as Role]!.some(rule =>
    rule.method === effectiveMethod && rule.pattern.test(pathname));
}
