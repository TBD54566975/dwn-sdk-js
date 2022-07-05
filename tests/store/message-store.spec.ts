import { expect } from 'chai';
import { generateCid } from '../../src/utils/cid';
import { ed25519 } from '../../src/jose/algorithms/signing/ed25519';
import { Message } from '../../src/core';
import { MessageStoreLevel } from '../../src/store/message-store-level';
import { PermissionsRequest } from '../../src/interfaces/permissions/messages/permissions-request';

const messageStore = new MessageStoreLevel({
  blockstoreLocation : 'TEST-BLOCKSTORE',
  indexLocation      : 'TEST-INDEX'
});

async function generateMessage(): Promise<Message> {
  const { privateJwk } = await ed25519.generateKeyPair();
  return await PermissionsRequest.create({
    description    : 'drugs',
    grantedBy      : 'did:jank:bob',
    grantedTo      : 'did:jank:alice',
    scope          : { method: 'CollectionsWrite' },
    signatureInput : { jwkPrivate: privateJwk, protectedHeader: { alg: privateJwk.alg as string, kid: 'whatev' } }
  });
}

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
      await messageStore.open();
    });

    afterEach(async () => {
      await messageStore.clear();
    });

    after(async () => {
      await messageStore.close();
    });

    it('stores messages as cbor/sha256 encoded blocks with CID as key', async () => {
      const ctx = { tenant: 'doodeedoo' };
      const message = await generateMessage();

      await messageStore.put(message, ctx);

      const expectedCid = await generateCid(message.toObject());

      const jsonMessage = await messageStore.get(expectedCid, ctx);
      const resultCid = await generateCid(jsonMessage);

      expect(resultCid.equals(expectedCid)).to.be.true;
    });

    it('adds author to index', async () => {
      const ctx = { tenant: 'doodeedoo', author: 'chickenparfait' };
      const message = await generateMessage();

      await messageStore.put(message, ctx);

      const results = await messageStore.query({ author: ctx.author }, ctx);
      expect(results.length).to.equal(1);
    });

    it('adds tenant to index', async () => {
      const ctx = { tenant: 'doodeedoo', author: 'chickenparfait' };
      const message = await generateMessage();

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