import chaiAsPromised from 'chai-as-promised';
import { IndexLevel } from '../../src/store/index-level.js';
import { Temporal } from '@js-temporal/polyfill';
import { v4 as uuid } from 'uuid';
import chai, { expect } from 'chai';

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

    it('adds 1 key per property aside from _id', async () => {
      await index.put({
        _id         : uuid(),
        dateCreated : new Date().toISOString(),
        'a'         : 'b',
        'c'         : 'd'
      });

      const keys = [ ];
      for await (const key of index.db.keys()) {
        keys.push(key);
      }
      expect(keys.length).to.equal(4);
    });

    it('flattens nested records', async () => {
      const doc = {
        _id  : uuid(),
        some : {
          nested: {
            object: true
          }
        }
      };
      await index.put(doc);

      const key = await index.db.get(index['join']('some.nested.object', true, doc._id));
      expect(key).to.equal(doc._id);
    });

    it('removes empty objects', async () => {
      const doc = {
        _id   : uuid(),
        empty : { nested: { } }
      };
      await index.put(doc);

      await expect(index.db.get(index['join']('empty', '[object Object]', doc._id))).to.eventually.be.undefined;
      await expect(index.db.get(index['join']('empty.nested', '[object Object]', doc._id))).to.eventually.be.undefined;
    });

    it('removes empty arrays', async () => {
      const doc = {
        _id   : uuid(),
        empty : [ [ ] ]
      };
      await index.put(doc);

      await expect(index.db.get(index['join']('empty', '', doc._id))).to.eventually.be.undefined;
      await expect(index.db.get(index['join']('empty.0', '', doc._id))).to.eventually.be.undefined;
    });

    it('should not put anything if aborted beforehand', async () => {
      const controller = new AbortController();
      controller.abort('reason');

      const doc = {
        _id : uuid(),
        foo : 'bar'
      };

      try {
        await index.put(doc, { signal: controller.signal });
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
      const doc1 = {
        _id : uuid(),
        'a' : 'b',
        'c' : 'd'
      };

      const doc2 = {
        _id : uuid(),
        'a' : 'c',
        'c' : 'd'
      };

      const doc3 = {
        _id : uuid(),
        'a' : 'b',
        'c' : 'e'
      };

      await index.put(doc1);
      await index.put(doc2);
      await index.put(doc3);

      const result = await index.query({
        'a' : 'b',
        'c' : 'e'
      });

      expect(result.length).to.equal(1);
      expect(result[0]).to.equal(doc3._id);
    });

    it('should not match values prefixed with the query', async () => {
      const doc = {
        _id   : uuid(),
        value : 'foobar'
      };

      await index.put(doc);

      const resp = await index.query({
        value: 'foo'
      });

      expect(resp.length).to.equal(0);
    });

    it('supports OR queries', async () => {
      const doc1 = {
        _id : uuid(),
        'a' : 'a'
      };

      const doc2 = {
        _id : uuid(),
        'a' : 'b'
      };

      const doc3 = {
        _id : uuid(),
        'a' : 'c'
      };

      await index.put(doc1);
      await index.put(doc2);
      await index.put(doc3);

      const resp = await index.query({
        a: [ 'a', 'b' ]
      });

      expect(resp.length).to.equal(2);
      expect(resp).to.include(doc1._id);
      expect(resp).to.include(doc2._id);
    });

    it('supports range queries', async () => {
      for (let i = -5; i < 5; ++i) {
        const doc = {
          _id         : uuid(),
          dateCreated : Temporal.PlainDateTime.from({ year: 2023, month: 1, day: 15 + i }).toString({ smallestUnit: 'microseconds' })
        };

        await index.put(doc);
      }

      const resp = await index.query({
        dateCreated: {
          gte: Temporal.PlainDateTime.from({ year: 2023, month: 1, day: 15 }).toString({ smallestUnit: 'microseconds' })
        }
      });

      expect(resp.length).to.equal(5);
    });

    it('supports prefixed range queries', async () => {
      const doc = {
        _id   : uuid(),
        value : 'foobar'
      };

      await index.put(doc);

      const resp = await index.query({
        value: {
          gte: 'foo'
        }
      });

      expect(resp.length).to.equal(1);
      expect(resp).to.include(doc._id);
    });

    it('supports suffixed range queries', async () => {
      const doc1 = {
        _id : uuid(),
        foo : 'bar'
      };

      const doc2 = {
        _id : uuid(),
        foo : 'barbaz'
      };

      await index.put(doc1);
      await index.put(doc2);

      const resp = await index.query({
        foo: {
          lte: 'bar'
        }
      });

      expect(resp.length).to.equal(1);
      expect(resp).to.include(doc1._id);
    });

    it('treats strings differently', async () => {
      const doc1 = {
        _id : uuid(),
        foo : true
      };

      const doc2 = {
        _id : uuid(),
        foo : 'true'
      };

      await index.put(doc1);
      await index.put(doc2);

      const resp = await index.query({
        foo: true
      });

      expect(resp.length).to.equal(1);
      expect(resp).to.include(doc1._id);
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
      const doc1 = {
        _id : uuid(),
        'a' : 'b',
        'c' : 'd'
      };

      const doc2 = {
        _id : uuid(),
        'a' : 'b',
        'c' : 'd'
      };

      await index.put(doc1);
      await index.put(doc2);

      let result = await index.query({ 'a': 'b', 'c': 'd' });

      expect(result.length).to.equal(2);
      expect(result).to.contain(doc1._id);

      await index.delete(doc1._id);


      result = await index.query({ 'a': 'b', 'c': 'd' });

      expect(result.length).to.equal(1);
    });

    it('should not delete anything if aborted beforehand', async () => {
      const controller = new AbortController();
      controller.abort('reason');

      const doc = {
        _id : uuid(),
        foo : 'bar'
      };

      await index.put(doc);

      try {
        await index.delete(doc._id, { signal: controller.signal });
      } catch (e) {
        expect(e).to.equal('reason');
      }

      const result = await index.query({ foo: 'bar' });
      expect(result.length).to.equal(1);
      expect(result).to.contain(doc._id);
    });
  });
});