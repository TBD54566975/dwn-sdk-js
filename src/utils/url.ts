import { DwnError, DwnErrorCode } from '../core/dwn-error.js';

export function validateProtocolUriNormalized(uri: string): void {
  let normalized: string | undefined;
  try {
    normalized = normalizeProtocolUri(uri);
  } catch {
    normalized = undefined;
  }

  if (uri !== normalized) {
    throw new DwnError(DwnErrorCode.UrlProtocolNotNormalized, `Protocol URI ${uri} must be normalized.`);
  }
}

export function normalizeProtocolUri(url: string): string {
  // Keeping protocol normalization as a separate function in case
  // protocol and schema normalization diverge in the future
  return normalizeUri(url);
}

export function validateSchemaUriNormalized(uri: string): void {
  let normalized: string | undefined;
  try {
    normalized = normalizeSchemaUri(uri);
  } catch {
    normalized = undefined;
  }

  if (uri !== normalized) {
    throw new DwnError(DwnErrorCode.UrlSchemaNotNormalized, `Schema URI ${uri} must be normalized.`);
  }
}

export function normalizeSchemaUri(url: string): string {
  // Keeping schema normalization as a separate function in case
  // protocol and schema normalization diverge in the future
  return normalizeUri(url);
}

function normalizeUri(url: string): string {
  let fullUrl: string;
  if (/^[^:]+:\/\/./.test(url)) {
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
    throw new DwnError(DwnErrorCode.UrlPrococolNotNormalizable, 'Could not normalize protocol URI');
  }
}

function removeTrailingSlash(str: string): string {
  if (str.endsWith('/')) {
    return str.slice(0, -1);
  } else {
    return str;
  }
}
