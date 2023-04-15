export function normalizeProtocolUrl(url: string): string {
  const fullUrl = url.includes('://') ? url : `http://${url}`;
  const { hostname, pathname } = new URL(fullUrl);
  return removeTrailingSlash(hostname + pathname);
}

function removeTrailingSlash(str: string): string {
  if (str.endsWith('/')) {
    return str.slice(0, -1);
  } else {
    return str;
  }
}