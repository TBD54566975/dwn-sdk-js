import * as cbor from '@ipld/dag-cbor';

import { CID } from 'multiformats/cid';
import { importer } from 'ipfs-unixfs-importer';
import { sha256 } from 'multiformats/hashes/sha2';

// a map of all supported CID hashing algorithms. This map is used to select the appropriate hasher
// when generating a CID to compare against a provided CID
const hashers = {
  [sha256.code]: sha256,
};

// a map of all support codecs.This map is used to select the appropriate codec
// when generating a CID to compare against a provided CID
const codecs = {
  [cbor.code]: cbor
};


/**
 * @returns V1 CID of the DAG comprised by chunking data into unixfs dag-pb encoded blocks
 */
export async function getDagPbCid(content: Uint8Array): Promise<CID> {
  const chunk = importer([{ content }], undefined, { onlyHash: true, cidVersion: 1 });
  let root;

  for await (root of chunk) { ; }

  return root.cid;
}

/**
 * generates a V1 CID for the provided payload
 * @param payload
 * @param codecCode - the codec to use. Defaults to cbor
 * @param multihashCode - the multihasher to use. Defaults to sha256
 * @returns payload CID
 * @throws {Error} codec is not supported
 * @throws {Error} encoding fails
 * @throws {Error} if hasher is not supported
 */
export async function generateCid(payload: any, codecCode = cbor.code, multihashCode = sha256.code): Promise<CID> {
  const codec = codecs[codecCode];
  if (!codec) {
    throw new Error(`codec [${codecCode}] not supported`);
  }

  const hasher = hashers[multihashCode];
  if (!hasher) {
    throw new Error(`multihash code [${multihashCode}] not supported`);
  }

  const payloadBytes = codec.encode(payload);
  const payloadHash = await hasher.digest(payloadBytes);

  return await CID.createV1(codec.code, payloadHash);
}

export function parseCid(str: string): CID {
  const cid = CID.parse(str).toV1();

  if (!codecs[cid.code]) {
    throw new Error(`codec [${cid.code}] not supported`);
  }

  if (!hashers[cid.multihash.code]) {
    throw new Error(`multihash code [${cid.multihash.code}] not supported`);
  }

  return cid;
}
