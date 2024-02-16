import * as cbor from '@ipld/dag-cbor';

import type { Readable } from 'readable-stream';

import { BlockstoreMock } from '../store/blockstore-mock.js';
import { CID } from 'multiformats/cid';
import { importer } from 'ipfs-unixfs-importer';
import { sha256 } from 'multiformats/hashes/sha2';
import { DwnError, DwnErrorCode } from '../core/dwn-error.js';

// a map of all supported CID hashing algorithms. This map is used to select the appropriate hasher
// when generating a CID to compare against a provided CID
const hashers = {
  [sha256.code as number]: sha256,
};

// a map of all support codecs.This map is used to select the appropriate codec
// when generating a CID to compare against a provided CID
const codecs = {
  [cbor.code as number]: cbor
};

/**
 * Utility class for creating CIDs. Exported for the convenience of developers.
 */
export class Cid {

  /**
   * Computes a V1 CID for the provided payload
   * @param codecCode - the codec to use. Defaults to cbor
   * @param multihashCode - the multihasher to use. Defaults to sha256
   * @returns payload CID
   * @throws {Error} codec is not supported
   * @throws {Error} encoding fails
   * @throws {Error} if hasher is not supported
   */
  public static async computeCid(
    payload: any,
    codecCode: number = cbor.code,
    multihashCode: number = sha256.code
  ): Promise<string> {
    const codec = codecs[codecCode];
    if (!codec) {
      throw new DwnError(DwnErrorCode.ComputeCidCodecNotSupported, `codec [${codecCode}] not supported`);
    }

    const hasher = hashers[multihashCode];
    if (!hasher) {
      throw new DwnError(DwnErrorCode.ComputeCidMultihashNotSupported, `multihash code [${multihashCode}] not supported`);
    }

    const payloadBytes = codec.encode(payload);
    const payloadHash = await hasher.digest(payloadBytes);

    const cid = await CID.createV1(codec.code, payloadHash);
    return cid.toString();
  }

  /**
   * Parses the given CID string into a {CID}.
   */
  public static parseCid(str: string): CID {
    const cid: CID = CID.parse(str).toV1();

    if (!codecs[cid.code]) {
      throw new DwnError(DwnErrorCode.ParseCidCodecNotSupported, `codec [${cid.code}] not supported`);
    }

    if (!hashers[cid.multihash.code]) {
      throw new DwnError(DwnErrorCode.ParseCidMultihashNotSupported, `multihash code [${cid.multihash.code}] not supported`);
    }

    return cid;
  }

  /**
   * @returns V1 CID of the DAG comprised by chunking data into unixfs DAG-PB encoded blocks
   */
  public static async computeDagPbCidFromBytes(content: Uint8Array): Promise<string> {
    const asyncDataBlocks = importer([{ content }], new BlockstoreMock(), { cidVersion: 1 });

    // NOTE: the last block contains the root CID
    let block;
    for await (block of asyncDataBlocks) { ; }

    return block ? block.cid.toString() : '';
  }

  /**
   * @returns V1 CID of the DAG comprised by chunking data into unixfs DAG-PB encoded blocks
   */
  public static async computeDagPbCidFromStream(dataStream: Readable): Promise<string> {
    const asyncDataBlocks = importer([{ content: dataStream }], new BlockstoreMock(), { cidVersion: 1 });

    // NOTE: the last block contains the root CID
    let block;
    for await (block of asyncDataBlocks) { ; }

    return block ? block.cid.toString() : '';
  }
}
