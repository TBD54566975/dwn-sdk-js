import type {
  DataStore,
  EventLog,
  MessageStore,
  ProtocolDefinition
} from '../../src/index.js';



import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import chai, { expect } from 'chai';

import anyoneCollaborateProtocolDefinition from '../vectors/protocol-definitions/anyone-collaborate.json' assert { type: 'json' };
import authorCanProtocolDefinition from '../vectors/protocol-definitions/author-can.json' assert { type: 'json' };
import friendRoleProtocolDefinition from '../vectors/protocol-definitions/friend-role.json' assert { type: 'json' };
import recipientCanProtocolDefinition from '../vectors/protocol-definitions/recipient-can.json' assert { type: 'json' };
import threadRoleProtocolDefinition from '../vectors/protocol-definitions/thread-role.json' assert { type: 'json' };

import { ArrayUtility } from '../../src/utils/array.js';
import { DidKeyResolver } from '../../src/did/did-key-resolver.js';
import { DwnErrorCode } from '../../src/index.js';
import { DwnMethodName } from '../../src/enums/dwn-interface-method.js';
import { Message } from '../../src/core/message.js';
import { normalizeSchemaUrl } from '../../src/utils/url.js';
import { RecordsDeleteHandler } from '../../src/handlers/records-delete.js';
import { stubInterface } from 'ts-sinon';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestStores } from '../test-stores.js';
import { TestStubGenerator } from '../utils/test-stub-generator.js';
import { Time } from '../../src/utils/time.js';
import { DataStream, DidResolver, Dwn, Encoder, Jws, RecordsDelete, RecordsRead, RecordsWrite } from '../../src/index.js';

chai.use(chaiAsPromised);

export function testRecordsDeleteHandler(): void {
  describe('RecordsDeleteHandler.handle()', () => {
    let didResolver: DidResolver;
    let messageStore: MessageStore;
    let dataStore: DataStore;
    let eventLog: EventLog;
    let dwn: Dwn;

    describe('functional tests', () => {

      // important to follow the `before` and `after` pattern to initialize and clean the stores in tests
      // so that different test suites can reuse the same backend store for testing
      before(async () => {
        didResolver = new DidResolver([new DidKeyResolver()]);

        const stores = TestStores.get();
        messageStore = stores.messageStore;
        dataStore = stores.dataStore;
        eventLog = stores.eventLog;

        dwn = await Dwn.create({ didResolver, messageStore, dataStore, eventLog });
      });

      beforeEach(async () => {
        sinon.restore(); // wipe all previous stubs/spies/mocks/fakes

        // clean up before each test rather than after so that a test does not depend on other tests to do the clean up
        await messageStore.clear();
        await dataStore.clear();
        await eventLog.clear();
      });

      after(async () => {
        await dwn.close();
      });

      it('should handle RecordsDelete successfully and return 404 if deleting a deleted record', async () => {
        const alice = await DidKeyResolver.generate();

        // insert data
        const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ author: alice });
        const writeReply = await dwn.processMessage(alice.did, message, { dataStream });
        expect(writeReply.status.code).to.equal(202);

        // ensure data is inserted
        const queryData = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : { recordId: message.recordId }
        });

        const reply = await dwn.processMessage(alice.did, queryData.message);
        expect(reply.status.code).to.equal(200);
        expect(reply.entries?.length).to.equal(1);

        // testing delete
        const recordsDelete = await RecordsDelete.create({
          recordId : message.recordId,
          signer   : Jws.createSigner(alice)
        });

        const deleteReply = await dwn.processMessage(alice.did, recordsDelete.message);
        expect(deleteReply.status.code).to.equal(202);

        // ensure a query will no longer find the deleted record
        const reply2 = await dwn.processMessage(alice.did, queryData.message);
        expect(reply2.status.code).to.equal(200);
        expect(reply2.entries?.length).to.equal(0);

        // testing deleting a deleted record
        const recordsDelete2 = await RecordsDelete.create({
          recordId : message.recordId,
          signer   : Jws.createSigner(alice)
        });

        const recordsDelete2Reply = await dwn.processMessage(alice.did, recordsDelete2.message);
        expect(recordsDelete2Reply.status.code).to.equal(404);
      });

      it('should not affect other records or tenants with the same data', async () => {
        const alice = await DidKeyResolver.generate();
        const bob = await DidKeyResolver.generate();
        const data = Encoder.stringToBytes('test');

        // alice writes a records with data
        const aliceWriteData = await TestDataGenerator.generateRecordsWrite({ author: alice, data });
        const aliceWriteReply = await dwn.processMessage(alice.did, aliceWriteData.message, { dataStream: aliceWriteData.dataStream });
        expect(aliceWriteReply.status.code).to.equal(202);

        // alice writes another record with the same data
        const aliceAssociateData = await TestDataGenerator.generateRecordsWrite({ author: alice, data });
        const aliceAssociateReply = await dwn.processMessage(alice.did, aliceAssociateData.message, { dataStream: aliceAssociateData.dataStream });
        expect(aliceAssociateReply.status.code).to.equal(202);

        // bob writes a records with same data
        const bobWriteData = await TestDataGenerator.generateRecordsWrite({ author: bob, data });
        const bobWriteReply = await dwn.processMessage(bob.did, bobWriteData.message, { dataStream: bobWriteData.dataStream });
        expect(bobWriteReply.status.code).to.equal(202);

        // bob writes another record with the same data
        const bobAssociateData = await TestDataGenerator.generateRecordsWrite({ author: bob, data });
        const bobAssociateReply = await dwn.processMessage(bob.did, bobAssociateData.message, { dataStream: bobAssociateData.dataStream });
        expect(bobAssociateReply.status.code).to.equal(202);

        // alice deletes one of the two records
        const aliceDeleteWriteData = await TestDataGenerator.generateRecordsDelete({
          author   : alice,
          recordId : aliceWriteData.message.recordId
        });
        const aliceDeleteWriteReply = await dwn.processMessage(alice.did, aliceDeleteWriteData.message);
        expect(aliceDeleteWriteReply.status.code).to.equal(202);

        // verify the other record with the same data is unaffected
        const aliceRead1 = await RecordsRead.create({
          filter: {
            recordId: aliceAssociateData.message.recordId,
          },
          signer: Jws.createSigner(alice)
        });

        const aliceRead1Reply = await dwn.processMessage(alice.did, aliceRead1.message);
        expect(aliceRead1Reply.status.code).to.equal(200);

        const aliceDataFetched = await DataStream.toBytes(aliceRead1Reply.record!.data!);
        expect(ArrayUtility.byteArraysEqual(aliceDataFetched, data)).to.be.true;

        // alice deletes the other record
        const aliceDeleteAssociateData = await TestDataGenerator.generateRecordsDelete({
          author   : alice,
          recordId : aliceAssociateData.message.recordId
        });
        const aliceDeleteAssociateReply = await dwn.processMessage(alice.did, aliceDeleteAssociateData.message);
        expect(aliceDeleteAssociateReply.status.code).to.equal(202);

        // verify that alice can no longer fetch the 2nd record
        const aliceRead2Reply = await dwn.processMessage(alice.did, aliceRead1.message);
        expect(aliceRead2Reply.status.code).to.equal(404);

        // verify that bob can still fetch record with the same data
        const bobRead1 = await RecordsRead.create({
          filter: {
            recordId: bobAssociateData.message.recordId,
          },
          signer: Jws.createSigner(bob)
        });

        const bobRead1Reply = await dwn.processMessage(bob.did, bobRead1.message);
        expect(bobRead1Reply.status.code).to.equal(200);

        const bobDataFetched = await DataStream.toBytes(bobRead1Reply.record!.data!);
        expect(ArrayUtility.byteArraysEqual(bobDataFetched, data)).to.be.true;
      });

      it('should return 404 if deleting a non-existent record', async () => {
        const alice = await DidKeyResolver.generate();

        // testing deleting a non-existent record
        const recordsDelete = await RecordsDelete.create({
          recordId : 'nonExistentRecordId',
          signer   : Jws.createSigner(alice)
        });

        const deleteReply = await dwn.processMessage(alice.did, recordsDelete.message);
        expect(deleteReply.status.code).to.equal(404);
      });

      it('should be disallowed if there is a newer RecordsWrite already in the DWN ', async () => {
        const alice = await DidKeyResolver.generate();

        // initial write
        const initialWriteData = await TestDataGenerator.generateRecordsWrite({ author: alice });
        const initialWriteReply = await dwn.processMessage(alice.did, initialWriteData.message, { dataStream: initialWriteData.dataStream });
        expect(initialWriteReply.status.code).to.equal(202);

        // generate subsequent write and delete with the delete having an earlier timestamp
        // NOTE: creating RecordsDelete first ensures it has an earlier `messageTimestamp` time
        const recordsDelete = await RecordsDelete.create({
          recordId : initialWriteData.message.recordId,
          signer   : Jws.createSigner(alice)
        });
        await Time.minimalSleep();
        const subsequentWriteData = await TestDataGenerator.generateFromRecordsWrite({
          existingWrite : initialWriteData.recordsWrite,
          author        : alice
        });

        // subsequent write
        const subsequentWriteReply = await dwn.processMessage(alice.did, subsequentWriteData.message, { dataStream: subsequentWriteData.dataStream });
        expect(subsequentWriteReply.status.code).to.equal(202);

        // test that a delete with an earlier `messageTimestamp` results in a 409
        const deleteReply = await dwn.processMessage(alice.did, recordsDelete.message);
        expect(deleteReply.status.code).to.equal(409);

        // ensure data still exists
        const queryData = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : { recordId: initialWriteData.message.recordId }
        });
        const expectedEncodedData = Encoder.bytesToBase64Url(subsequentWriteData.dataBytes);
        const reply = await dwn.processMessage(alice.did, queryData.message);
        expect(reply.status.code).to.equal(200);
        expect(reply.entries?.length).to.equal(1);
        expect(reply.entries![0].encodedData).to.equal(expectedEncodedData);
      });

      it('should be able to delete then rewrite the same data', async () => {
        const alice = await DidKeyResolver.generate();
        const data = Encoder.stringToBytes('test');
        const encodedData = Encoder.bytesToBase64Url(data);

        // alice writes a record
        const aliceWriteData = await TestDataGenerator.generateRecordsWrite({
          author: alice,
          data
        });
        const aliceWriteReply = await dwn.processMessage(alice.did, aliceWriteData.message, { dataStream: aliceWriteData.dataStream });
        expect(aliceWriteReply.status.code).to.equal(202);

        const aliceQueryWriteAfterAliceWriteData = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : { recordId: aliceWriteData.message.recordId }
        });
        const aliceQueryWriteAfterAliceWriteReply = await dwn.processMessage(alice.did, aliceQueryWriteAfterAliceWriteData.message);
        expect(aliceQueryWriteAfterAliceWriteReply.status.code).to.equal(200);
        expect(aliceQueryWriteAfterAliceWriteReply.entries?.length).to.equal(1);
        expect(aliceQueryWriteAfterAliceWriteReply.entries![0].encodedData).to.equal(encodedData);

        // alice deleting the record
        const aliceDeleteWriteData = await TestDataGenerator.generateRecordsDelete({
          author   : alice,
          recordId : aliceWriteData.message.recordId
        });
        const aliceDeleteWriteReply = await dwn.processMessage(alice.did, aliceDeleteWriteData.message);
        expect(aliceDeleteWriteReply.status.code).to.equal(202);

        const aliceQueryWriteAfterAliceDeleteData = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : { recordId: aliceWriteData.message.recordId }
        });
        const aliceQueryWriteAfterAliceDeleteReply = await dwn.processMessage(alice.did, aliceQueryWriteAfterAliceDeleteData.message);
        expect(aliceQueryWriteAfterAliceDeleteReply.status.code).to.equal(200);
        expect(aliceQueryWriteAfterAliceDeleteReply.entries?.length).to.equal(0);

        // alice writes a new record with the same data
        const aliceRewriteData = await TestDataGenerator.generateRecordsWrite({
          author: alice,
          data
        });
        const aliceRewriteReply = await dwn.processMessage(alice.did, aliceRewriteData.message, { dataStream: aliceRewriteData.dataStream });
        expect(aliceRewriteReply.status.code).to.equal(202);

        const aliceQueryWriteAfterAliceRewriteData = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : { recordId: aliceRewriteData.message.recordId }
        });
        const aliceQueryWriteAfterAliceRewriteReply = await dwn.processMessage(alice.did, aliceQueryWriteAfterAliceRewriteData.message);
        expect(aliceQueryWriteAfterAliceRewriteReply.status.code).to.equal(200);
        expect(aliceQueryWriteAfterAliceRewriteReply.entries?.length).to.equal(1);
        expect(aliceQueryWriteAfterAliceRewriteReply.entries![0].encodedData).to.equal(encodedData);
      });

      describe('protocol based deletes', () => {
        it('should allow delete with allow-anyone rule', async () => {
          // scenario: Alice creates a record in her DWN. Bob (anyone) is able to delete the record.

          const protocolDefinition = anyoneCollaborateProtocolDefinition as ProtocolDefinition;
          const alice = await TestDataGenerator.generatePersona();
          const bob = await TestDataGenerator.generatePersona();

          const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition
          });

          // setting up a stub DID resolver
          TestStubGenerator.stubDidResolver(didResolver, [alice, bob]);

          const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
          expect(protocolsConfigureReply.status.code).to.equal(202);

          // Alice writes a record
          const recordsWrite = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'doc',
          });
          const recordsWriteReply = await dwn.processMessage(alice.did, recordsWrite.message, { dataStream: recordsWrite.dataStream });
          expect(recordsWriteReply.status.code).to.eq(202);

          // Bob (anyone) is able to delete the record
          const recordsDelete = await TestDataGenerator.generateRecordsDelete({
            author   : bob,
            recordId : recordsWrite.message.recordId,
          });
          const recordsDeleteReply = await dwn.processMessage(alice.did, recordsDelete.message);
          expect(recordsDeleteReply.status.code).to.eq(202);
        });

        describe('recipient rules', () => {
          it('should allow delete with ancestor recipient rule', async () => {
            // scenario: Alice creates a 'post' with Bob as recipient and a 'post/tag'. Bob is able to delete
            //           the 'chat/tag' because he was recipient of the 'chat'. Carol is not able to delete.

            const protocolDefinition = recipientCanProtocolDefinition as ProtocolDefinition;
            const alice = await TestDataGenerator.generatePersona();
            const bob = await TestDataGenerator.generatePersona();
            const carol = await TestDataGenerator.generatePersona();

            const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
              author: alice,
              protocolDefinition
            });

            // setting up a stub DID resolver
            TestStubGenerator.stubDidResolver(didResolver, [alice, bob, carol]);

            const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
            expect(protocolsConfigureReply.status.code).to.equal(202);

            // Alice writes a chat
            const chatRecordsWrite = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              recipient    : bob.did,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'post',
            });
            const chatRecordsWriteReply = await dwn.processMessage(alice.did, chatRecordsWrite.message, { dataStream: chatRecordsWrite.dataStream });
            expect(chatRecordsWriteReply.status.code).to.eq(202);

            // Alice writes a 'chat/tag'
            const tagRecordsWrite = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'post/tag',
              contextId    : chatRecordsWrite.message.contextId,
              parentId     : chatRecordsWrite.message.recordId,
            });
            const tagRecordsWriteReply = await dwn.processMessage(alice.did, tagRecordsWrite.message, { dataStream: tagRecordsWrite.dataStream });
            expect(tagRecordsWriteReply.status.code).to.eq(202);

            // Carol is unable to delete the 'chat/tag'
            const recordsDeleteCarol = await TestDataGenerator.generateRecordsDelete({
              author   : carol,
              recordId : tagRecordsWrite.message.recordId,
            });
            const recordsDeleteCarolReply = await dwn.processMessage(alice.did, recordsDeleteCarol.message);
            expect(recordsDeleteCarolReply.status.code).to.eq(401);
            expect(recordsDeleteCarolReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationActionNotAllowed);

            // Bob is able to delete the 'chat/tag'
            const recordsDelete = await TestDataGenerator.generateRecordsDelete({
              author   : bob,
              recordId : tagRecordsWrite.message.recordId,
            });
            const recordsDeleteReply = await dwn.processMessage(alice.did, recordsDelete.message);
            expect(recordsDeleteReply.status.code).to.eq(202);
          });

          it('should allow delete with direct recipient rule', async () => {
            // scenario: Alice creates a 'post' with Bob as recipient. Bob is able to delete
            //           the 'post' because he was recipient of it. Carol is not able to delete.

            const protocolDefinition = recipientCanProtocolDefinition as ProtocolDefinition;
            const alice = await TestDataGenerator.generatePersona();
            const bob = await TestDataGenerator.generatePersona();
            const carol = await TestDataGenerator.generatePersona();

            const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
              author: alice,
              protocolDefinition
            });

            // setting up a stub DID resolver
            TestStubGenerator.stubDidResolver(didResolver, [alice, bob, carol]);

            const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
            expect(protocolsConfigureReply.status.code).to.equal(202);

            // Alice creates a 'post' with Bob as recipient
            const recordsWrite = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              recipient    : bob.did,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'post',
            });
            const recordsWriteReply = await dwn.processMessage(alice.did, recordsWrite.message, { dataStream: recordsWrite.dataStream });
            expect(recordsWriteReply.status.code).to.eq(202);

            // Carol is unable to delete the 'post'
            const carolRecordsDelete = await TestDataGenerator.generateRecordsDelete({
              author   : carol,
              recordId : recordsWrite.message.recordId,
            });
            const carolRecordsDeleteReply = await dwn.processMessage(alice.did, carolRecordsDelete.message);
            expect(carolRecordsDeleteReply.status.code).to.eq(401);
            expect(carolRecordsDeleteReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationActionNotAllowed);

            // Bob is able to delete the post
            const bobRecordsDelete = await TestDataGenerator.generateRecordsDelete({
              author   : bob,
              recordId : recordsWrite.message.recordId,
            });
            const bobRecordsDeleteReply = await dwn.processMessage(alice.did, bobRecordsDelete.message);
            expect(bobRecordsDeleteReply.status.code).to.eq(202);
          });
        });

        describe('author action rules', () => {
          it('allow author to delete with ancestor author rule', async () => {
            // scenario: Bob writes a 'post' and Alice writes a 'post/comment' to her DWN. Bob deletes the comment
            //           because author of post can delete. Carol is unable to delete the comment.

            const protocolDefinition = authorCanProtocolDefinition as ProtocolDefinition;
            const alice = await TestDataGenerator.generatePersona();
            const bob = await TestDataGenerator.generatePersona();
            const carol = await TestDataGenerator.generatePersona();

            const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
              author: alice,
              protocolDefinition
            });

            // setting up a stub DID resolver
            TestStubGenerator.stubDidResolver(didResolver, [alice, bob, carol]);

            const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
            expect(protocolsConfigureReply.status.code).to.equal(202);

            // Bob writes a post
            const postRecordsWrite = await TestDataGenerator.generateRecordsWrite({
              author       : bob,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'post',
            });
            const postRecordsWriteReply = await dwn.processMessage(alice.did, postRecordsWrite.message, { dataStream: postRecordsWrite.dataStream });
            expect(postRecordsWriteReply.status.code).to.eq(202);

            // Alice writes a 'post/comment'
            const commentRecordsWrite = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'post/comment',
              contextId    : postRecordsWrite.message.contextId,
              parentId     : postRecordsWrite.message.recordId,
            });
            const commentRecordsWriteReply =
              await dwn.processMessage(alice.did, commentRecordsWrite.message, { dataStream: commentRecordsWrite.dataStream });
            expect(commentRecordsWriteReply.status.code).to.eq(202);

            // Carol is unable to delete Alice's 'post/comment'
            const recordsDeleteCarol = await TestDataGenerator.generateRecordsDelete({
              author   : carol,
              recordId : commentRecordsWrite.message.recordId,
            });
            const recordsDeleteCarolReply = await dwn.processMessage(alice.did, recordsDeleteCarol.message);
            expect(recordsDeleteCarolReply.status.code).to.eq(401);
            expect(recordsDeleteCarolReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationActionNotAllowed);

            // Bob is able to delete the Alice's 'post/comment'
            const recordsDelete = await TestDataGenerator.generateRecordsDelete({
              author   : bob,
              recordId : commentRecordsWrite.message.recordId,
            });
            const recordsDeleteReply = await dwn.processMessage(alice.did, recordsDelete.message);
            expect(recordsDeleteReply.status.code).to.eq(202);
          });
        });

        describe('role based deletes', () => {
          it('should allow deletes with $contextRole', async () => {
            // scenario: Alice adds Bob as a 'thread/admin' $contextRole. She writes a 'thread/chat'.
            //           Bob invokes his admin role to delete the 'thread/chat'. Carol is unable to delete
            //           the 'thread/chat'.

            const alice = await DidKeyResolver.generate();
            const bob = await DidKeyResolver.generate();
            const carol = await DidKeyResolver.generate();

            const protocolDefinition = threadRoleProtocolDefinition;

            const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
              author: alice,
              protocolDefinition
            });
            const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
            expect(protocolsConfigureReply.status.code).to.equal(202);

            // Alice creates a thread
            const threadRecord = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              recipient    : bob.did,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'thread'
            });
            const threadRecordReply = await dwn.processMessage(alice.did, threadRecord.message, { dataStream: threadRecord.dataStream });
            expect(threadRecordReply.status.code).to.equal(202);

            // Alice adds Bob as a 'thread/admin' in that thread
            const participantRecord = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              recipient    : bob.did,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'thread/admin',
              contextId    : threadRecord.message.contextId,
              parentId     : threadRecord.message.recordId,
            });
            const participantRecordReply =
              await dwn.processMessage(alice.did, participantRecord.message, { dataStream: participantRecord.dataStream });
            expect(participantRecordReply.status.code).to.equal(202);

            // Alice writes a chat message in that thread
            const chatRecord = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              recipient    : alice.did,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'thread/chat',
              contextId    : threadRecord.message.contextId,
              parentId     : threadRecord.message.recordId,
            });
            const chatRecordReply = await dwn.processMessage(alice.did, chatRecord.message, { dataStream: chatRecord.dataStream });
            expect(chatRecordReply.status.code).to.equal(202);

            const chatDeleteCarol = await TestDataGenerator.generateRecordsDelete({
              author   : carol,
              recordId : chatRecord.message.recordId,
            });
            const chatDeleteReplyCarol = await dwn.processMessage(alice.did, chatDeleteCarol.message);
            expect(chatDeleteReplyCarol.status.code).to.eq(401);
            expect(chatDeleteReplyCarol.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationActionNotAllowed);

            // Bob invokes the role to delete the chat message
            const chatDelete = await TestDataGenerator.generateRecordsDelete({
              author       : bob,
              recordId     : chatRecord.message.recordId,
              protocolRole : 'thread/admin',
            });
            const chatDeleteReply = await dwn.processMessage(alice.did, chatDelete.message);
            expect(chatDeleteReply.status.code).to.equal(202);
          });

          it('should allow delete with $globalRole', async () => {
            // scenario: Alice adds Bob as an 'admin' $globalRole. She writes a 'chat'.
            //           Bob invokes his admin role to delete the 'chat'.

            const alice = await DidKeyResolver.generate();
            const bob = await DidKeyResolver.generate();
            const carol = await DidKeyResolver.generate();

            const protocolDefinition = friendRoleProtocolDefinition;

            const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
              author: alice,
              protocolDefinition
            });
            const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
            expect(protocolsConfigureReply.status.code).to.equal(202);

            // Alice adds Bob as a 'thread/admin' in that thread
            const participantRecord = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              recipient    : bob.did,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'admin',
            });
            const participantRecordReply =
              await dwn.processMessage(alice.did, participantRecord.message, { dataStream: participantRecord.dataStream });
            expect(participantRecordReply.status.code).to.equal(202);

            // Alice writes a chat message in that thread
            const chatRecord = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              recipient    : alice.did,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'chat',
            });
            const chatRecordReply = await dwn.processMessage(alice.did, chatRecord.message, { dataStream: chatRecord.dataStream });
            expect(chatRecordReply.status.code).to.equal(202);

            // Carol is unable to delete the chat message
            const chatDeleteCarol = await TestDataGenerator.generateRecordsDelete({
              author   : carol,
              recordId : chatRecord.message.recordId,
            });
            const chatDeleteCarolReply = await dwn.processMessage(alice.did, chatDeleteCarol.message);
            expect(chatDeleteCarolReply.status.code).to.equal(401);
            expect(chatDeleteCarolReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationActionNotAllowed);

            // Bob invokes the role to delete the chat message
            const chatDelete = await TestDataGenerator.generateRecordsDelete({
              author       : bob,
              recordId     : chatRecord.message.recordId,
              protocolRole : 'admin',
            });
            const chatDeleteReply = await dwn.processMessage(alice.did, chatDelete.message);
            expect(chatDeleteReply.status.code).to.equal(202);
          });
        });
      });

      it('should return 401 if message is not authorized', async () => {
        // scenario: Alice creates a record and Bob is unable to delete it.

        const alice = await DidKeyResolver.generate();
        const bob = await DidKeyResolver.generate();

        const recordsWrite = await TestDataGenerator.generateRecordsWrite({
          author: alice,
        });
        const recordsWriteReply = await dwn.processMessage(alice.did, recordsWrite.message, { dataStream: recordsWrite.dataStream });
        expect(recordsWriteReply.status.code).to.equal(202);

        const recordsDelete = await TestDataGenerator.generateRecordsDelete({
          author   : bob,
          recordId : recordsWrite.message.recordId,
        });
        const recordsDeleteReply = await dwn.processMessage(alice.did, recordsDelete.message);
        expect(recordsDeleteReply.status.code).to.equal(401);
        expect(recordsDeleteReply.status.detail).to.contain(DwnErrorCode.RecordsDeleteAuthorizationFailed);
      });

      it('should index additional properties from the RecordsWrite being deleted', async () => {
        const alice = await DidKeyResolver.generate();

        // initial write
        const initialWriteData = await TestDataGenerator.generateRecordsWrite({ author: alice, schema: 'testSchema' });
        const initialWriteReply = await dwn.processMessage(alice.did, initialWriteData.message, { dataStream: initialWriteData.dataStream });
        expect(initialWriteReply.status.code).to.equal(202);

        // generate subsequent write and delete with the delete having an earlier timestamp
        // NOTE: creating RecordsDelete first ensures it has an earlier `messageTimestamp` time
        const recordsDelete = await RecordsDelete.create({
          recordId : initialWriteData.message.recordId,
          signer   : Jws.createSigner(alice)
        });
        const deleteMessageCid = await Message.getCid(recordsDelete.message);

        const deleteReply = await dwn.processMessage(alice.did, recordsDelete.message);
        expect(deleteReply.status.code).to.equal(202);

        // message store
        const { messages } = await messageStore.query(alice.did, [{ schema: normalizeSchemaUrl('testSchema'), method: DwnMethodName.Delete }]);
        expect(messages.length).to.equal(1);
        expect(await Message.getCid(messages[0])).to.equal(deleteMessageCid);

        // event log
        const { entries: events } = await eventLog.queryEvents(alice.did, [{ schema: normalizeSchemaUrl('testSchema'), method: DwnMethodName.Delete }]);
        expect(events.length).to.equal(1);
        expect(events[0]).to.equal(deleteMessageCid);
      });

      describe('event log', () => {
        it('should include RecordsDelete event and keep initial RecordsWrite event', async () => {
          const alice = await DidKeyResolver.generate();

          const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ author: alice });
          const writeReply = await dwn.processMessage(alice.did, message, { dataStream });
          expect(writeReply.status.code).to.equal(202);

          const recordsDelete = await RecordsDelete.create({
            recordId : message.recordId,
            signer   : Jws.createSigner(alice)
          });

          const deleteReply = await dwn.processMessage(alice.did, recordsDelete.message);
          expect(deleteReply.status.code).to.equal(202);

          const { entries: events } = await eventLog.getEvents(alice.did);
          expect(events.length).to.equal(2);

          const writeMessageCid = await Message.getCid(message);
          const deleteMessageCid = await Message.getCid(recordsDelete.message);
          const expectedMessageCids = new Set([writeMessageCid, deleteMessageCid]);

          for (const messageCid of events) {
            expectedMessageCids.delete(messageCid);
          }

          expect(expectedMessageCids.size).to.equal(0);
        });

        it('should only keep first write and delete when subsequent writes happen', async () => {
          const { message, author, dataStream, recordsWrite } = await TestDataGenerator.generateRecordsWrite();
          TestStubGenerator.stubDidResolver(didResolver, [author]);

          const reply = await dwn.processMessage(author.did, message, { dataStream });
          expect(reply.status.code).to.equal(202);

          const newWrite = await RecordsWrite.createFrom({
            recordsWriteMessage : recordsWrite.message,
            published           : true,
            signer              : Jws.createSigner(author)
          });

          const newWriteReply = await dwn.processMessage(author.did, newWrite.message);
          expect(newWriteReply.status.code).to.equal(202);

          const recordsDelete = await RecordsDelete.create({
            recordId : message.recordId,
            signer   : Jws.createSigner(author)
          });

          const deleteReply = await dwn.processMessage(author.did, recordsDelete.message);
          expect(deleteReply.status.code).to.equal(202);

          const { entries: events } = await eventLog.getEvents(author.did);
          expect(events.length).to.equal(2);

          const deletedMessageCid = await Message.getCid(newWrite.message);

          for (const messageCid of events) {
            if (messageCid === deletedMessageCid ) {
              expect.fail(`${messageCid} should not exist`);
            }
          }
        });
      });
    });

    it('should return 401 if signature check fails', async () => {
      const { author, message } = await TestDataGenerator.generateRecordsDelete();
      const tenant = author.did;

      // setting up a stub did resolver & message store
      // intentionally not supplying the public key so a different public key is generated to simulate invalid signature
      const mismatchingPersona = await TestDataGenerator.generatePersona({ did: author.did, keyId: author.keyId });
      const didResolver = TestStubGenerator.createDidResolverStub(mismatchingPersona);
      const messageStore = stubInterface<MessageStore>();
      const dataStore = stubInterface<DataStore>();

      const recordsDeleteHandler = new RecordsDeleteHandler(didResolver, messageStore, dataStore, eventLog);
      const reply = await recordsDeleteHandler.handle({ tenant, message });
      expect(reply.status.code).to.equal(401);
    });

    it('should return 400 if fail parsing the message', async () => {
      const { author, message } = await TestDataGenerator.generateRecordsDelete();
      const tenant = author.did;

      // setting up a stub method resolver & message store
      const messageStore = stubInterface<MessageStore>();
      const dataStore = stubInterface<DataStore>();

      const recordsDeleteHandler = new RecordsDeleteHandler(didResolver, messageStore, dataStore, eventLog);

      // stub the `parse()` function to throw an error
      sinon.stub(RecordsDelete, 'parse').throws('anyError');
      const reply = await recordsDeleteHandler.handle({ tenant, message });

      expect(reply.status.code).to.equal(400);
    });
  });
}