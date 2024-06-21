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
import { DataStream, Dwn, DwnConstant, DwnErrorCode, DwnInterfaceName, DwnMethodName, Jws, PermissionsProtocol, Time } from '../../src/index.js';
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

    it('returns 401 if authentication fails', async () => {
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
        it('returns 401 if the tenant is not the author', async () => {
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

      describe('protocol interface messages', () => {
        it('returns 401 if the tenant is not the author', async () => {
          // scenario: Alice creates a non-published protocol, installs it, and writes a record. Bob tries to get the protocol message.
          //          Bob is unable to get the protocol message because it is not published.

          const alice = await TestDataGenerator.generateDidKeyPersona();
          const bob = await TestDataGenerator.generateDidKeyPersona();

          const protocolDefinition = { ...minimalProtocolDefinition, published: false };
          const { message: protocolsConfigure } = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition
          });
          const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfigure);
          expect(protocolsConfigureReply.status.code).to.equal(202);

          const protocolMessageCid = await Message.getCid(protocolsConfigure);

          // bob attempts to get the message
          const { message: getProtocolConfigure } = await TestDataGenerator.generateMessagesGet({
            author     : bob,
            messageCid : protocolMessageCid,
          });
          const getProtocolConfigureReply = await dwn.processMessage(alice.did, getProtocolConfigure);
          expect(getProtocolConfigureReply.status.code).to.equal(401);
          expect(getProtocolConfigureReply.status.detail).to.include(DwnErrorCode.MessagesGetAuthorizationFailed);
          expect(getProtocolConfigureReply.entry).to.be.undefined;
        });
      });
    });

    describe('with a grant', () => {
      it('rejects with 401 an external party attempts to MessagesGet if grant has different DWN interface scope', async () => {
        // scenario: Alice grants Bob access to RecordsWrite, then Bob tries to invoke the grant with MessagesGet

        const alice = await TestDataGenerator.generateDidKeyPersona();
        const bob = await TestDataGenerator.generateDidKeyPersona();

        // Alice writes a record which Bob will later try to read
        const { recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite({
          author: alice,
        });
        const recordsWriteReply = await dwn.processMessage(alice.did, recordsWrite.message, { dataStream });
        expect(recordsWriteReply.status.code).to.equal(202);

        // Alice gives Bob a permission grant with scope MessagesGet
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

        // Bob tries to MessagesGet
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

      describe('protocol scoped records', () => {
        it('allows reads of protocol messages that are RecordsDelete', async () => {
          // Scenario:  Alice writes a protocol record.
          //            Alice deletes the record.
          //            Alice gives Bob a grant to read messages in the protocol.
          //            Bob invokes that grant to read the delete message.

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

          // Alice writes a record which will be deleted
          const { recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'foo',
          });
          const recordsWriteReply = await dwn.processMessage(alice.did, recordsWrite.message, { dataStream });
          expect(recordsWriteReply.status.code).to.equal(202);

          // Alice deletes the record
          const recordsDelete = await TestDataGenerator.generateRecordsDelete({
            author   : alice,
            recordId : recordsWrite.message.recordId,
          });
          const recordsDeleteReply = await dwn.processMessage(alice.did, recordsDelete.message);
          expect(recordsDeleteReply.status.code).to.equal(202);

          // Alice grants Bob access to read messages in the protocol
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

          // Bob is able to read the delete message
          const deleteMessageCid = await Message.getCid(recordsDelete.message);
          const messagesGet = await TestDataGenerator.generateMessagesGet({
            author            : bob,
            messageCid        : deleteMessageCid,
            permissionGrantId : permissionGrant.recordsWrite.message.recordId,
          });
          const messagesGetReply = await dwn.processMessage(alice.did, messagesGet.message);
          expect(messagesGetReply.status.code).to.equal(200);
          expect(messagesGetReply.entry).to.exist;
          expect(messagesGetReply.entry!.messageCid).to.equal(deleteMessageCid);
        });

        it('allows reads of protocol messages with a an unrestricted grant scope', async () => {
          // scenario: Alice writes a protocol record. Alice gives Bob a grant to read any messages
          //           Bob invokes that grant to read the protocol messages.

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
          const recordMessageCid = await Message.getCid(recordsWrite.message);

          // Alice gives Bob a permission grant with scope MessagesGet
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
          const permissionGrantWriteReply = await dwn.processMessage(
            alice.did,
            permissionGrant.recordsWrite.message,
            { dataStream: grantDataStream }
          );
          expect(permissionGrantWriteReply.status.code).to.equal(202);

          // Bob is unable to get the message without using the permission grant
          const messagesGetWithoutGrant = await TestDataGenerator.generateMessagesGet({
            author     : bob,
            messageCid : recordMessageCid,
          });
          const messagesGetWithoutGrantReply = await dwn.processMessage(alice.did, messagesGetWithoutGrant.message);
          expect(messagesGetWithoutGrantReply.status.code).to.equal(401);
          expect(messagesGetWithoutGrantReply.status.detail).to.contain(DwnErrorCode.MessagesGetAuthorizationFailed);

          // Bob is able to get the message when he uses the permission grant
          const messagesGetWithGrant = await TestDataGenerator.generateMessagesGet({
            author            : bob,
            messageCid        : recordMessageCid,
            permissionGrantId : permissionGrant.recordsWrite.message.recordId,
          });
          const messagesGetWithGrantReply = await dwn.processMessage(alice.did, messagesGetWithGrant.message);
          expect(messagesGetWithGrantReply.status.code).to.equal(200);

          // Bob is able to get the message of the grant associated with the protocol
          const grantMessageCid = await Message.getCid(permissionGrant.recordsWrite.message);
          const grantMessageRead = await TestDataGenerator.generateMessagesGet({
            author            : bob,
            messageCid        : grantMessageCid,
            permissionGrantId : permissionGrant.recordsWrite.message.recordId,
          });
          const grantMessageReadReply = await dwn.processMessage(alice.did, grantMessageRead.message);
          expect(grantMessageReadReply.status.code).to.equal(200);
        });

        it('allows reads of protocol messages with a protocol restricted grant scope', async () => {
          // scenario: Alice writes a protocol record. Alice gives Bob a grant to read messages in the protocol
          //           Bob invokes that grant to read the protocol messages.

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
          const recordMessageCid = await Message.getCid(recordsWrite.message);

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
            messageCid : recordMessageCid,
          });
          const messagesGetWithoutGrantReply = await dwn.processMessage(alice.did, messagesGetWithoutGrant.message);
          expect(messagesGetWithoutGrantReply.status.code).to.equal(401);
          expect(messagesGetWithoutGrantReply.status.detail).to.contain(DwnErrorCode.MessagesGetAuthorizationFailed);

          // Bob is able to get the message when he uses the permission grant
          const messagesGetWithGrant = await TestDataGenerator.generateMessagesGet({
            author            : bob,
            messageCid        : recordMessageCid,
            permissionGrantId : permissionGrant.recordsWrite.message.recordId,
          });
          const messagesGetWithGrantReply = await dwn.processMessage(alice.did, messagesGetWithGrant.message);
          expect(messagesGetWithGrantReply.status.code).to.equal(200);
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