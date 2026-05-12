// Task #554 — single source of truth for the catalog of external
// integrations we monitor. Imported by both the App Health
// integrations endpoint (cards / table) and the
// `integrationDownRule` (incident `runbookUrl` + `details.service`)
// so the active-incident banner and the integrations tab can never
// disagree about a service's runbook.

export type IntegrationMeta = {
  service: string;
  label: string;
  purpose: string;
  runbookUrl: string;
};

export const INTEGRATION_CATALOG: IntegrationMeta[] = [
  { service: "qb",        label: "QuickBooks",        purpose: "Accounting / invoice sync",                  runbookUrl: "https://github.com/replit/irrigopro-runbooks/blob/main/integrations/qb.md" },
  { service: "stripe",    label: "Stripe",            purpose: "Payments + customer billing",                runbookUrl: "https://github.com/replit/irrigopro-runbooks/blob/main/integrations/stripe.md" },
  { service: "twilio",    label: "Twilio (SMS)",      purpose: "Tech & customer SMS notifications",          runbookUrl: "https://github.com/replit/irrigopro-runbooks/blob/main/integrations/twilio.md" },
  { service: "sendgrid",  label: "SendGrid",          purpose: "Transactional email delivery",               runbookUrl: "https://github.com/replit/irrigopro-runbooks/blob/main/integrations/sendgrid.md" },
  { service: "email",     label: "Email (generic)",   purpose: "Outbound email (legacy / fallback)",         runbookUrl: "https://github.com/replit/irrigopro-runbooks/blob/main/integrations/email.md" },
  { service: "sms",       label: "SMS (generic)",     purpose: "Outbound SMS (legacy / fallback)",           runbookUrl: "https://github.com/replit/irrigopro-runbooks/blob/main/integrations/sms.md" },
  { service: "mapbox",    label: "Mapbox",            purpose: "Site-map tiles + geocoding",                 runbookUrl: "https://github.com/replit/irrigopro-runbooks/blob/main/integrations/mapbox.md" },
  { service: "storage",   label: "Object Storage",    purpose: "Photo + PDF storage (App Storage)",          runbookUrl: "https://github.com/replit/irrigopro-runbooks/blob/main/integrations/storage.md" },
  { service: "s3",        label: "S3",                purpose: "Legacy object storage (AWS S3)",             runbookUrl: "https://github.com/replit/irrigopro-runbooks/blob/main/integrations/s3.md" },
  { service: "pdf",       label: "PDF Renderer",      purpose: "Estimate / invoice PDF generation",          runbookUrl: "https://github.com/replit/irrigopro-runbooks/blob/main/integrations/pdf.md" },
  { service: "puppeteer", label: "Puppeteer",         purpose: "Headless browser rendering for PDFs",        runbookUrl: "https://github.com/replit/irrigopro-runbooks/blob/main/integrations/puppeteer.md" },
  { service: "postgres",  label: "PostgreSQL",        purpose: "Primary database (Neon)",                    runbookUrl: "https://github.com/replit/irrigopro-runbooks/blob/main/integrations/postgres.md" },
  { service: "redis",     label: "Redis",             purpose: "Cache + rate limit (optional)",              runbookUrl: "https://github.com/replit/irrigopro-runbooks/blob/main/integrations/redis.md" },
];

export const INTEGRATION_CATALOG_BY_SERVICE = new Map<string, IntegrationMeta>(
  INTEGRATION_CATALOG.map((m) => [m.service, m]),
);

const DEFAULT_RUNBOOK = "https://github.com/replit/irrigopro-runbooks/blob/main/integrations/README.md";

export function getIntegrationMeta(service: string): IntegrationMeta {
  const m = INTEGRATION_CATALOG_BY_SERVICE.get(service);
  if (m) return m;
  return {
    service,
    label: service,
    purpose: "Uncatalogued integration — add to INTEGRATION_CATALOG.",
    runbookUrl: DEFAULT_RUNBOOK,
  };
}

// `integration.<svc>.<op>.failed` / similar. The `service` is the
// leading segment immediately after `integration.` if present, else
// the leading segment of the full name. Mirrors the SQL
// `split_part(component, '.', 1)` behaviour and the rule's grouping.
export function serviceFromEventName(name: string): string {
  if (!name) return "unknown";
  const stripped = name.startsWith("integration.") ? name.slice("integration.".length) : name;
  const head = stripped.split(".", 1)[0] ?? stripped;
  return head || "unknown";
}
