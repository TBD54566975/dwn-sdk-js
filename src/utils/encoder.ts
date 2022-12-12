import { base64url } from 'multiformats/bases/base64';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function base64UrlToBytes(base64urlString: string): Uint8Array {
  const content = base64url.baseDecode(base64urlString);
  return content;
}

export function base64UrlToObject(base64urlString: string): any {
  const payloadBytes = base64url.baseDecode(base64urlString);
  const payloadString = bytesToString(payloadBytes);
  const payloadObject = JSON.parse(payloadString);
  return payloadObject;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  const base64UrlString = base64url.baseEncode(bytes);
  return base64UrlString;
}

export function bytesToString(content: Uint8Array): string {
  const bytes = textDecoder.decode(content);
  return bytes;
}

export function objectToBytes(obj: any): Uint8Array {
  const objectString = JSON.stringify(obj);
  const objectBytes = textEncoder.encode(objectString);
  return objectBytes;
}

export function stringToBase64Url(content: string): string {
  const bytes = textEncoder.encode(content);
  const base64UrlString = base64url.baseEncode(bytes);
  return base64UrlString;
}

export function stringToBytes(content: string): Uint8Array {
  const bytes = textEncoder.encode(content);
  return bytes;
}
