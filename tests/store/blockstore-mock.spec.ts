import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

import { BlockstoreMock } from '../../src/store/blockstore-mock.js';
import { DataStream } from '../../src/index.js';
import { importer } from 'ipfs-unixfs-importer';
import { MemoryBlockstore } from 'blockstore-core';
import { TestDataGenerator } from '../utils/test-data-generator.js';

chai.use(chaiAsPromised);

describe('BlockstoreMock', () => {
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
});
