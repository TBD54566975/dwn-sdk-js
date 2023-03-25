import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

import { asyncGeneratorToArray } from '../../src/utils/array.js';
import { Cid } from '../../src/utils/cid.js';
import { DataStream } from '../../src/index.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { UploadStoreLevel } from '../../src/store/upload-store-level.js';

chai.use(chaiAsPromised);

let store: UploadStoreLevel;

describe('UploadStore Test Suite', () => {
  before(async () => {
    store = new UploadStoreLevel({ blockstoreLocation: 'TEST-UPLOADSTORE' });
    await store.open();
  });

  beforeEach(async () => {
    await store.clear(); // clean up before each test rather than after so that a test does not depend on other tests to do the clean up
  });

  after(async () => {
    await store.close();
  });

  describe('part', function () {
    it('should return the correct size of the data stored', async () => {
      const tenant = await TestDataGenerator.randomCborSha256Cid();
      const recordId = await TestDataGenerator.randomCborSha256Cid();

      let index = 0;
      let dataSize = 10;

      // iterate through order of magnitude in size until hitting 10MB
      while (dataSize <= 10_000_000) {
        const dataBytes = TestDataGenerator.randomBytes(dataSize);
        const dataStream = DataStream.fromBytes(dataBytes);
        const dataCid = await Cid.computeDagPbCidFromBytes(dataBytes);

        const result = await store.part(tenant, recordId, index, dataStream);

        expect(result.dataCid).to.equal(dataCid);
        expect(result.dataSize).to.equal(dataSize);

        ++index;
        dataSize *= 10;
      }
    });
  });

  describe('complete', function () {
    it('should delete all extra data', async () => {
      const tenant = await TestDataGenerator.randomCborSha256Cid();
      const recordId = await TestDataGenerator.randomCborSha256Cid();

      const count = 2;
      const dataSize = 1_000_000;

      const dataBytes = TestDataGenerator.randomBytes(dataSize);
      const dataCid = await Cid.computeDagPbCidFromBytes(dataBytes);

      for (let index = 0; index < count * 2; ++index) {
        await store.part(tenant, recordId, index, DataStream.fromBytes(dataBytes));
      }

      const keysBeforeDelete = await asyncGeneratorToArray(store.blockstore.db.keys());
      expect(keysBeforeDelete.length).to.equal(24);

      const result = await store.complete(tenant, recordId, count);

      expect(result.dataCid).to.equal(await Cid.computeDagPbCidFromStream(DataStream.fromIterable(Array(count).fill(dataCid))));
      expect(result.dataSize).to.equal(dataSize * count);

      const keysAfterDelete = await asyncGeneratorToArray(store.blockstore.db.keys());
      expect(keysAfterDelete.length).to.equal(12);
    });
  });

  describe('get', function () {
    it('should return `undefined` if unable to find the data specified', async () => {
      const tenant = await TestDataGenerator.randomCborSha256Cid();
      const recordId = await TestDataGenerator.randomCborSha256Cid();

      const result = await store.get(tenant, recordId);

      expect(result).to.be.undefined;
    });

    it('should assemble all parts', async () => {
      const tenant = await TestDataGenerator.randomCborSha256Cid();
      const recordId = await TestDataGenerator.randomCborSha256Cid();

      const dataBytes = TestDataGenerator.randomBytes(1_000_000);

      await store.part(tenant, recordId, 0, DataStream.fromBytes(dataBytes));
      await store.part(tenant, recordId, 1, DataStream.fromBytes(dataBytes));
      await store.part(tenant, recordId, 2, DataStream.fromBytes(dataBytes));

      const stream = await store.get(tenant, recordId);
      const storedDataBytes = await DataStream.toBytes(stream);

      expect([ ...storedDataBytes ]).to.eql([ ...dataBytes, ...dataBytes, ...dataBytes ]);
    });
  });

  describe('delete', function () {
    it('should not leave anything behind when deleting a the root CID', async () => {
      const tenant = await TestDataGenerator.randomCborSha256Cid();
      const recordId = await TestDataGenerator.randomCborSha256Cid();

      const dataBytes = TestDataGenerator.randomBytes(1_000_000);

      for (let index = 0; index < 5; ++index) {
        await store.part(tenant, recordId, index, DataStream.fromBytes(dataBytes));
      }

      const keysBeforeDelete = await asyncGeneratorToArray(store.blockstore.db.keys());
      expect(keysBeforeDelete.length).to.equal(30);

      await store.delete(tenant, recordId);

      const keysAfterDelete = await asyncGeneratorToArray(store.blockstore.db.keys());
      expect(keysAfterDelete.length).to.equal(0);
    });
  });
});