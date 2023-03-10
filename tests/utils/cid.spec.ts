
import * as block from 'multiformats/block';
import * as cbor from '@ipld/dag-cbor';
import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

import { DataStream } from '../../src/index.js';
import { sha256 } from 'multiformats/hashes/sha2';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { Cid, computeCid, parseCid } from '../../src/utils/cid.js';

// extend chai to test promises
chai.use(chaiAsPromised);

describe('CID', () => {
  it('should yield the same CID using either computeDagPbCidFromBytes() & computeDagPbCidFromStream()', async () => {
    const randomBytes = TestDataGenerator.randomBytes(500_000);
    const randomByteStream = await DataStream.fromBytes(randomBytes);

    const cid1 = await Cid.computeDagPbCidFromBytes(randomBytes);
    const cid2 = await Cid.computeDagPbCidFromStream(randomByteStream);
    expect(cid1).to.equal(cid2);
  });

  describe('computeCid', () => {
    it('throws an error if codec is not supported', async () => {
      const unsupportedCodec = 99999;
      const anyTestData = {
        a: TestDataGenerator.randomString(32),
      };
      const computeCidPromise = computeCid(anyTestData, 99999);
      await expect(computeCidPromise).to.be.rejectedWith(`codec [${unsupportedCodec}] not supported`);
    });

    it('throws an error if multihasher is not supported', async () => {
      const unsupportedHashAlgorithm = 99999;
      const anyTestData = {
        a: TestDataGenerator.randomString(32),
      };
      const computeCidPromise = computeCid(anyTestData, 113, 99999); // 113 = CBOR
      await expect(computeCidPromise).to.be.rejectedWith(`multihash code [${unsupportedHashAlgorithm}] not supported`);
    });

    it('should by default generate a CBOR SHA256 CID identical to IPFS block encoding algorithm', async () => {
      const anyTestData = {
        a : TestDataGenerator.randomString(32),
        b : TestDataGenerator.randomString(32),
        c : TestDataGenerator.randomString(32)
      };
      const generatedCid = await computeCid(anyTestData);
      const encodedBlock = await block.encode({ value: anyTestData, codec: cbor, hasher: sha256 });

      expect(generatedCid).to.equal(encodedBlock.cid.toString());
    });

    it('should canonicalize JSON input before hashing', async () => {
      const data1 = {
        a : 'a',
        b : 'b',
        c : 'c'
      };

      const data2 = {
        b : 'b',
        c : 'c',
        a : 'a'
      };
      const cid1 = await computeCid(data1);
      const cid2 = await computeCid(data2);

      expect(cid1).to.equal(cid2);
    });
  });

  describe('parseCid', () => {
    it('throws an error if codec is not supported', async () => {
      expect(() => parseCid('bafybeihzdcfjv55kxiz7sxwxaxbnjgj7rm2amvrxpi67jpwkgygjzoh72y')).to.throw('codec [112] not supported'); // a DAG-PB CID
    });

    it('throws an error if multihasher is not supported', async () => {
      expect(() => parseCid('bafy2bzacec2qlo3cohxyaoulipd3hurlq6pspvmpvmnmqsxfg4vbumpq3ufag')).to.throw('multihash code [45600] not supported'); // 45600 = BLAKE2b-256 CID
    });
  });
});