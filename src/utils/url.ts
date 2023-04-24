import { DwnError, DwnErrorCode } from '../core/dwn-error.js';

const URL_PROTOCOL_REGEX = /^[^:]+:\/\/./;

export function validateProtocolUriNormalized(protocol: string): void {
  let normalized: string | undefined;
  try {
    normalized = normalizeProtocolUri(protocol);
  } catch {
    normalized = undefined;
  }

  if (protocol !== normalized) {
    throw new DwnError(DwnErrorCode.ProtocolUriNotNormalized, 'Protocol URI must be normalized.');
  }
}

export function normalizeProtocolUri(url: string): string {
  let fullUrl: string;
  if (URL_PROTOCOL_REGEX.test(url)) {
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
    throw new Error('Could not normalize protocol URI');
  }
}

function removeTrailingSlash(str: string): string {
  if (str.endsWith('/')) {
    return str.slice(0, -1);
  } else {
    return str;
  }
}
