import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';

// extend chai to test promises
chai.use(chaiAsPromised);

describe('CID', () => {
  describe('generateCid', () => {
    xit('throws an error if codec is not supported');
    xit('throws an error if multihasher is not supported');
    xit('generates a cbor/sha256 v1 cid by default');
  });

  describe('parseCid', () => {
    xit('throws an error if codec is not supported');
    xit('throws an error if multihasher is not supported');
    xit('parses provided str into a V1 cid');
  });
});