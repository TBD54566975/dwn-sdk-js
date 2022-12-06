import { CollectionsWriteMessage } from '../../src/interfaces/collections/types';
import { expect } from 'chai';
import { generateCid } from '../../src/utils/cid';
import { Message } from '../../src/core';
import { MessageStoreLevel } from '../../src/store/message-store-level';
import { TestDataGenerator } from '../utils/test-data-generator';

let messageStore: MessageStoreLevel;

describe('MessageStoreLevel Tests', () => {
  describe('buildIndexQueryTerms', () => {
    it('returns an array of terms based on the query object type provided', () => {
      const query = {
        method        : 'CollectionsQuery',
        schema        : 'https://schema.org/MusicPlaylist',
        objectId      : 'abcd123',
        published     : true, // boolean type
        publishedDate : 1234567 // number type
      };

      const expected = [
        { FIELD: ['method'], VALUE: 'CollectionsQuery' },
        { FIELD: ['schema'], VALUE: 'https://schema.org/MusicPlaylist' },
        { FIELD: ['objectId'], VALUE: 'abcd123' },
        { FIELD: ['published'], VALUE: true },
        { FIELD: ['publishedDate'], VALUE: 1234567 }
      ];
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
        { FIELD: ['requester'], VALUE: 'AlBorland' },
        { FIELD: ['ability.method'], VALUE: 'CollectionsQuery' },
        { FIELD: ['ability.schema'], VALUE: 'https://schema.org/MusicPlaylist' },
        { FIELD: ['ability.doo.bingo'], VALUE: 'bongo' }
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
      const { message } = await TestDataGenerator.generatePermissionsRequestMessage();

      await messageStore.put(message, { });

      const expectedCid = await generateCid(message);

      const jsonMessage = await messageStore.get(expectedCid);
      const resultCid = await generateCid(jsonMessage);

      expect(resultCid.equals(expectedCid)).to.be.true;
    });

    it('adds tenant to index', async () => {
      const { target, message } = await TestDataGenerator.generatePermissionsRequestMessage();

      await messageStore.put(message, { target });

      const results = await messageStore.query({ target });
      expect(results.length).to.equal(1);
    });

    it('should be able to update (delete and insert new) indexes to an existing message', async () => {
      const { target, message } = await TestDataGenerator.generateCollectionsWriteMessage();

      // inserting the message indicating it is the 'latest' in the index
      await messageStore.put(message, { target: target.did, latest: 'true' });

      const results1 = await messageStore.query({ target: target.did, latest: 'true' });
      expect(results1.length).to.equal(1);

      const results2 = await messageStore.query({ target: target.did, latest: 'false' });
      expect(results2.length).to.equal(0);

      // deleting the existing indexes and replacing it indicating it is no longer the 'latest'
      const cid = await Message.getCid(message);
      await messageStore.delete(cid);
      await messageStore.put(message, { target: target.did, latest: 'false' });

      const results3 = await messageStore.query({ target: target.did, latest: 'true' });
      expect(results3.length).to.equal(0);

      const results4 = await messageStore.query({ target: target.did, latest: 'false' });
      expect(results4.length).to.equal(1);
    });

    it('should index properties with characters beyond just letters and digits', async () => {
      const schema = 'http://my-awesome-schema/awesomeness_schema#awesome-1?id=awesome_1';
      const messageData = await TestDataGenerator.generateCollectionsWriteMessage({ schema });

      await messageStore.put(messageData.message, { });

      const results = await messageStore.query({ schema });
      expect((results[0] as CollectionsWriteMessage).descriptor.schema).to.equal(schema);
    });
  });
});