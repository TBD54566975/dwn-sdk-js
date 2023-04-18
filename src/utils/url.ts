const URL_PROTOCOL_REGEX = /^[^:]+:\/\/./;

export function normalizeProtocolUrl(url: string): string {
  let fullUrl: string;
  if (URL_PROTOCOL_REGEX.test(url)) {
    fullUrl = url
  } else {
    fullUrl = `http://${url}`;
  }

  try {
    const { hostname, pathname } = new URL(fullUrl);
    return removeTrailingSlash(hostname + pathname);
  } catch(e) {
    return url;
  }
}

function removeTrailingSlash(str: string): string {
  if (str.endsWith('/')) {
    return str.slice(0, -1);
  } else {
    return str;
  }
}
