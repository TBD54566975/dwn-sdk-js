import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

import { asyncGeneratorToArray } from '../../src/utils/array.js';
import { Cid } from '../../src/utils/cid.js';
import { DataStoreLevel } from '../../src/store/data-store-level.js';
import { DataStream } from '../../src/index.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';

chai.use(chaiAsPromised);

let store: DataStoreLevel;

describe('DataStore Test Suite', () => {
  before(async () => {
    store = new DataStoreLevel({ blockstoreLocation: 'TEST-DATASTORE' });
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
      const tenant = await TestDataGenerator.randomCborSha256Cid();
      const messageCid = await TestDataGenerator.randomCborSha256Cid();

      let dataSizeInBytes = 10;

      // iterate through order of magnitude in size until hitting 10MB
      while (dataSizeInBytes <= 10_000_000) {
        const dataBytes = TestDataGenerator.randomBytes(dataSizeInBytes);
        const dataStream = DataStream.fromBytes(dataBytes);
        const dataCid = await Cid.computeDagPbCidFromBytes(dataBytes);

        const { dataSize } = await store.put(tenant, messageCid, dataCid, dataStream);

        expect(dataSize).to.equal(dataSizeInBytes);

        const result = (await store.get(tenant, messageCid, dataCid))!;
        const storedDataBytes = await DataStream.toBytes(result.dataStream);

        expect(storedDataBytes).to.eql(dataBytes);

        dataSizeInBytes *= 10;
      }
    });
  });

  describe('get', function () {
    it('should return `undefined if unable to find the data specified`', async () => {
      const tenant = await TestDataGenerator.randomCborSha256Cid();
      const messageCid = await TestDataGenerator.randomCborSha256Cid();

      const randomCid = await TestDataGenerator.randomCborSha256Cid();
      const result = await store.get(tenant, messageCid, randomCid);

      expect(result).to.be.undefined;
    });

    it('should return `undefined if the dataCid is different than the dataStream`', async () => {
      const tenant = await TestDataGenerator.randomCborSha256Cid();
      const messageCid = await TestDataGenerator.randomCborSha256Cid();

      const randomCid = await TestDataGenerator.randomCborSha256Cid();

      const dataBytes = TestDataGenerator.randomBytes(10_000_000);
      const dataStream = DataStream.fromBytes(dataBytes);

      const { dataCid } = await store.put(tenant, messageCid, randomCid, dataStream);

      expect(dataCid).to.not.equal(randomCid);

      const result = await store.get(tenant, messageCid, randomCid);

      expect(result).to.be.undefined;
    });
  });

  describe('associate', function () {
    it('should return `false` if tenant missing', async () => {
      const tenant = await TestDataGenerator.randomCborSha256Cid();
      const messageCid = await TestDataGenerator.randomCborSha256Cid();
      const randomCid = await TestDataGenerator.randomCborSha256Cid();

      const keysBeforeAssociate = await asyncGeneratorToArray(store.blockstore.db.keys());
      expect(keysBeforeAssociate.length).to.equal(0);

      const result = await store.associate(tenant, messageCid, randomCid);
      expect(result).to.be.undefined;

      const keysAfterAssociate = await asyncGeneratorToArray(store.blockstore.db.keys());
      expect(keysAfterAssociate.length).to.equal(0);
    });

    it('should return `false` if data missing', async () => {
      const tenant = await TestDataGenerator.randomCborSha256Cid();
      const messageCid = await TestDataGenerator.randomCborSha256Cid();
      const randomCid = await TestDataGenerator.randomCborSha256Cid();

      const dataBytes = TestDataGenerator.randomBytes(10);
      const dataStream = DataStream.fromBytes(dataBytes);

      const { dataCid } = await store.put(tenant, messageCid, randomCid, dataStream);
      expect(dataCid).to.not.equal(randomCid);

      const keysBeforeAssociate = await asyncGeneratorToArray(store.blockstore.db.keys());
      expect(keysBeforeAssociate.length).to.equal(2);

      const result = await store.associate(tenant, messageCid, randomCid);
      expect(result).to.be.undefined;

      const keysAfterAssociate = await asyncGeneratorToArray(store.blockstore.db.keys());
      expect(keysAfterAssociate.length).to.equal(2);
    });

    it('should return the root CID', async () => {
      const tenant = await TestDataGenerator.randomCborSha256Cid();
      const messageCid = await TestDataGenerator.randomCborSha256Cid();

      const dataBytes = TestDataGenerator.randomBytes(10_000_000);
      const dataStream = DataStream.fromBytes(dataBytes);
      const dataCid = await Cid.computeDagPbCidFromBytes(dataBytes);

      await store.put(tenant, messageCid, dataCid, dataStream);

      const keysBeforeDelete = await asyncGeneratorToArray(store.blockstore.db.keys());
      expect(keysBeforeDelete.length).to.equal(41);

      const result = (await store.associate(tenant, messageCid, dataCid))!;
      expect(result.dataCid).to.equal(dataCid);
      expect(result.dataSize).to.equal(10_000_000);

      const keysAfterDelete = await asyncGeneratorToArray(store.blockstore.db.keys());
      expect(keysAfterDelete.length).to.equal(41);
    });
  });

  describe('delete', function () {
    it('should not leave anything behind when deleting a the root CID', async () => {
      const tenant = await TestDataGenerator.randomCborSha256Cid();
      const messageCid = await TestDataGenerator.randomCborSha256Cid();

      const dataBytes = TestDataGenerator.randomBytes(10_000_000);
      const dataStream = DataStream.fromBytes(dataBytes);
      const dataCid = await Cid.computeDagPbCidFromBytes(dataBytes);

      await store.put(tenant, messageCid, dataCid, dataStream);

      const keysBeforeDelete = await asyncGeneratorToArray(store.blockstore.db.keys());
      expect(keysBeforeDelete.length).to.equal(41);

      await store.delete(tenant, messageCid, dataCid);

      const keysAfterDelete = await asyncGeneratorToArray(store.blockstore.db.keys());
      expect(keysAfterDelete.length).to.equal(0);
    });
  });
});