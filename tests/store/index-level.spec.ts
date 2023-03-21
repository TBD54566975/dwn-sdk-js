import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

import { asyncGeneratorToArray } from '../../src/utils/array.js';
import { IndexLevel } from '../../src/store/index-level.js';
import { Temporal } from '@js-temporal/polyfill';
import { v4 as uuid } from 'uuid';

chai.use(chaiAsPromised);

let index: IndexLevel;

describe('Index Level', () => {
  describe('put', () => {
    before(async () => {
      index = new IndexLevel({ location: 'TEST-INDEX' });
      await index.open();
    });

    beforeEach(async () => {
      await index.clear();
    });

    after(async () => {
      await index.close();
    });

    it('adds 1 key per property aside from id', async () => {
      await index.put(uuid(), {
        dateCreated : new Date().toISOString(),
        'a'         : 'b',
        'c'         : 'd'
      });

      const keys = await asyncGeneratorToArray(index.db.keys());
      expect(keys.length).to.equal(4);
    });

    it('flattens nested records', async () => {
      const id = uuid();
      const doc = {
        some: {
          nested: {
            object: true
          }
        }
      };
      await index.put(id, doc);

      const key = await index.db.get(index['join']('some.nested.object', true, id));
      expect(key).to.equal(id);
    });

    it('removes empty objects', async () => {
      const id = uuid();
      const doc = {
        empty: { nested: { } }
      };
      await index.put(id, doc);

      await expect(index.db.get(index['join']('empty', '[object Object]', id))).to.eventually.be.undefined;
      await expect(index.db.get(index['join']('empty.nested', '[object Object]', id))).to.eventually.be.undefined;
    });

    it('removes empty arrays', async () => {
      const id = uuid();
      const doc = {
        empty: [ [ ] ]
      };
      await index.put(id, doc);

      await expect(index.db.get(index['join']('empty', '', id))).to.eventually.be.undefined;
      await expect(index.db.get(index['join']('empty.0', '', id))).to.eventually.be.undefined;
    });

    it('should not put anything if aborted beforehand', async () => {
      const controller = new AbortController();
      controller.abort('reason');

      const id = uuid();
      const doc = {
        foo: 'bar'
      };

      try {
        await index.put(id, doc, { signal: controller.signal });
      } catch (e) {
        expect(e).to.equal('reason');
      }

      const result = await index.query({ foo: 'bar' });
      expect(result.length).to.equal(0);
    });
  });

  describe('query', () => {
    before(async () => {
      index = new IndexLevel({ location: 'TEST-INDEX' });
      await index.open();
    });

    beforeEach(async () => {
      await index.clear();
    });

    after(async () => {
      await index.close();
    });

    it('works', async () => {
      const id1 = uuid();
      const doc1 = {
        'a' : 'b',
        'c' : 'd'
      };

      const id2 = uuid();
      const doc2 = {
        'a' : 'c',
        'c' : 'd'
      };

      const id3 = uuid();
      const doc3 = {
        'a' : 'b',
        'c' : 'e'
      };

      await index.put(id1, doc1);
      await index.put(id2, doc2);
      await index.put(id3, doc3);

      const result = await index.query({
        'a' : 'b',
        'c' : 'e'
      });

      expect(result.length).to.equal(1);
      expect(result[0]).to.equal(id3);
    });

    it('should not match values prefixed with the query', async () => {
      const id = uuid();
      const doc = {
        value: 'foobar'
      };

      await index.put(id, doc);

      const resp = await index.query({
        value: 'foo'
      });

      expect(resp.length).to.equal(0);
    });

    it('supports OR queries', async () => {
      const id1 = uuid();
      const doc1 = {
        'a': 'a'
      };

      const id2 = uuid();
      const doc2 = {
        'a': 'b'
      };

      const id3 = uuid();
      const doc3 = {
        'a': 'c'
      };

      await index.put(id1, doc1);
      await index.put(id2, doc2);
      await index.put(id3, doc3);

      const resp = await index.query({
        a: [ 'a', 'b' ]
      });

      expect(resp.length).to.equal(2);
      expect(resp).to.include(id1);
      expect(resp).to.include(id2);
    });

    it('supports range queries', async () => {
      for (let i = -5; i < 5; ++i) {
        const id = uuid();
        const doc = {
          dateCreated: Temporal.PlainDateTime.from({ year: 2023, month: 1, day: 15 + i }).toString({ smallestUnit: 'microseconds' })
        };

        await index.put(id, doc);
      }

      const resp = await index.query({
        dateCreated: {
          gte: Temporal.PlainDateTime.from({ year: 2023, month: 1, day: 15 }).toString({ smallestUnit: 'microseconds' })
        }
      });

      expect(resp.length).to.equal(5);
    });

    it('supports prefixed range queries', async () => {
      const id = uuid();
      const doc = {
        value: 'foobar'
      };

      await index.put(id, doc);

      const resp = await index.query({
        value: {
          gte: 'foo'
        }
      });

      expect(resp.length).to.equal(1);
      expect(resp).to.include(id);
    });

    it('supports suffixed range queries', async () => {
      const id1 = uuid();
      const doc1 = {
        foo: 'bar'
      };

      const id2 = uuid();
      const doc2 = {
        foo: 'barbaz'
      };

      await index.put(id1, doc1);
      await index.put(id2, doc2);

      const resp = await index.query({
        foo: {
          lte: 'bar'
        }
      });

      expect(resp.length).to.equal(1);
      expect(resp).to.include(id1);
    });

    it('treats strings differently', async () => {
      const id1 = uuid();
      const doc1 = {
        foo: true
      };

      const id2 = uuid();
      const doc2 = {
        foo: 'true'
      };

      await index.put(id1, doc1);
      await index.put(id2, doc2);

      const resp = await index.query({
        foo: true
      });

      expect(resp.length).to.equal(1);
      expect(resp).to.include(id1);
    });
  });

  describe('delete', () => {
    before(async () => {
      index = new IndexLevel({ location: 'TEST-INDEX' });
      await index.open();
    });

    beforeEach(async () => {
      await index.clear();
    });

    after(async () => {
      await index.close();
    });

    it('works', async () => {
      const id1 = uuid();
      const doc1 = {
        'a' : 'b',
        'c' : 'd'
      };

      const id2 = uuid();
      const doc2 = {
        'a' : 'b',
        'c' : 'd'
      };

      await index.put(id1, doc1);
      await index.put(id2, doc2);

      let result = await index.query({ 'a': 'b', 'c': 'd' });

      expect(result.length).to.equal(2);
      expect(result).to.contain(id1);

      await index.delete(id1);


      result = await index.query({ 'a': 'b', 'c': 'd' });

      expect(result.length).to.equal(1);
    });

    it('should not delete anything if aborted beforehand', async () => {
      const controller = new AbortController();
      controller.abort('reason');

      const id = uuid();
      const doc = {
        foo: 'bar'
      };

      await index.put(id, doc);

      try {
        await index.delete(id, { signal: controller.signal });
      } catch (e) {
        expect(e).to.equal('reason');
      }

      const result = await index.query({ foo: 'bar' });
      expect(result.length).to.equal(1);
      expect(result).to.contain(id);
    });
  });
});