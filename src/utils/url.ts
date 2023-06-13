import { DwnError, DwnErrorCode } from '../core/dwn-error.js';

export function validateProtocolUrlNormalized(url: string): void {
  let normalized: string | undefined;
  try {
    normalized = normalizeProtocolUrl(url);
  } catch {
    normalized = undefined;
  }

  if (url !== normalized) {
    throw new DwnError(DwnErrorCode.UrlProtocolNotNormalized, `Protocol URI ${url} must be normalized.`);
  }
}

export function normalizeProtocolUrl(url: string): string {
  // Keeping protocol normalization as a separate function in case
  // protocol and schema normalization diverge in the future
  return normalizeUrl(url);
}

export function validateSchemaUrlNormalized(url: string): void {
  let normalized: string | undefined;
  try {
    normalized = normalizeSchemaUrl(url);
  } catch {
    normalized = undefined;
  }

  if (url !== normalized) {
    throw new DwnError(DwnErrorCode.UrlSchemaNotNormalized, `Schema URI ${url} must be normalized.`);
  }
}

export function normalizeSchemaUrl(url: string): string {
  // Keeping schema normalization as a separate function in case
  // protocol and schema normalization diverge in the future
  return normalizeUrl(url);
}

function normalizeUrl(url: string): string {
  let fullUrl: string;
  if (/^[^:]+:(\/{2})?[^\/].*/.test(url)) {
    fullUrl = url;
  } else {
    fullUrl = `http://${url}`;
  }

  try {
    const result = new URL(fullUrl);
    result.search = '';
    result.hash = '';
    return removeTrailingSlash(result.href);
  } catch (e) {
    throw new DwnError(DwnErrorCode.UrlProtocolNotNormalizable, 'Could not normalize protocol URI');
  }
}

function removeTrailingSlash(str: string): string {
  if (str.endsWith('/')) {
    return str.slice(0, -1);
  } else {
    return str;
  }
}
