import { expect } from 'chai';
import { generateCid } from '../../src/utils/cid';
import { MessageStoreLevel } from '../../src/store/message-store-level';
import { TestDataGenerator } from '../utils/test-data-generator';

let messageStore: MessageStoreLevel;

describe('MessageStoreLevel Tests', () => {

  describe('buildIndexQueryTerms', () => {
    it('returns an array of terms based on the query object provided', () => {
      const query = {
        method   : 'CollectionsQuery',
        schema   : 'https://schema.org/MusicPlaylist',
        objectId : 'abcd123'
      };

      const expected = ['method:CollectionsQuery', 'schema:https://schema.org/MusicPlaylist', 'objectId:abcd123'];
      const terms = MessageStoreLevel['buildIndexQueryTerms'](query);

      expect(terms).to.eql(expected);
    });

    it('flattens nested objects', () => {
      const query = {
        requester : 'AlBorland',
        ability   : {
          method : 'CollectionsQuery',
          schema : 'https://schema.org/MusicPlaylist',
          doo    : {
            bingo: 'bongo'
          }
        }
      };

      const expected = [
        'requester:AlBorland',
        'ability.method:CollectionsQuery',
        'ability.schema:https://schema.org/MusicPlaylist',
        'ability.doo.bingo:bongo'
      ];

      const terms = MessageStoreLevel['buildIndexQueryTerms'](query);

      expect(terms).to.eql(expected);
    });
  });

  describe('put', function () {
    before(async () => {
      messageStore = new MessageStoreLevel({
        blockstoreLocation : 'TEST-BLOCKSTORE',
        indexLocation      : 'TEST-INDEX'
      });
      await messageStore.open();
    });

    beforeEach(async () => {
      await messageStore.clear(); // clean up before each test rather than after so that a test does not depend on other tests to do the clean up
    });

    after(async () => {
      await messageStore.close();
    });

    it('stores messages as cbor/sha256 encoded blocks with CID as key', async () => {
      const ctx = { tenant: 'doodeedoo' };
      const message = await TestDataGenerator.generatePermissionRequestMessage();

      await messageStore.put(message, ctx);

      const expectedCid = await generateCid(message);

      const jsonMessage = await messageStore.get(expectedCid, ctx);
      const resultCid = await generateCid(jsonMessage);

      expect(resultCid.equals(expectedCid)).to.be.true;
    });

    it('adds author to index', async () => {
      const ctx = { tenant: 'did:ex:alice', author: 'did:ex:clifford' };
      const message = await TestDataGenerator.generatePermissionRequestMessage();

      await messageStore.put(message, ctx);

      const results = await messageStore.query({ author: ctx.author }, ctx);
      expect(results.length).to.equal(1);
    });

    it('adds tenant to index', async () => {
      const ctx = { tenant: 'did:ex:alice', author: 'did:ex:clifford' };
      const message = await TestDataGenerator.generatePermissionRequestMessage();

      await messageStore.put(message, ctx);

      const results = await messageStore.query({ tenant: ctx.tenant }, ctx);
      expect(results.length).to.equal(1);
    });
  });


  // describe('get', () => {
  //   before(async () => {
  //     await messageStore.open();
  //   });

  //   afterEach(async () => {
  //     await messageStore.clear();
  //   });

  //   after(async () => {
  //     await messageStore.close();
  //   });


  //   it('returns undefined if message does not exist', async () => {
  //     const { cid } = await block.encode({ value: { beep: 'boop' }, codec: cbor, hasher: sha256 });
  //     const message = await messageStore.get(cid);

  //     expect(message).to.be.undefined;
  //   });
  // });

  // describe('query', () => {});

  // describe('delete', () => {});

});