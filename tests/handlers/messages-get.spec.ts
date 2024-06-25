import type { DidResolver } from '@web5/dids';
import type { EventStream } from '../../src/types/subscriptions.js';
import type {
  DataStore,
  EventLog,
  MessagesGetReply,
  MessageStore,
  ResumableTaskStore,
} from '../../src/index.js';

import { expect } from 'chai';
import { GeneralJwsVerifier } from '../../src/jose/jws/general/verifier.js';
import { Message } from '../../src/core/message.js';
import minimalProtocolDefinition from '../vectors/protocol-definitions/minimal.json' assert { type: 'json' };
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestEventStream } from '../test-event-stream.js';
import { TestStores } from '../test-stores.js';
import { DataStream, Dwn, DwnConstant, DwnErrorCode, DwnInterfaceName, DwnMethodName, Jws, PermissionGrant, PermissionsProtocol, Time } from '../../src/index.js';
import { DidKey, UniversalResolver } from '@web5/dids';

import sinon from 'sinon';

export function testMessagesGetHandler(): void {
  describe('MessagesGetHandler.handle()', () => {
    let dwn: Dwn;
    let didResolver: DidResolver;
    let messageStore: MessageStore;
    let dataStore: DataStore;
    let resumableTaskStore: ResumableTaskStore;
    let eventLog: EventLog;
    let eventStream: EventStream;

    // important to follow the `before` and `after` pattern to initialize and clean the stores in tests
    // so that different test suites can reuse the same backend store for testing
    before(async () => {
      didResolver = new UniversalResolver({ didResolvers: [DidKey] });

      const stores = TestStores.get();
      messageStore = stores.messageStore;
      dataStore = stores.dataStore;
      resumableTaskStore = stores.resumableTaskStore;
      eventLog = stores.eventLog;
      eventStream = TestEventStream.get();

      dwn = await Dwn.create({ didResolver, messageStore, dataStore, eventLog, eventStream, resumableTaskStore });
    });

    beforeEach(async () => {
    // clean up before each test rather than after so that a test does not depend on other tests to do the clean up
      await messageStore.clear();
      await dataStore.clear();
      await resumableTaskStore.clear();
      await eventLog.clear();

      sinon.restore(); // wipe all previous stubs/spies/mocks/fakes
    });

    after(async () => {
      sinon.restore();
      await dwn.close();
    });

    it('returns a 401 if authentication fails', async () => {
      const alice = await TestDataGenerator.generateDidKeyPersona();

      sinon.stub(GeneralJwsVerifier, 'verifySignatures').throws(new Error('Invalid signature'));

      // alice creates a record
      const { message } = await TestDataGenerator.generateMessagesGet({
        author     : alice,
        messageCid : await TestDataGenerator.randomCborSha256Cid()
      });

      // alice is not the author of the message
      const reply = await dwn.processMessage(alice.did, message);
      expect(reply.status.code).to.equal(401);
      expect(reply.status.detail).to.include('Invalid signature');
    });

    it('returns a 400 if message is invalid', async () => {
      const alice = await TestDataGenerator.generateDidKeyPersona();
      const { recordsWrite } = await TestDataGenerator.generateRecordsWrite({ author: alice });

      const { message } = await TestDataGenerator.generateMessagesGet({
        author     : alice,
        messageCid : await Message.getCid(recordsWrite.message)
      });

      (message['descriptor'] as any)['troll'] = 'hehe';

      const reply = await dwn.processMessage(alice.did, message);

      expect(reply.status.code).to.equal(400);
    });

    it('returns a 400 if message contains an invalid message cid', async () => {
      const alice = await TestDataGenerator.generateDidKeyPersona();
      const { recordsWrite } = await TestDataGenerator.generateRecordsWrite({ author: alice });

      const { message } = await TestDataGenerator.generateMessagesGet({
        author     : alice,
        messageCid : await Message.getCid(recordsWrite.message)
      });

      message.descriptor.messageCid = 'hehetroll';

      const reply: MessagesGetReply = await dwn.processMessage(alice.did, message);

      expect(reply.status.code).to.equal(400);
      expect(reply.status.detail).to.include('is not a valid CID');
      expect(reply.entry).to.be.undefined;
    });

    it('returns a 404 and the entry as undefined in reply entry when a messageCid is not found', async () => {
      const alice = await TestDataGenerator.generateDidKeyPersona();
      const { recordsWrite } = await TestDataGenerator.generateRecordsWrite({ author: alice });
      const recordsWriteMessageCid = await Message.getCid(recordsWrite.message);

      const { message } = await TestDataGenerator.generateMessagesGet({
        author     : alice,
        messageCid : recordsWriteMessageCid
      });

      // returns a 404 because the RecordsWrite created above was never stored
      const reply: MessagesGetReply = await dwn.processMessage(alice.did, message);
      expect(reply.status.code).to.equal(404);
      expect(reply.entry).to.be.undefined;
    });

    describe('without a grant', () =>{
      describe('records interface messages', () => {
        it('returns a 401 if the tenant is not the author', async () => {
          const alice = await TestDataGenerator.generateDidKeyPersona();
          const bob = await TestDataGenerator.generateDidKeyPersona();

          // bob creates a record that alice will try and get
          const { message: recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite({ author: bob });
          const { status } = await dwn.processMessage(bob.did, recordsWrite, { dataStream });
          expect(status.code).to.equal(202);

          // alice tries to get the message
          const { message } = await TestDataGenerator.generateMessagesGet({
            author     : alice,
            messageCid : await Message.getCid(recordsWrite)
          });
          const reply = await dwn.processMessage(bob.did, message);

          expect(reply.status.code).to.equal(401);
          expect(reply.status.detail).to.include(DwnErrorCode.MessagesGetAuthorizationFailed);
        });

        describe('gets record data in the reply entry', () => {
          it('data is less than threshold', async () => {
            const alice = await TestDataGenerator.generateDidKeyPersona();

            const { message: recordsWrite, dataStream, dataBytes } = await TestDataGenerator.generateRecordsWrite({
              author : alice,
              data   : TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded),
            });

            const reply = await dwn.processMessage(alice.did, recordsWrite, { dataStream });
            expect(reply.status.code).to.equal(202);

            const recordsWriteMessageCid = await Message.getCid(recordsWrite);
            const { message } = await TestDataGenerator.generateMessagesGet({
              author     : alice,
              messageCid : recordsWriteMessageCid
            });

            const messagesGetReply: MessagesGetReply = await dwn.processMessage(alice.did, message);
            expect(messagesGetReply.status.code).to.equal(200);
            expect(messagesGetReply.entry).to.exist;

            const messageReply = messagesGetReply.entry!;
            expect(messageReply.messageCid).to.exist;
            expect(messageReply.messageCid).to.equal(recordsWriteMessageCid);

            expect(messageReply.message).to.exist.and.not.be.undefined;
            expect(messageReply.message?.data).to.exist.and.not.be.undefined;
            const messageData = await DataStream.toBytes(messageReply.message!.data!);
            expect(messageData).to.eql(dataBytes);
          });

          it('data is greater than threshold', async () => {
            const alice = await TestDataGenerator.generateDidKeyPersona();

            const { message: recordsWrite, dataStream, dataBytes } = await TestDataGenerator.generateRecordsWrite({
              author : alice,
              data   : TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded + 10),
            });

            const reply = await dwn.processMessage(alice.did, recordsWrite, { dataStream });
            expect(reply.status.code).to.equal(202);

            const recordsWriteMessageCid = await Message.getCid(recordsWrite);
            const { message } = await TestDataGenerator.generateMessagesGet({
              author     : alice,
              messageCid : recordsWriteMessageCid
            });

            const messagesGetReply: MessagesGetReply = await dwn.processMessage(alice.did, message);
            expect(messagesGetReply.status.code).to.equal(200);
            expect(messagesGetReply.entry).to.exist;

            const messageReply = messagesGetReply.entry!;
            expect(messageReply.messageCid).to.exist;
            expect(messageReply.messageCid).to.equal(recordsWriteMessageCid);

            expect(messageReply.message).to.exist.and.not.be.undefined;
            expect(messageReply.message?.data).to.exist.and.not.be.undefined;
            const messageData = await DataStream.toBytes(messageReply.message!.data!);
            expect(messageData).to.eql(dataBytes);
          });

          it('data is not available', async () => {
            const alice = await TestDataGenerator.generateDidKeyPersona();

            // initial write
            const { message: recordsWriteMessage, recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite({
              author : alice,
              data   : TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded + 10),
            });

            const initialMessageCid = await Message.getCid(recordsWriteMessage);

            let reply = await dwn.processMessage(alice.did, recordsWriteMessage, { dataStream });
            expect(reply.status.code).to.equal(202);

            const { recordsWrite: updateMessage, dataStream: updateDataStream } = await TestDataGenerator.generateFromRecordsWrite({
              author        : alice,
              existingWrite : recordsWrite,
              data          : TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded + 10),
            });

            reply = await dwn.processMessage(alice.did, updateMessage.toJSON(), { dataStream: updateDataStream });
            expect(reply.status.code).to.equal(202);

            const { message } = await TestDataGenerator.generateMessagesGet({
              author     : alice,
              messageCid : initialMessageCid
            });

            const messagesGetReply: MessagesGetReply = await dwn.processMessage(alice.did, message);
            expect(messagesGetReply.status.code).to.equal(200);
            expect(messagesGetReply.entry).to.exist;

            const messageReply = messagesGetReply.entry!;
            expect(messageReply.messageCid).to.exist;
            expect(messageReply.messageCid).to.equal(initialMessageCid);

            expect(messageReply.message).to.exist.and.not.be.undefined;
            expect(messageReply.message?.data).to.be.undefined;
          });
        });
      });

      describe('Protocol interface messages', () => {
        it('returns a 401 if the tenant is not the author', async () => {
          // scenario:  Alice configures both a published and non-published protocol and writes it to her DWN.
          //            Bob is unable to get either of the ProtocolConfigure messages because he is not the author.

          const alice = await TestDataGenerator.generateDidKeyPersona();
          const bob = await TestDataGenerator.generateDidKeyPersona();

          // unpublished protocol configuration
          const unpublishedProtocolDefinition = {
            ...minimalProtocolDefinition,
            protocol  : 'http://example.com/protocol/unpublished',
            published : false
          };
          const { message: unpublishedProtocolsConfigure } = await TestDataGenerator.generateProtocolsConfigure({
            author             : alice,
            protocolDefinition : unpublishedProtocolDefinition
          });
          const unpublishedProtocolsConfigureReply = await dwn.processMessage(alice.did, unpublishedProtocolsConfigure);
          expect(unpublishedProtocolsConfigureReply.status.code).to.equal(202);

          // published protocol configuration
          const publishedProtocolDefinition = {
            ...minimalProtocolDefinition,
            protocol  : 'http://example.com/protocol/published',
            published : true
          };
          const { message: publishedProtocolsConfigure } = await TestDataGenerator.generateProtocolsConfigure({
            author             : alice,
            protocolDefinition : publishedProtocolDefinition
          });
          const publishedProtocolsConfigureReply = await dwn.processMessage(alice.did, publishedProtocolsConfigure);
          expect(publishedProtocolsConfigureReply.status.code).to.equal(202);

          // get the message CIDs
          const unpublishedProtocolMessageCid = await Message.getCid(unpublishedProtocolsConfigure);
          const publishedProtocolMessageCid = await Message.getCid(publishedProtocolsConfigure);

          // bob attempts to get the unpublished protocol configuration
          const { message: getUnpublishedProtocolConfigure } = await TestDataGenerator.generateMessagesGet({
            author     : bob,
            messageCid : unpublishedProtocolMessageCid,
          });
          const getUnpublishedProtocolConfigureReply = await dwn.processMessage(alice.did, getUnpublishedProtocolConfigure);
          expect(getUnpublishedProtocolConfigureReply.status.code).to.equal(401);
          expect(getUnpublishedProtocolConfigureReply.status.detail).to.include(DwnErrorCode.MessagesGetAuthorizationFailed);
          expect(getUnpublishedProtocolConfigureReply.entry).to.be.undefined;

          // bob attempts to get the published protocol configuration
          const { message: getPublishedProtocolConfigure } = await TestDataGenerator.generateMessagesGet({
            author     : bob,
            messageCid : publishedProtocolMessageCid,
          });
          const getPublishedProtocolConfigureReply = await dwn.processMessage(alice.did, getPublishedProtocolConfigure);
          expect(getPublishedProtocolConfigureReply.status.code).to.equal(401);
          expect(getPublishedProtocolConfigureReply.status.detail).to.include(DwnErrorCode.MessagesGetAuthorizationFailed);
          expect(getPublishedProtocolConfigureReply.entry).to.be.undefined;

          // control: alice is able to get both the published and unpublished protocol configurations
          const { message: getUnpublishedProtocolConfigureAlice } = await TestDataGenerator.generateMessagesGet({
            author     : alice,
            messageCid : unpublishedProtocolMessageCid,
          });
          const getUnpublishedProtocolConfigureAliceReply = await dwn.processMessage(alice.did, getUnpublishedProtocolConfigureAlice);
          expect(getUnpublishedProtocolConfigureAliceReply.status.code).to.equal(200);
          expect(getUnpublishedProtocolConfigureAliceReply.entry).to.exist;
          expect(getUnpublishedProtocolConfigureAliceReply.entry!.messageCid).to.equal(unpublishedProtocolMessageCid);
          expect(getUnpublishedProtocolConfigureAliceReply.entry!.message).to.deep.equal(unpublishedProtocolsConfigure);

          const { message: getPublishedProtocolConfigureAlice } = await TestDataGenerator.generateMessagesGet({
            author     : alice,
            messageCid : publishedProtocolMessageCid,
          });
          const getPublishedProtocolConfigureAliceReply = await dwn.processMessage(alice.did, getPublishedProtocolConfigureAlice);
          expect(getPublishedProtocolConfigureAliceReply.status.code).to.equal(200);
          expect(getPublishedProtocolConfigureAliceReply.entry).to.exist;
          expect(getPublishedProtocolConfigureAliceReply.entry!.messageCid).to.equal(publishedProtocolMessageCid);
          expect(getPublishedProtocolConfigureAliceReply.entry!.message).to.deep.equal(publishedProtocolsConfigure);
        });
      });
    });

    describe('with a grant', () => {
      it('returns a 401 if grant has different DWN interface scope', async () => {
        // scenario: Alice grants Bob access to RecordsWrite, then Bob tries to invoke the grant with MessagesGet

        const alice = await TestDataGenerator.generateDidKeyPersona();
        const bob = await TestDataGenerator.generateDidKeyPersona();

        // alice installs a protocol
        const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
          author             : alice,
          protocolDefinition : minimalProtocolDefinition
        });
        const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
        expect(protocolsConfigureReply.status.code).to.equal(202);

        // Alice writes a record which Bob will later try to read
        const { recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite({
          author       : alice,
          protocol     : minimalProtocolDefinition.protocol,
          protocolPath : 'foo',
        });
        const recordsWriteReply = await dwn.processMessage(alice.did, recordsWrite.message, { dataStream });
        expect(recordsWriteReply.status.code).to.equal(202);

        // Alice gives Bob a permission grant scoped to a RecordsWrite and the protocol
        const permissionGrant = await PermissionsProtocol.createGrant({
          signer      : Jws.createSigner(alice),
          grantedTo   : bob.did,
          dateExpires : Time.createOffsetTimestamp({ seconds: 60 * 60 * 24 }), // 24 hours
          scope       : {
            interface : DwnInterfaceName.Records,
            method    : DwnMethodName.Write,
            protocol  : minimalProtocolDefinition.protocol,
          }
        });
        const grantDataStream = DataStream.fromBytes(permissionGrant.permissionGrantBytes);
        const permissionGrantWriteReply = await dwn.processMessage(
          alice.did,
          permissionGrant.recordsWrite.message,
          { dataStream: grantDataStream }
        );
        expect(permissionGrantWriteReply.status.code).to.equal(202);

        // Bob tries to MessagesGet using the RecordsWrite grant
        const messagesGet = await TestDataGenerator.generateMessagesGet({
          author            : bob,
          messageCid        : await Message.getCid(recordsWrite.message),
          permissionGrantId : permissionGrant.recordsWrite.message.recordId,
        });
        const messagesGetReply = await dwn.processMessage(alice.did, messagesGet.message);
        expect(messagesGetReply.status.code).to.equal(401);
        expect(messagesGetReply.status.detail).to.contain(DwnErrorCode.GrantAuthorizationInterfaceMismatch);
      });

      it('allows external parties to get a message using a grant with unrestricted scope', async () => {
        // scenario: Alice gives Bob a grant allowing him to get any message in her DWN.
        //           Bob invokes that grant to get a message.

        const alice = await TestDataGenerator.generateDidKeyPersona();
        const bob = await TestDataGenerator.generateDidKeyPersona();

        // Alice writes a record to her DWN
        const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({
          author: alice,
        });
        const writeReply = await dwn.processMessage(alice.did, message, { dataStream });
        expect(writeReply.status.code).to.equal(202);
        const messageCid = await Message.getCid(message);

        // Alice issues a permission grant allowing Bob to read any record in her DWN
        const permissionGrant = await PermissionsProtocol.createGrant({
          signer      : Jws.createSigner(alice),
          grantedTo   : bob.did,
          dateExpires : Time.createOffsetTimestamp({ seconds: 60 * 60 * 24 }), // 24 hours
          scope       : {
            interface : DwnInterfaceName.Messages,
            method    : DwnMethodName.Get,
          }
        });
        const grantDataStream = DataStream.fromBytes(permissionGrant.permissionGrantBytes);
        const grantReply = await dwn.processMessage(alice.did, permissionGrant.recordsWrite.message, { dataStream: grantDataStream });
        expect(grantReply.status.code).to.equal(202);

        // Bob invokes that grant to read a record from Alice's DWN
        const messagesGet = await TestDataGenerator.generateMessagesGet({
          author            : bob,
          permissionGrantId : permissionGrant.recordsWrite.message.recordId,
          messageCid,
        });
        const readReply = await dwn.processMessage(alice.did, messagesGet.message);
        expect(readReply.status.code).to.equal(200);
        expect(readReply.entry).to.not.be.undefined;
        expect(readReply.entry!.messageCid).to.equal(messageCid);
      });

      describe('protocol scoped messages', () => {
        it('allows reads of protocol messages with a protocol restricted grant scope', async () => {
          // This test will verify that a grant scoped to a specific protocol will allow a user to read messages associated with that protocol.
          // These messages include the ProtocolConfiguration itself, even if not published,
          // any RecordsWrite or RecordsDelete messages associated with the protocol,
          // and any PermissionProtocol RecordsWrite messages associated with the protocol.

          // scenario: Alice configures a protocol that is unpublished and writes it to her DWN.
          //           Alice then gives Bob a grant to get messages from that protocol.
          //           Carol requests a grant to RecordsWrite to the protocol, and Alice grants it.
          //           Alice and Carol write records associated with the protocol.
          //           Alice also deletes a record associated with the protocol.
          //           Alice revokes the grant to Carol.
          //           Bob invokes his grant to read the various messages.
          //           As a control, Alice writes a record not associated with the protocol and Bob tries to unsuccessfully read it.

          const alice = await TestDataGenerator.generateDidKeyPersona();
          const bob = await TestDataGenerator.generateDidKeyPersona();
          const carol = await TestDataGenerator.generateDidKeyPersona();

          const protocolDefinition = { ...minimalProtocolDefinition, published: false };

          // Alice installs the unpublished protocol
          const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition
          });
          const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
          expect(protocolsConfigureReply.status.code).to.equal(202);
          const protocolConfigureMessageCid = await Message.getCid(protocolsConfig.message);

          // Carol requests a grant to write records to the protocol
          const permissionRequestCarol = await PermissionsProtocol.createRequest({
            signer    : Jws.createSigner(alice),
            delegated : false,
            scope     : {
              interface : DwnInterfaceName.Records,
              method    : DwnMethodName.Write,
              protocol  : protocolDefinition.protocol,
            }
          });
          const requestDataStreamCarol = DataStream.fromBytes(permissionRequestCarol.permissionRequestBytes);
          const permissionRequestWriteReplyCarol = await dwn.processMessage(
            alice.did,
            permissionRequestCarol.recordsWrite.message,
            { dataStream: requestDataStreamCarol }
          );
          expect(permissionRequestWriteReplyCarol.status.code).to.equal(202);

          // Alice gives Carol a grant to write records to the protocol
          const permissionGrantCarol = await PermissionsProtocol.createGrant({
            signer      : Jws.createSigner(alice),
            grantedTo   : carol.did,
            dateExpires : Time.createOffsetTimestamp({ seconds: 60 * 60 * 24 }), // 24 hours
            delegated   : permissionRequestCarol.permissionRequestData.delegated,
            scope       : permissionRequestCarol.permissionRequestData.scope,
          });

          const grantDataStreamCarol = DataStream.fromBytes(permissionGrantCarol.permissionGrantBytes);
          const permissionGrantWriteReplyCarol = await dwn.processMessage(
            alice.did,
            permissionGrantCarol.recordsWrite.message,
            { dataStream: grantDataStreamCarol }
          );
          expect(permissionGrantWriteReplyCarol.status.code).to.equal(202);
          const carolGrantMessageCiD = await Message.getCid(permissionGrantCarol.recordsWrite.message);

          // Alice writes a record associated with the protocol
          const { recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'foo',
          });
          const recordsWriteReply = await dwn.processMessage(alice.did, recordsWrite.message, { dataStream });
          expect(recordsWriteReply.status.code).to.equal(202);
          const aliceRecordMessageCid = await Message.getCid(recordsWrite.message);

          // Alice deletes a record associated with the protocol
          const recordsDelete = await TestDataGenerator.generateRecordsDelete({
            author   : alice,
            recordId : recordsWrite.message.recordId,
          });
          const recordsDeleteReply = await dwn.processMessage(alice.did, recordsDelete.message);
          expect(recordsDeleteReply.status.code).to.equal(202);

          // Carol writes a record associated with the protocol
          const { recordsWrite: recordsWriteCarol, dataStream: dataStreamCarol } = await TestDataGenerator.generateRecordsWrite({
            author            : carol,
            protocol          : protocolDefinition.protocol,
            protocolPath      : 'foo',
            permissionGrantId : permissionGrantCarol.recordsWrite.message.recordId,
          });
          const recordsWriteReplyCarol = await dwn.processMessage(alice.did, recordsWriteCarol.message, { dataStream: dataStreamCarol });
          expect(recordsWriteReplyCarol.status.code).to.equal(202);
          const carolRecordMessageCid = await Message.getCid(recordsWriteCarol.message);

          // Alice revokes Carol's grant
          const permissionRevocationCarol = await PermissionsProtocol.createRevocation({
            signer : Jws.createSigner(alice),
            grant  : await PermissionGrant.parse(permissionGrantCarol.dataEncodedMessage),
          });
          const permissionRevocationCarolDataStream = DataStream.fromBytes(permissionRevocationCarol.permissionRevocationBytes);
          const permissionRevocationCarolReply = await dwn.processMessage(
            alice.did,
            permissionRevocationCarol.recordsWrite.message,
            { dataStream: permissionRevocationCarolDataStream }
          );
          expect(permissionRevocationCarolReply.status.code).to.equal(202);

          // Alice gives Bob a permission grant with scope MessagesGet
          const permissionGrant = await PermissionsProtocol.createGrant({
            signer      : Jws.createSigner(alice),
            grantedTo   : bob.did,
            dateExpires : Time.createOffsetTimestamp({ seconds: 60 * 60 * 24 }), // 24 hours
            scope       : {
              interface : DwnInterfaceName.Messages,
              method    : DwnMethodName.Get,
              protocol  : protocolDefinition.protocol,
            }
          });
          const grantDataStream = DataStream.fromBytes(permissionGrant.permissionGrantBytes);
          const permissionGrantWriteReply = await dwn.processMessage(
            alice.did,
            permissionGrant.recordsWrite.message,
            { dataStream: grantDataStream }
          );
          expect(permissionGrantWriteReply.status.code).to.equal(202);

          // Bob is unable to get the message without using the permission grant
          const messagesGetWithoutGrant = await TestDataGenerator.generateMessagesGet({
            author     : bob,
            messageCid : aliceRecordMessageCid,
          });
          const messagesGetWithoutGrantReply = await dwn.processMessage(alice.did, messagesGetWithoutGrant.message);
          expect(messagesGetWithoutGrantReply.status.code).to.equal(401);
          expect(messagesGetWithoutGrantReply.status.detail).to.contain(DwnErrorCode.MessagesGetAuthorizationFailed);

          // Bob is able to get all the associated messages when using the permission grant
          // Expected Messages:
          // - Protocol Configuration
          // - Alice's RecordsWrite
          // - Alice's RecordsDelete
          // - Carol's Permission Request
          // - Alice's Permission Grant to Carol
          // - Carol's RecordsWrite
          // - Alice's Revocation of Carol's Grant

          // Protocol configuration
          const messagesGetProtocolConfigure = await TestDataGenerator.generateMessagesGet({
            author            : bob,
            messageCid        : protocolConfigureMessageCid,
            permissionGrantId : permissionGrant.recordsWrite.message.recordId,
          });
          const messagesGetProtocolConfigureReply = await dwn.processMessage(alice.did, messagesGetProtocolConfigure.message);
          expect(messagesGetProtocolConfigureReply.status.code).to.equal(200);
          expect(messagesGetProtocolConfigureReply.entry).to.exist;
          expect(messagesGetProtocolConfigureReply.entry!.message).to.deep.equal(protocolsConfig.message);

          // alice RecordsWrite
          const messagesGetWithGrant = await TestDataGenerator.generateMessagesGet({
            author            : bob,
            messageCid        : aliceRecordMessageCid,
            permissionGrantId : permissionGrant.recordsWrite.message.recordId,
          });
          const messagesGetWithGrantReply = await dwn.processMessage(alice.did, messagesGetWithGrant.message);
          expect(messagesGetWithGrantReply.status.code).to.equal(200);
          expect(messagesGetWithGrantReply.entry).to.exist;
          // delete the data field from the message for comparison of the message
          delete messagesGetWithGrantReply.entry!.message.data;
          expect(messagesGetWithGrantReply.entry!.message).to.deep.equal(recordsWrite.message);

          // alice RecordsDelete
          const messagesGetDelete = await TestDataGenerator.generateMessagesGet({
            author            : bob,
            messageCid        : await Message.getCid(recordsDelete.message),
            permissionGrantId : permissionGrant.recordsWrite.message.recordId,
          });
          const messagesGetDeleteReply = await dwn.processMessage(alice.did, messagesGetDelete.message);
          expect(messagesGetDeleteReply.status.code).to.equal(200);
          expect(messagesGetDeleteReply.entry).to.exist;
          expect(messagesGetDeleteReply.entry!.message).to.deep.equal(recordsDelete.message);

          // carol's Permission Request
          const messagesGetCarolRequest = await TestDataGenerator.generateMessagesGet({
            author            : bob,
            messageCid        : await Message.getCid(permissionRequestCarol.recordsWrite.message),
            permissionGrantId : permissionGrant.recordsWrite.message.recordId,
          });
          const messagesGetCarolRequestReply = await dwn.processMessage(alice.did, messagesGetCarolRequest.message);
          expect(messagesGetCarolRequestReply.status.code).to.equal(200);
          expect(messagesGetCarolRequestReply.entry).to.exist;
          // delete the data field from the message for comparison of the message
          delete messagesGetCarolRequestReply.entry!.message.data;
          expect(messagesGetCarolRequestReply.entry!.message).to.deep.equal(permissionRequestCarol.recordsWrite.message);

          // carol's Permission Grant
          const messagesGetCarolGrant = await TestDataGenerator.generateMessagesGet({
            author            : bob,
            messageCid        : carolGrantMessageCiD,
            permissionGrantId : permissionGrant.recordsWrite.message.recordId,
          });
          const messagesGetCarolGrantReply = await dwn.processMessage(alice.did, messagesGetCarolGrant.message);
          expect(messagesGetCarolGrantReply.status.code).to.equal(200);
          expect(messagesGetCarolGrantReply.entry).to.exist;
          // delete the data field from the message for comparison of the message
          delete messagesGetCarolGrantReply.entry!.message.data;
          expect(messagesGetCarolGrantReply.entry!.message).to.deep.equal(permissionGrantCarol.recordsWrite.message);

          // carol's RecordsWrite
          const messagesGetCarolRecord = await TestDataGenerator.generateMessagesGet({
            author            : bob,
            messageCid        : carolRecordMessageCid,
            permissionGrantId : permissionGrant.recordsWrite.message.recordId,
          });
          const messagesGetCarolRecordReply = await dwn.processMessage(alice.did, messagesGetCarolRecord.message);
          expect(messagesGetCarolRecordReply.status.code).to.equal(200);
          expect(messagesGetCarolRecordReply.entry).to.exist;
          // delete the data field from the message for comparison of the message
          delete messagesGetCarolRecordReply.entry!.message.data;
          expect(messagesGetCarolRecordReply.entry!.message).to.deep.equal(recordsWriteCarol.message);

          // carol's Grant Revocation
          const messagesGetCarolGrantRevocation = await TestDataGenerator.generateMessagesGet({
            author            : bob,
            messageCid        : await Message.getCid(permissionRevocationCarol.recordsWrite.message),
            permissionGrantId : permissionGrant.recordsWrite.message.recordId,
          });
          const messagesGetCarolGrantRevocationReply = await dwn.processMessage(alice.did, messagesGetCarolGrantRevocation.message);
          expect(messagesGetCarolGrantRevocationReply.status.code).to.equal(200);
          expect(messagesGetCarolGrantRevocationReply.entry).to.exist;
          // delete the data field from the message for comparison of the message
          delete messagesGetCarolGrantRevocationReply.entry!.message.data;
          expect(messagesGetCarolGrantRevocationReply.entry!.message).to.deep.equal(permissionRevocationCarol.recordsWrite.message);

          // CONTROL: Alice writes a record not associated with the protocol
          const { recordsWrite: recordsWriteControl, dataStream: dataStreamControl } = await TestDataGenerator.generateRecordsWrite({
            author: alice,
          });
          const recordsWriteControlReply = await dwn.processMessage(alice.did, recordsWriteControl.message, { dataStream: dataStreamControl });
          expect(recordsWriteControlReply.status.code).to.equal(202);

          // Bob is unable to get the control message
          const messagesGetControl = await TestDataGenerator.generateMessagesGet({
            author            : bob,
            messageCid        : await Message.getCid(recordsWriteControl.message),
            permissionGrantId : permissionGrant.recordsWrite.message.recordId,
          });
          const messagesGetControlReply = await dwn.processMessage(alice.did, messagesGetControl.message);
          expect(messagesGetControlReply.status.code).to.equal(401);
        });

        it('rejects message get of protocol messages with mismatching protocol grant scopes', async () => {
          // scenario: Alice writes a protocol record. Alice gives Bob a grant to get messages from a different protocol
          //           Bob invokes that grant to get the protocol message, but fails.

          const alice = await TestDataGenerator.generateDidKeyPersona();
          const bob = await TestDataGenerator.generateDidKeyPersona();

          const protocolDefinition = minimalProtocolDefinition;

          // Alice installs the protocol
          const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition
          });
          const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
          expect(protocolsConfigureReply.status.code).to.equal(202);

          // Alice writes a record which Bob will later try to read
          const { recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'foo',
          });
          const recordsWriteReply = await dwn.processMessage(alice.did, recordsWrite.message, { dataStream });
          expect(recordsWriteReply.status.code).to.equal(202);

          // Alice gives Bob a permission grant with scope MessagesGet
          const permissionGrant = await PermissionsProtocol.createGrant({
            signer      : Jws.createSigner(alice),
            grantedTo   : bob.did,
            dateExpires : Time.createOffsetTimestamp({ seconds: 60 * 60 * 24 }), // 24 hours
            scope       : {
              interface : DwnInterfaceName.Messages,
              method    : DwnMethodName.Get,
              protocol  : 'a-different-protocol'
            }
          });
          const grantDataStream = DataStream.fromBytes(permissionGrant.permissionGrantBytes);
          const permissionGrantWriteReply = await dwn.processMessage(
            alice.did,
            permissionGrant.recordsWrite.message,
            { dataStream: grantDataStream }
          );
          expect(permissionGrantWriteReply.status.code).to.equal(202);

          // Bob is unable to read the record using the mismatched permission grant
          const messagesGetWithoutGrant = await TestDataGenerator.generateMessagesGet({
            author            : bob,
            messageCid        : await Message.getCid(recordsWrite.message),
            permissionGrantId : permissionGrant.recordsWrite.message.recordId,
          });
          const messagesGetWithoutGrantReply = await dwn.processMessage(alice.did, messagesGetWithoutGrant.message);
          expect(messagesGetWithoutGrantReply.status.code).to.equal(401);
          expect(messagesGetWithoutGrantReply.status.detail).to.contain(DwnErrorCode.MessagesGetVerifyScopeFailed);
        });

        it('rejects message if the RecordsWrite message is not found for a RecordsDelete being retrieved', async () => {
          // NOTE: This is a corner case that is unlikely to happen in practice, but is tested for completeness

          const alice = await TestDataGenerator.generateDidKeyPersona();
          const bob = await TestDataGenerator.generateDidKeyPersona();

          const protocolDefinition = minimalProtocolDefinition;

          // Alice installs the protocol
          const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition,
          });
          const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
          expect(protocolsConfigureReply.status.code).to.equal(202);

          // Alice gives bob a grant to read messages in the protocol
          const permissionGrant = await PermissionsProtocol.createGrant({
            signer      : Jws.createSigner(alice),
            grantedTo   : bob.did,
            dateExpires : Time.createOffsetTimestamp({ seconds: 60 * 60 * 24 }), // 24 hours
            scope       : {
              interface : DwnInterfaceName.Messages,
              method    : DwnMethodName.Get,
              protocol  : protocolDefinition.protocol,
            }
          });
          const grantDataStream = DataStream.fromBytes(permissionGrant.permissionGrantBytes);
          const permissionGrantWriteReply = await dwn.processMessage(
            alice.did,
            permissionGrant.recordsWrite.message,
            { dataStream: grantDataStream }
          );
          expect(permissionGrantWriteReply.status.code).to.equal(202);

          // Alice creates the records write and records delete messages
          const { recordsWrite } = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'foo',
          });

          const { recordsDelete } = await TestDataGenerator.generateRecordsDelete({
            author   : alice,
            recordId : recordsWrite.message.recordId,
          });

          // Alice inserts the RecordsDelete message directly into the message store
          const recordsDeleteCid = await Message.getCid(recordsDelete.message);
          const indexes = recordsDelete.constructIndexes(recordsWrite.message);
          await messageStore.put(alice.did, recordsDelete.message, indexes);

          // Bob tries to get the message
          const messagesGet = await TestDataGenerator.generateMessagesGet({
            author            : bob,
            messageCid        : recordsDeleteCid,
            permissionGrantId : permissionGrant.recordsWrite.message.recordId,
          });
          const messagesGetReply = await dwn.processMessage(alice.did, messagesGet.message);
          expect(messagesGetReply.status.code).to.equal(401);
          expect(messagesGetReply.status.detail).to.contain(DwnErrorCode.MessagesGetWriteRecordNotFound);
        });
      });
    });
  });
}