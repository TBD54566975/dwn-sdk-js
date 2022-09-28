import { generateCid } from '../../src/utils/cid';
import { sha256 } from 'multiformats/hashes/sha2';
import { TestDataGenerator } from '../utils/test-data-generator';
import * as block from 'multiformats/block';
import * as cbor from '@ipld/dag-cbor';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';

// extend chai to test promises
chai.use(chaiAsPromised);

describe('CID', () => {
  describe('generateCid', () => {
    xit('throws an error if codec is not supported');
    xit('throws an error if multihasher is not supported');
    xit('generates a cbor/sha256 v1 cid by default');

    it('generates a CBOR SHA256 CID identical to IPFS block encoding algorithm', async () => {
      const anyTestData = {
        a : TestDataGenerator.randomString(32),
        b : TestDataGenerator.randomString(32),
        c : TestDataGenerator.randomString(32)
      };
      const generatedCid = await generateCid(anyTestData);
      const encodedBlock = await block.encode({ value: anyTestData, codec: cbor, hasher: sha256 });

      expect(generatedCid.toString()).to.equal(encodedBlock.cid.toString());
    });
  });

  describe('parseCid', () => {
    xit('throws an error if codec is not supported');
    xit('throws an error if multihasher is not supported');
    xit('parses provided str into a V1 cid');
  });
});