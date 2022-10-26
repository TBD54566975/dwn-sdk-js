import * as encoder from '../utils/encoder';
import { CID } from 'multiformats/cid';
import { importer } from 'ipfs-unixfs-importer';

type Data = string | number | boolean | Uint8Array | object;

export function toBytes(data: Data): Uint8Array {
  const { encode } = new TextEncoder();

  if (data instanceof Uint8Array) {
    return data;
  } else if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  } else if (typeof data === 'object') {
    const stringifiedData = JSON.stringify(data);
    return encode(stringifiedData);
  } else {
    return encode(data.toString());
  }
}

export function base64UrlEncode(data: Data): string {
  const dataBytes = toBytes(data);
  return encoder.bytesToBase64Url(dataBytes);
}

/**
 * @returns V1 CID of the DAG comprised by chunking data into unixfs dag-pb encoded blocks
 */
export async function getDagCid(data: Data): Promise<CID> {
  const dataBytes = toBytes(data);
  const chunk = importer([{ content: dataBytes }], undefined, { onlyHash: true, cidVersion: 1 });
  let root;

  for await (root of chunk);

  return root.cid;
}