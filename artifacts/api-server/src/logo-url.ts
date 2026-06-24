/**
 * Shared company-logo URL resolver.
 *
 * Handles every shape a stored `companies.logo` value can take and produces
 * an absolute URL that the caller's environment can fetch:
 *
 *   - Empty / missing                 → null
 *   - Full https:// (internal app)    → strip to `${base}/api/company-logo/<uuid>`
 *   - Full https:// (external CDN)    → returned as-is
 *   - `/api/…` relative path          → `${base}/api/…`
 *   - `company-logos/<uuid>`          → `${base}/api/company-logo/<uuid>`
 *   - bare `<uuid>`                   → `${base}/api/company-logo/<uuid>`
 *
 * `baseUrl` is caller-supplied so the same function works for both contexts:
 *   - Email  → APP_BASE_URL (public domain, e.g. https://irrigopro.com)
 *   - PDFs   → http://localhost:<PORT>  (server-side headless Chromium fetch)
 */

const LOGO_PATH_PATTERNS = [
  /\/api\/public-objects\/company-logos\/(.+)/,
  /\/api\/company-logo\/(.+)/,
];

export function resolveCompanyLogoUrl(
  storedLogo: string | null | undefined,
  baseUrl: string,
): string | null {
  if (!storedLogo || !storedLogo.trim()) return null;

  const logo = storedLogo.trim();
  const base = baseUrl.replace(/\/+$/, '');

  if (logo.startsWith('http://') || logo.startsWith('https://')) {
    let pathname: string;
    try {
      pathname = new URL(logo).pathname;
    } catch {
      return logo;
    }
    for (const pattern of LOGO_PATH_PATTERNS) {
      const match = pathname.match(pattern);
      if (match) {
        return `${base}/api/company-logo/${match[1]}`;
      }
    }
    return logo;
  }

  if (logo.startsWith('/api/')) {
    return `${base}${logo}`;
  }

  if (logo.startsWith('/')) {
    return `${base}/api/company-logo${logo}`;
  }

  if (logo.startsWith('company-logos/')) {
    return `${base}/api/company-logo/${logo.slice('company-logos/'.length)}`;
  }

  return `${base}/api/company-logo/${logo}`;
}

/** Convenience: build the localhost base URL used by PDF services. */
export function pdfLogoBaseUrl(): string {
  const port = process.env.PORT || 5000;
  return `http://localhost:${port}`;
}
