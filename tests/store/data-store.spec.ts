import { DataStoreLevel } from '../../src/store/data-store-level.js';
import { DataStream } from '../../src/index.js';
import { expect } from 'chai';
import { TestDataGenerator } from '../utils/test-data-generator.js';

let store: DataStoreLevel;

describe('DataStore Test Suite', () => {
  before(async () => {
    store = new DataStoreLevel({ blockstoreLocation: 'TEST-BLOCKSTORE' });
    await store.open();
  });

  beforeEach(async () => {
    await store.clear(); // clean up before each test rather than after so that a test does not depend on other tests to do the clean up
  });

  after(async () => {
    await store.close();
  });

  describe('put', function () {
    it('should return the correct size of the data stored', async () => {
      let dataSizeInBytes = 10;

      // iterate through order of magnitude in size until hitting 10MB
      while (dataSizeInBytes <= 10_000_000) {
        const dataBytes = TestDataGenerator.randomBytes(dataSizeInBytes);
        const dataStream = DataStream.fromBytes(dataBytes);
        const { dataSize } = await store.put('anyTenant', 'anyRecordId', dataStream);

        expect(dataSize).to.equal(dataSizeInBytes);

        dataSizeInBytes *= 10;
      }
    });
  });

  describe('get', function () {
    it('should return `undefined if unable to find the data specified`', async () => {
      const randomCid = await TestDataGenerator.randomCborSha256Cid();
      const data = await store.get('anyTenant', 'anyRecordId', randomCid);

      expect(data).to.be.undefined;
    });
  });
});