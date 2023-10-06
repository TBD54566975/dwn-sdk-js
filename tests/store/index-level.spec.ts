import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

import { ArrayUtility } from '../../src/utils/array.js';
import { IndexLevel } from '../../src/store/index-level.js';
import { monotonicFactory } from 'ulidx';
import { v4 as uuid } from 'uuid';
import { createLevelDatabase, LevelWrapper } from '../../src/store/level-wrapper.js';

chai.use(chaiAsPromised);


describe('IndexLevel', () => {
  let db: LevelWrapper<string>;
  let testIndex: IndexLevel<string>;
  let partitionedDB: LevelWrapper<string>;
  const ulidFactory = monotonicFactory();
  const tenant = 'did:alice:index-test';

  describe('put', () => {
    before(async () => {
      db = new LevelWrapper<string>({
        createLevelDatabase,
        location      : 'TEST-INDEX',
        valueEncoding : 'utf8'
      });
      testIndex = new IndexLevel(db);
      partitionedDB = await (await db.partition(tenant)).partition('index');
      await db.open();
    });

    beforeEach(async () => {
      await db.clear();
    });

    after(async () => {
      await db.close();
    });

    it('fails to index without a non-empty sort property', async () => {
      const id = uuid();

      let failedIndex = testIndex.index(tenant, id, id, {
        foo: 'foo'
      }, { nested: {} });

      await expect(failedIndex).to.eventually.be.rejectedWith('must include at least one sorted index');

      failedIndex = testIndex.index(tenant, id, id, {
        foo: 'foo'
      }, { sort: [ [] ] });

      await expect(failedIndex).to.eventually.be.rejectedWith('must include at least one sorted index');

      const keys = await ArrayUtility.fromAsyncGenerator(partitionedDB.keys());
      expect(keys.length).to.equal(0);

      failedIndex = testIndex.index(tenant, id, id, {
        foo: 'foo'
      }, { sort: id });
      await expect(failedIndex).to.eventually.not.be.rejected;
    });

    it('fails to index without indexable properties ', async () => {
      const id = uuid();

      let failedIndex = testIndex.index(tenant, id, id, {}, { id });
      await expect(failedIndex).to.eventually.be.rejectedWith('no properties to index');

      failedIndex = testIndex.index(tenant, id, id, {
        empty: [ [] ]
      }, { id });
      await expect(failedIndex).to.eventually.be.rejectedWith('no properties to index');

      failedIndex = testIndex.index(tenant, id, id, {
        foo : {},
        bar : {
          baz: {},
        }
      }, { id });

      await expect(failedIndex).to.eventually.be.rejectedWith('no properties to index');

      const keys = await ArrayUtility.fromAsyncGenerator(partitionedDB.keys());
      expect(keys.length).to.equal(0);

      failedIndex = testIndex.index(tenant, id, id, {
        foo : 'foo',
        bar : {
          baz: 'baz'
        }
      }, { id });
      await expect(failedIndex).to.eventually.not.be.rejected;
    });

    it('flattens nested indexes', async () => {
      const id = uuid();
      const index = {
        some: {
          nested: {
            object: true
          }
        }
      };
      await testIndex.index(tenant, id, id, index, { id });
      const indexKey = testIndex['constructIndexedKey'](
        `__id`,
        'some.nested.object',
        'true',
        `"${id}"`,
        id,
      );
      const key = await partitionedDB.get(indexKey);
      expect(key).to.not.be.undefined;
      expect(JSON.parse(key!)).to.equal(id);
    });

    it('adds 1 key per property, per sorted property, aside from id', async () => {
      const id = uuid();
      const dateCreated = new Date().toISOString();
      const watermark = ulidFactory();

      await testIndex.index(tenant, id, id, {
        'a' : 'b', // 2
        'c' : 'd', // 2
        dateCreated, // 2
      }, { dateCreated, watermark });

      const keys = await ArrayUtility.fromAsyncGenerator(partitionedDB.keys());
      expect(keys.length).to.equal(7);
    });

    // it('should extract value from key', async () => {
    //   const testValue = 'testValue';
    //   await index.put(uuid(), {
    //     dateCreated : new Date().toISOString(),
    //     'testKey'   : testValue,
    //   });

    //   const keys = await ArrayUtility.fromAsyncGenerator(index.db.keys());
    //   // encoded string values are surrounded by quotes.
    //   expect(keys.filter( k => MessageIndexLevel.extractValueFromKey(k) === `"${testValue}"`).length).to.equal(1);
    // });
  });
});