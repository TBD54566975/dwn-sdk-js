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
export async function computeDagPbCid(content: Uint8Array): Promise<string> {
  const asyncDataBlocks = importer([{ content }], undefined, { onlyHash: true, cidVersion: 1 });

  // NOTE: the last block contains the root CID
  let block;
  for await (block of asyncDataBlocks) { ; }

  return block.cid.toString();
}

/**
 * Computes a V1 CID for the provided payload
 * @param payload
 * @param codecCode - the codec to use. Defaults to cbor
 * @param multihashCode - the multihasher to use. Defaults to sha256
 * @returns payload CID
 * @throws {Error} codec is not supported
 * @throws {Error} encoding fails
 * @throws {Error} if hasher is not supported
 */
export async function computeCid(payload: any, codecCode = cbor.code, multihashCode = sha256.code): Promise<string> {
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

  const cid = await CID.createV1(codec.code, payloadHash);
  return cid.toString();
}

export function parseCid(str: string): CID {
  const cid: CID = CID.parse(str).toV1();

  if (!codecs[cid.code]) {
    throw new Error(`codec [${cid.code}] not supported`);
  }

  if (!hashers[cid.multihash.code]) {
    throw new Error(`multihash code [${cid.multihash.code}] not supported`);
  }

  return cid;
}
