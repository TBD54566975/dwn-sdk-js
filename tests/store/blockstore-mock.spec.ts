import * as Block from 'multiformats/block';
import * as Raw from 'multiformats/codecs/raw';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { CID } from 'multiformats/cid';
import { expect } from 'chai';
import { sha256 } from 'multiformats/hashes/sha2';

import { BlockstoreMock } from '../../src/store/blockstore-mock.js';
import { DataStream } from '../../src/index.js';
import { importer } from 'ipfs-unixfs-importer';
import { MemoryBlockstore } from 'blockstore-core';
import { TestDataGenerator } from '../utils/test-data-generator.js';

chai.use(chaiAsPromised);

describe('BlockstoreMock', () => {
  let blockstore: BlockstoreMock;

  beforeEach(() => {
    blockstore = new BlockstoreMock();
  });

  it('should facilitate the same CID computation as other implementations', async () => {

    let dataSizeInBytes = 10;

    // iterate through order of magnitude in size until hitting 10MB
    // to ensure that the same CID is computed for the same data with the MockBlockstore as with the MemoryBlockstore
    while (dataSizeInBytes <= 10_000_000) {
      const dataBytes = TestDataGenerator.randomBytes(dataSizeInBytes);
      const dataStreamForMemoryBlockstore = DataStream.fromBytes(dataBytes);
      const dataStreamForMockBlockstore = DataStream.fromBytes(dataBytes);

      const asyncDataBlocksByMemoryBlockstore = importer([{ content: dataStreamForMemoryBlockstore }], new MemoryBlockstore(), { cidVersion: 1 });
      const asyncDataBlocksByMockBlockstore = importer([{ content: dataStreamForMockBlockstore }], new BlockstoreMock(), { cidVersion: 1 });

      // NOTE: the last block contains the root CID
      let blockByMemoryBlockstore;
      for await (blockByMemoryBlockstore of asyncDataBlocksByMemoryBlockstore) { ; }
      const dataCidByMemoryBlockstore = blockByMemoryBlockstore ? blockByMemoryBlockstore.cid.toString() : '';

      let blockByMockBlockstore;
      for await (blockByMockBlockstore of asyncDataBlocksByMockBlockstore) { ; }
      const dataCidByMockBlockstore = blockByMockBlockstore ? blockByMockBlockstore.cid.toString() : '';

      expect(dataCidByMockBlockstore).to.exist;
      expect(dataCidByMockBlockstore.length).to.be.greaterThan(0);
      expect(dataCidByMockBlockstore).to.be.equal(dataCidByMemoryBlockstore);

      dataSizeInBytes *= 10;
    }
  });

  it('should implement get method', async () => {
    const cid = CID.parse('bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi');
    const result = await blockstore.get(cid);
    expect(result).to.be.instanceof(Uint8Array);
    expect(result.length).to.equal(0);
  });

  it('should implement has method', async () => {
    const cid = CID.parse('bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi');
    const result = await blockstore.has(cid);
    expect(result).to.be.false;
  });

  it('should implement delete method', async () => {
    const cid = CID.parse('bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi');
    await expect(blockstore.delete(cid)).to.be.fulfilled;
  });

  it('should implement isEmpty method', async () => {
    const result = await blockstore.isEmpty();
    expect(result).to.be.true;
  });

  it('should implement putMany method', async () => {
    const block1 = await Block.encode({ value: new TextEncoder().encode('test1'), codec: Raw, hasher: sha256 });
    const block2 = await Block.encode({ value: new TextEncoder().encode('test2'), codec: Raw, hasher: sha256 });
    const source = [
      { cid: block1.cid, block: block1.bytes },
      { cid: block2.cid, block: block2.bytes }
    ];

    const results = [];
    for await (const cid of blockstore.putMany(source)) {
      results.push(cid);
    }

    expect(results).to.have.lengthOf(2);
    expect(results[0]).to.deep.equal(block1.cid);
    expect(results[1]).to.deep.equal(block2.cid);
  });

  it('should implement getMany method', async () => {
    const cid1 = CID.parse('bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi');
    const cid2 = CID.parse('bafkreifjjcie6lypi6ny7amxnfftagclbuxndqonfipmb64f2km2devei4');
    const source = [cid1, cid2];

    const results = [];
    for await (const pair of blockstore.getMany(source)) {
      results.push(pair);
    }

    expect(results).to.have.lengthOf(2);
    expect(results[0].cid).to.deep.equal(cid1);
    expect(results[0].block).to.be.instanceof(Uint8Array);
    expect(results[0].block.length).to.equal(0);
    expect(results[1].cid).to.deep.equal(cid2);
    expect(results[1].block).to.be.instanceof(Uint8Array);
    expect(results[1].block.length).to.equal(0);
  });

  it('should implement deleteMany method', async () => {
    const cid1 = CID.parse('bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi');
    const cid2 = CID.parse('bafkreifjjcie6lypi6ny7amxnfftagclbuxndqonfipmb64f2km2devei4');
    const source = [cid1, cid2];

    const results = [];
    for await (const cid of blockstore.deleteMany(source)) {
      results.push(cid);
    }

    expect(results).to.have.lengthOf(2);
    expect(results[0]).to.deep.equal(cid1);
    expect(results[1]).to.deep.equal(cid2);
  });

  it('should implement clear method', async () => {
    await expect(blockstore.clear()).to.be.fulfilled;
  });

});
