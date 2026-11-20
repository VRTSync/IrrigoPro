export function emailBaseUrl(): string {
  // APP_BASE_URL must be set to the public domain in production
  // (e.g. https://irrigopro.com) so that logo <img> tags and approval-page
  // links embedded in outgoing emails are reachable by email recipients.
  // Without it, logo URLs and approval links will point to the Replit
  // preview domain, which may not be publicly accessible.
  if (process.env.APP_BASE_URL) {
    return process.env.APP_BASE_URL.replace(/\/$/, '');
  }

  if (process.env.NODE_ENV === 'production') {
    console.warn(
      '[email-service] APP_BASE_URL is not set in production — ' +
      'logo and approval-page URLs in outgoing emails may not be reachable by recipients.',
    );
    return 'https://irrigopro.com';
  }

  // Development: use the current Replit preview domain if available
  const replitDomain = process.env.REPLIT_DOMAINS?.split(',')[0];
  if (replitDomain) {
    return `https://${replitDomain}`;
  }

  return `https://${process.env.REPL_ID}.${process.env.REPL_OWNER}.replit.dev`;
}
