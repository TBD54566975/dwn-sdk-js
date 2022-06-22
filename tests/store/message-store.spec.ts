// import { expect } from 'chai';
// import { MessageStoreLevel } from '../../src/store/message-store-level';

// import { sha256 } from 'multiformats/hashes/sha2';

// import * as cbor from '@ipld/dag-cbor';
// import * as block from 'multiformats/block';

// const messageStore = new MessageStoreLevel({
//   blockstoreLocation : 'TEST-BLOCKSTORE',
//   indexLocation      : 'TEST-INDEX'
// });

// describe('MessageStoreLevel Tests', () => {
//   describe('buildIndexQueryTerms', () => {
//     it('returns an array of terms based on the query object provided', () => {
//       const query = {
//         method   : 'CollectionsQuery',
//         schema   : 'https://schema.org/MusicPlaylist',
//         objectId : 'abcd123'
//       };

//       const expected = ['method:CollectionsQuery', 'schema:https://schema.org/MusicPlaylist', 'objectId:abcd123'];
//       const terms = MessageStoreLevel['buildIndexQueryTerms'](query);

//       expect(terms).to.eql(expected);
//     });

//     it('flattens nested objects', () => {
//       const query = {
//         requester : 'AlBorland',
//         ability   : {
//           method : 'CollectionsQuery',
//           schema : 'https://schema.org/MusicPlaylist',
//           doo    : {
//             bingo: 'bongo'
//           }
//         }
//       };

//       const expected = [
//         'requester:AlBorland',
//         'ability.method:CollectionsQuery',
//         'ability.schema:https://schema.org/MusicPlaylist',
//         'ability.doo.bingo:bongo'
//       ];

//       const terms = MessageStoreLevel['buildIndexQueryTerms'](query);

//       expect(terms).to.eql(expected);
//     });
//   });

//   describe('put', function () {
//     before(async () => {
//       await messageStore.open();
//     });

//     afterEach(async () => {
//       await messageStore.clear();
//     });

//     after(async () => {
//       await messageStore.close();
//     });

//     it('stores messages as cbor/sha256 encoded blocks with CID as key', async () => {
//       const msg = {
//         'descriptor': {
//           'ability': {
//             'description' : 'some description',
//             'method'      : 'CollectionsWrite',
//             'schema'      : 'https://schema.org/MusicPlaylist'
//           },
//           'method'    : 'PermissionsRequest' as const,
//           'objectId'  : '03754d75-c6b9-4fdd-891f-7eb2ad4bbd21',
//           'requester' : 'did:jank:alice'
//         },
//         'attestation': {
//           'payload'   : 'farts',
//           'protected' : 'farts',
//           'signature' : 'farts'
//         }
//       };

//       await messageStore.put(msg);

//       const expectedBlock = await block.encode({ value: msg, codec: cbor, hasher: sha256 });

//       const hasBlock = await messageStore.db.has(expectedBlock.cid);
//       expect(hasBlock).to.be.true;

//       const blockBytes = await messageStore.db.get(expectedBlock.cid);
//       expect(blockBytes).to.eql(expectedBlock.bytes);
//     });

//     it('adds message to index', async () => {
//       const msg = {
//         'descriptor': {
//           'ability': {
//             'description' : 'some description',
//             'method'      : 'CollectionsWrite',
//             'schema'      : 'https://schema.org/MusicPlaylist'
//           },
//           'method'    : 'PermissionsRequest' as const,
//           'objectId'  : '03754d75-c6b9-4fdd-891f-7eb2ad4bbd21',
//           'requester' : 'did:jank:alice'
//         },
//         'attestation': {
//           'payload'   : 'farts',
//           'protected' : 'farts',
//           'signature' : 'farts'
//         }
//       };

//       await messageStore.put(msg);
//       const { RESULT_LENGTH } = await messageStore.index.QUERY('ability.method:CollectionsWrite');
//       expect(RESULT_LENGTH).to.equal(1);

//     });
//   });


//   describe('get', () => {
//     before(async () => {
//       await messageStore.open();
//     });

//     afterEach(async () => {
//       await messageStore.clear();
//     });

//     after(async () => {
//       await messageStore.close();
//     });


//     it('returns undefined if message does not exist', async () => {
//       const { cid } = await block.encode({ value: { beep: 'boop' }, codec: cbor, hasher: sha256 });
//       const message = await messageStore.get(cid);

//       expect(message).to.be.undefined;
//     });
//   });

//   describe('query', () => {});

//   describe('delete', () => {});

// });