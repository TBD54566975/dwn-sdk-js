import { base64url } from 'multiformats/bases/base64';

const textEncoder = new TextEncoder();


export function stringToBytes(content: string): Uint8Array {
  const bytes = textEncoder.encode(content);
  return bytes;
}

export function stringToBase64Url(content: string): string {
  const bytes = textEncoder.encode(content);
  const base64UrlString = base64url.baseEncode(bytes);
  return base64UrlString;
}


export function bytesToBase64Url(bytes: Uint8Array): string {
  const base64UrlString = base64url.baseEncode(bytes);
  return base64UrlString;
}
