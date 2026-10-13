import type { AppSource } from './types';

const allowedHosts = new Set(['github.com', 'raw.githubusercontent.com']);

export function safeSourceUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('https://') || /[\s\\\u0000-\u001f\u007f]/u.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return null;
  }
  if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname) || url.username || url.password || url.port) return null;
  return url.href;
}

export function sourceLinks(source: AppSource): Readonly<{ original: string | null; license: string | null }> {
  if (source.provenance.kind === 'editorial_draft') return { original: null, license: null };
  return { original: safeSourceUrl(source.provenance.locator), license: safeSourceUrl(source.license.evidence_locator) };
}
