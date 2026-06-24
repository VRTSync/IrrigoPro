import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCompanyLogoUrl } from './logo-url.js';

const BASE = 'https://irrigopro.com';

describe('resolveCompanyLogoUrl — null/empty inputs', () => {
  it('returns null for null', () => {
    assert.equal(resolveCompanyLogoUrl(null, BASE), null);
  });

  it('returns null for undefined', () => {
    assert.equal(resolveCompanyLogoUrl(undefined, BASE), null);
  });

  it('returns null for empty string', () => {
    assert.equal(resolveCompanyLogoUrl('', BASE), null);
  });

  it('returns null for whitespace-only string', () => {
    assert.equal(resolveCompanyLogoUrl('   ', BASE), null);
  });
});

describe('resolveCompanyLogoUrl — full https:// internal app path', () => {
  it('rewrites /api/public-objects/company-logos/<uuid> shape to canonical endpoint', () => {
    const uuid = 'abc123-def456';
    const stored = `https://irrigopro.com/api/public-objects/company-logos/${uuid}`;
    assert.equal(
      resolveCompanyLogoUrl(stored, BASE),
      `${BASE}/api/company-logo/${uuid}`,
    );
  });

  it('rewrites /api/company-logo/<uuid> shape (avoids double-wrapping)', () => {
    const uuid = 'abc123-def456';
    const stored = `https://irrigopro.com/api/company-logo/${uuid}`;
    assert.equal(
      resolveCompanyLogoUrl(stored, BASE),
      `${BASE}/api/company-logo/${uuid}`,
    );
  });

  it('strips a trailing slash from the base before building the URL', () => {
    const uuid = 'abc123-def456';
    const stored = `https://irrigopro.com/api/company-logo/${uuid}`;
    assert.equal(
      resolveCompanyLogoUrl(stored, BASE + '/'),
      `${BASE}/api/company-logo/${uuid}`,
    );
  });

  it('uses the caller-supplied base, not the one embedded in the stored URL', () => {
    const uuid = 'abc123-def456';
    const stored = `https://old-domain.com/api/company-logo/${uuid}`;
    const localBase = 'http://localhost:5000';
    assert.equal(
      resolveCompanyLogoUrl(stored, localBase),
      `${localBase}/api/company-logo/${uuid}`,
    );
  });
});

describe('resolveCompanyLogoUrl — full https:// external CDN', () => {
  it('returns an external CDN URL unchanged', () => {
    const cdnUrl = 'https://cdn.example.com/logos/company-123.png';
    assert.equal(resolveCompanyLogoUrl(cdnUrl, BASE), cdnUrl);
  });

  it('returns an http:// external URL unchanged', () => {
    const externalUrl = 'http://assets.example.com/logo.png';
    assert.equal(resolveCompanyLogoUrl(externalUrl, BASE), externalUrl);
  });
});

describe('resolveCompanyLogoUrl — /api/… relative path', () => {
  it('prepends base to /api/company-logo/<uuid>', () => {
    const uuid = 'abc123-def456';
    const stored = `/api/company-logo/${uuid}`;
    assert.equal(
      resolveCompanyLogoUrl(stored, BASE),
      `${BASE}/api/company-logo/${uuid}`,
    );
  });

  it('prepends base to any /api/… path as-is', () => {
    const stored = '/api/public-objects/company-logos/abc123';
    assert.equal(
      resolveCompanyLogoUrl(stored, BASE),
      `${BASE}/api/public-objects/company-logos/abc123`,
    );
  });
});

describe('resolveCompanyLogoUrl — company-logos/<uuid> shape', () => {
  it('strips the company-logos/ prefix and routes to the canonical endpoint', () => {
    const uuid = 'abc123-def456';
    const stored = `company-logos/${uuid}`;
    assert.equal(
      resolveCompanyLogoUrl(stored, BASE),
      `${BASE}/api/company-logo/${uuid}`,
    );
  });

  it('works with a uuid that contains hyphens', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const stored = `company-logos/${uuid}`;
    assert.equal(
      resolveCompanyLogoUrl(stored, BASE),
      `${BASE}/api/company-logo/${uuid}`,
    );
  });
});

describe('resolveCompanyLogoUrl — bare <uuid> shape', () => {
  it('wraps a bare uuid in the canonical endpoint', () => {
    const uuid = 'abc123-def456';
    assert.equal(
      resolveCompanyLogoUrl(uuid, BASE),
      `${BASE}/api/company-logo/${uuid}`,
    );
  });

  it('wraps a UUID v4 string in the canonical endpoint', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    assert.equal(
      resolveCompanyLogoUrl(uuid, BASE),
      `${BASE}/api/company-logo/${uuid}`,
    );
  });
});
