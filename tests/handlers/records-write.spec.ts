import type { EncryptionInput } from '../../src/interfaces/records-write.js';
import type { EventStream } from '../../src/types/subscriptions.js';
import type { GenerateFromRecordsWriteOut } from '../utils/test-data-generator.js';
import type { ProtocolDefinition } from '../../src/types/protocols-types.js';
import type { RecordsQueryReplyEntry } from '../../src/types/records-types.js';
import type { DataStore, EventLog, MessageStore } from '../../src/index.js';

import anyoneCollaborateProtocolDefinition from '../vectors/protocol-definitions/anyone-collaborate.json' assert { type: 'json' };
import authorCanProtocolDefinition from '../vectors/protocol-definitions/author-can.json' assert { type: 'json' };
import chaiAsPromised from 'chai-as-promised';
import credentialIssuanceProtocolDefinition from '../vectors/protocol-definitions/credential-issuance.json' assert { type: 'json' };
import dexProtocolDefinition from '../vectors/protocol-definitions/dex.json' assert { type: 'json' };
import emailProtocolDefinition from '../vectors/protocol-definitions/email.json' assert { type: 'json' };
import friendRoleProtocolDefinition from '../vectors/protocol-definitions/friend-role.json' assert { type: 'json' };
import messageProtocolDefinition from '../vectors/protocol-definitions/message.json' assert { type: 'json' };
import minimalProtocolDefinition from '../vectors/protocol-definitions/minimal.json' assert { type: 'json' };
import nestedProtocol from '../vectors/protocol-definitions/nested.json' assert { type: 'json' };
import privateProtocol from '../vectors/protocol-definitions/private-protocol.json' assert { type: 'json' };
import recipientCanProtocol from '../vectors/protocol-definitions/recipient-can.json' assert { type: 'json' };
import sinon from 'sinon';
import socialMediaProtocolDefinition from '../vectors/protocol-definitions/social-media.json' assert { type: 'json' };
import threadRoleProtocolDefinition from '../vectors/protocol-definitions/thread-role.json' assert { type: 'json' };
import chai, { expect } from 'chai';

import { ArrayUtility } from '../../src/utils/array.js';
import { base64url } from 'multiformats/bases/base64';
import { Cid } from '../../src/utils/cid.js';
import { DataStream } from '../../src/utils/data-stream.js';
import { DidKey } from '@web5/dids';
import { DidResolver } from '@web5/dids';
import { Dwn } from '../../src/dwn.js';
import { DwnErrorCode } from '../../src/core/dwn-error.js';
import { Encoder } from '../../src/utils/encoder.js';
import { GeneralJwsBuilder } from '../../src/jose/jws/general/builder.js';
import { Jws } from '../../src/utils/jws.js';
import { Message } from '../../src/core/message.js';
import { PermissionsConditionPublication } from '../../src/types/permissions-grant-descriptor.js';
import { RecordsRead } from '../../src/interfaces/records-read.js';
import { RecordsWrite } from '../../src/interfaces/records-write.js';
import { RecordsWriteHandler } from '../../src/handlers/records-write.js';
import { stubInterface } from 'ts-sinon';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestEventStream } from '../test-event-stream.js';
import { TestStores } from '../test-stores.js';
import { TestStubGenerator } from '../utils/test-stub-generator.js';
import { Time } from '../../src/utils/time.js';

import { DwnConstant, DwnInterfaceName, DwnMethodName, KeyDerivationScheme, RecordsDelete, RecordsQuery } from '../../src/index.js';
import { Encryption, EncryptionAlgorithm } from '../../src/utils/encryption.js';

chai.use(chaiAsPromised);

export function testRecordsWriteHandler(): void {
  describe('RecordsWriteHandler.handle()', async () => {
    let didResolver: DidResolver;
    let messageStore: MessageStore;
    let dataStore: DataStore;
    let eventLog: EventLog;
    let eventStream: EventStream;
    let dwn: Dwn;

    describe('functional tests', () => {

      // important to follow the `before` and `after` pattern to initialize and clean the stores in tests
      // so that different test suites can reuse the same backend store for testing
      before(async () => {
        didResolver = new DidResolver({ didResolvers: [DidKey] });

        const stores = TestStores.get();
        messageStore = stores.messageStore;
        dataStore = stores.dataStore;
        eventLog = stores.eventLog;
        eventStream = TestEventStream.get();

        dwn = await Dwn.create({ didResolver, messageStore, dataStore, eventLog, eventStream });
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

      it('should only be able to overwrite existing record if new record has a later `messageTimestamp` value', async () => {
      // write a message into DB
        const author = await TestDataGenerator.generateDidKeyPersona();
        const data1 = new TextEncoder().encode('data1');
        const recordsWriteMessageData = await TestDataGenerator.generateRecordsWrite({ author, data: data1 });

        const tenant = author.did;
        const recordsWriteReply =
          await dwn.processMessage(tenant, recordsWriteMessageData.message, { dataStream: recordsWriteMessageData.dataStream });
        expect(recordsWriteReply.status.code).to.equal(202);

        const recordId = recordsWriteMessageData.message.recordId;
        const recordsQueryMessageData = await TestDataGenerator.generateRecordsQuery({
          author,
          filter: { recordId }
        });

        // verify the message written can be queried
        const recordsQueryReply = await dwn.processMessage(tenant, recordsQueryMessageData.message);
        expect(recordsQueryReply.status.code).to.equal(200);
        expect(recordsQueryReply.entries?.length).to.equal(1);
        expect(recordsQueryReply.entries![0].encodedData).to.equal(base64url.baseEncode(data1));

        // generate and write a new RecordsWrite to overwrite the existing record
        // a new RecordsWrite by default will have a later `messageTimestamp`
        const newDataBytes = Encoder.stringToBytes('new data');
        const newDataEncoded = Encoder.bytesToBase64Url(newDataBytes);
        const newRecordsWrite = await TestDataGenerator.generateFromRecordsWrite({
          author,
          existingWrite : recordsWriteMessageData.recordsWrite,
          data          : newDataBytes
        });

        // sanity check that old data and new data are different
        expect(newDataEncoded).to.not.equal(Encoder.bytesToBase64Url(recordsWriteMessageData.dataBytes!));

        const newRecordsWriteReply = await dwn.processMessage(tenant, newRecordsWrite.message, { dataStream: newRecordsWrite.dataStream });
        expect(newRecordsWriteReply.status.code).to.equal(202);

        // verify new record has overwritten the existing record
        const newRecordsQueryReply = await dwn.processMessage(tenant, recordsQueryMessageData.message);

        expect(newRecordsQueryReply.status.code).to.equal(200);
        expect(newRecordsQueryReply.entries?.length).to.equal(1);
        expect(newRecordsQueryReply.entries![0].encodedData).to.equal(newDataEncoded);

        // try to write the older message to store again and verify that it is not accepted
        const thirdRecordsWriteReply =
          await dwn.processMessage(tenant, recordsWriteMessageData.message, { dataStream: recordsWriteMessageData.dataStream });
        expect(thirdRecordsWriteReply.status.code).to.equal(409); // expecting to fail

        // expecting unchanged
        const thirdRecordsQueryReply = await dwn.processMessage(tenant, recordsQueryMessageData.message);
        expect(thirdRecordsQueryReply.status.code).to.equal(200);
        expect(thirdRecordsQueryReply.entries?.length).to.equal(1);
        expect(thirdRecordsQueryReply.entries![0].encodedData).to.equal(newDataEncoded);
      });

      it('should only be able to overwrite existing record if new message CID is larger when `messageTimestamp` value is the same', async () => {
      // start by writing an originating message
        const author = await TestDataGenerator.generatePersona();
        const tenant = author.did;
        const originatingMessageData = await TestDataGenerator.generateRecordsWrite({
          author,
          data: Encoder.stringToBytes('unused')
        });

        // setting up a stub DID resolver
        TestStubGenerator.stubDidResolver(didResolver, [author]);

        const originatingMessageWriteReply =
          await dwn.processMessage(tenant, originatingMessageData.message, { dataStream: originatingMessageData.dataStream });
        expect(originatingMessageWriteReply.status.code).to.equal(202);

        // generate two new RecordsWrite messages with the same `messageTimestamp` value
        const dateModified = Time.getCurrentTimestamp();
        const recordsWrite1 = await TestDataGenerator.generateFromRecordsWrite({
          author,
          existingWrite    : originatingMessageData.recordsWrite,
          messageTimestamp : dateModified
        });
        const recordsWrite2 = await TestDataGenerator.generateFromRecordsWrite({
          author,
          existingWrite    : originatingMessageData.recordsWrite,
          messageTimestamp : dateModified
        });

        // determine the lexicographical order of the two messages
        const message1Cid = await Message.getCid(recordsWrite1.message);
        const message2Cid = await Message.getCid(recordsWrite2.message);
        let newerWrite: GenerateFromRecordsWriteOut;
        let olderWrite: GenerateFromRecordsWriteOut;
        if (message1Cid > message2Cid) {
          newerWrite = recordsWrite1;
          olderWrite = recordsWrite2;
        } else {
          newerWrite = recordsWrite2;
          olderWrite = recordsWrite1;
        }

        // write the message with the smaller lexicographical message CID first
        const recordsWriteReply = await dwn.processMessage(tenant, olderWrite.message, { dataStream: olderWrite.dataStream });
        expect(recordsWriteReply.status.code).to.equal(202);

        // query to fetch the record
        const recordsQueryMessageData = await TestDataGenerator.generateRecordsQuery({
          author,
          filter: { recordId: originatingMessageData.message.recordId }
        });

        // verify the data is written
        const recordsQueryReply = await dwn.processMessage(tenant, recordsQueryMessageData.message);
        expect(recordsQueryReply.status.code).to.equal(200);
        expect(recordsQueryReply.entries?.length).to.equal(1);
        expect(recordsQueryReply.entries![0].descriptor.dataCid)
          .to.equal(olderWrite.message.descriptor.dataCid);

        // attempt to write the message with larger lexicographical message CID
        const newRecordsWriteReply = await dwn.processMessage(tenant, newerWrite.message, { dataStream: newerWrite.dataStream });
        expect(newRecordsWriteReply.status.code).to.equal(202);

        // verify new record has overwritten the existing record
        const newRecordsQueryReply = await dwn.processMessage(tenant, recordsQueryMessageData.message);
        expect(newRecordsQueryReply.status.code).to.equal(200);
        expect(newRecordsQueryReply.entries?.length).to.equal(1);
        expect(newRecordsQueryReply.entries![0].descriptor.dataCid)
          .to.equal(newerWrite.message.descriptor.dataCid);

        // try to write the message with smaller lexicographical message CID again
        const thirdRecordsWriteReply = await dwn.processMessage(
          tenant,
          olderWrite.message,
          { dataStream: DataStream.fromBytes(olderWrite.dataBytes) } // need to create data stream again since it's already used above
        );
        expect(thirdRecordsWriteReply.status.code).to.equal(409); // expecting to fail

        // verify the message in store is still the one with larger lexicographical message CID
        const thirdRecordsQueryReply = await dwn.processMessage(tenant, recordsQueryMessageData.message);
        expect(thirdRecordsQueryReply.status.code).to.equal(200);
        expect(thirdRecordsQueryReply.entries?.length).to.equal(1);
        expect(thirdRecordsQueryReply.entries![0].descriptor.dataCid)
          .to.equal(newerWrite.message.descriptor.dataCid); // expecting unchanged
      });

      it('#690 - should allow data format of a flat-space record to be updated to any value', async () => {
        const initialWriteData = await TestDataGenerator.generateRecordsWrite();
        const tenant = initialWriteData.author.did;

        TestStubGenerator.stubDidResolver(didResolver, [initialWriteData.author]);

        const initialWriteReply = await dwn.processMessage(tenant, initialWriteData.message, { dataStream: initialWriteData.dataStream });
        expect(initialWriteReply.status.code).to.equal(202);

        const newDataFormat = 'any-new-data-format';
        const newDataBytes = TestDataGenerator.randomBytes(100);
        const updateWrite = await RecordsWrite.createFrom({
          recordsWriteMessage : initialWriteData.message,
          dataFormat          : newDataFormat,
          signer              : Jws.createSigner(initialWriteData.author),
          data                : newDataBytes
        });

        const newDataStream = DataStream.fromBytes(newDataBytes);
        const updateReply = await dwn.processMessage(tenant, updateWrite.message, { dataStream: newDataStream });
        expect(updateReply.status.code).to.equal(202);

        // verify the data format of the record is updated
        const recordsRead = await RecordsRead.create({
          filter : { recordId: initialWriteData.message.recordId },
          signer : Jws.createSigner(initialWriteData.author),
        });
        const recordsReadReply = await dwn.processMessage(tenant, recordsRead.message);
        expect(recordsReadReply.status.code).to.equal(200);
        expect(recordsReadReply.record?.descriptor.dataFormat).to.equal(newDataFormat);
      });

      it('should not allow changes to immutable properties', async () => {
        const initialWriteData = await TestDataGenerator.generateRecordsWrite();
        const tenant = initialWriteData.author.did;

        TestStubGenerator.stubDidResolver(didResolver, [initialWriteData.author]);

        const initialWriteReply = await dwn.processMessage(tenant, initialWriteData.message, { dataStream: initialWriteData.dataStream });
        expect(initialWriteReply.status.code).to.equal(202);

        const recordId = initialWriteData.message.recordId;
        const dateCreated = initialWriteData.message.descriptor.dateCreated;
        const schema = initialWriteData.message.descriptor.schema;

        // dateCreated test
        let childMessageData = await TestDataGenerator.generateRecordsWrite({
          author      : initialWriteData.author,
          recordId,
          schema,
          dateCreated : Time.getCurrentTimestamp(), // should not be allowed to be modified
          dataFormat  : initialWriteData.message.descriptor.dataFormat
        });

        let reply = await dwn.processMessage(tenant, childMessageData.message, { dataStream: childMessageData.dataStream });

        expect(reply.status.code).to.equal(400);
        expect(reply.status.detail).to.contain('dateCreated is an immutable property');

        // schema test
        childMessageData = await TestDataGenerator.generateRecordsWrite({
          author     : initialWriteData.author,
          recordId,
          schema     : 'should-not-allowed-to-be-modified',
          dateCreated,
          dataFormat : initialWriteData.message.descriptor.dataFormat
        });

        reply = await dwn.processMessage(tenant, childMessageData.message, { dataStream: childMessageData.dataStream });

        expect(reply.status.code).to.equal(400);
        expect(reply.status.detail).to.contain('schema is an immutable property');
      });

      it('should inherit data from previous RecordsWrite given a matching dataCid and dataSize and no dataStream', async () => {
        const { message, author, dataStream, dataBytes } = await TestDataGenerator.generateRecordsWrite({
          published: false
        });
        const tenant = author.did;

        TestStubGenerator.stubDidResolver(didResolver, [author]);

        const initialWriteReply = await dwn.processMessage(tenant, message, { dataStream });
        expect(initialWriteReply.status.code).to.equal(202);

        const write2 = await RecordsWrite.createFrom({
          recordsWriteMessage : message,
          published           : true,
          signer              : Jws.createSigner(author),
        });

        const writeUpdateReply = await dwn.processMessage(tenant, write2.message);
        expect(writeUpdateReply.status.code).to.equal(202);
        const readMessage = await RecordsRead.create({
          filter: {
            recordId: message.recordId,
          }
        });

        const readMessageReply = await dwn.processMessage(tenant, readMessage.message);
        expect(readMessageReply.status.code).to.equal(200);
        expect(readMessageReply.record).to.exist;
        const data = await DataStream.toBytes(readMessageReply.record!.data);
        expect(data).to.eql(dataBytes);
      });

      it('should allow an initial `RecordsWrite` to be written without supplying data', async () => {
        //scenario:  you have an initial write without the data and a subsequent write with data to be able to write.
        // the DWN should accept an initial write without data, however prevent the user from querying for it until it's updated.

        const alice = await TestDataGenerator.generateDidKeyPersona();

        const { recordsWrite } = await TestDataGenerator.generateRecordsWrite({ author: alice });

        // simulate synchronize of pruned initial `RecordsWrite`
        const reply = await dwn.processMessage(alice.did, recordsWrite.message);
        expect(reply.status.code).to.equal(202);

        // verify `RecordsWrite` inserted is not returned with a query
        const recordsQueryMessageData = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : { recordId: recordsWrite.message.recordId }
        });
        const recordsQueryReply = await dwn.processMessage(alice.did, recordsQueryMessageData.message);

        expect(recordsQueryReply.status.code).to.equal(200);
        expect(recordsQueryReply.entries?.length).to.equal(0);

        // generate and write a new `RecordsWrite` to overwrite the existing record
        const newDataBytes = Encoder.stringToBytes('new data');
        const newDataEncoded = Encoder.bytesToBase64Url(newDataBytes);
        const newRecordsWrite = await TestDataGenerator.generateFromRecordsWrite({
          author        : alice,
          existingWrite : recordsWrite,
          data          : newDataBytes
        });

        const newRecordsWriteReply = await dwn.processMessage(alice.did, newRecordsWrite.message, { dataStream: newRecordsWrite.dataStream });
        expect(newRecordsWriteReply.status.code).to.equal(202);

        // verify new `RecordsWrite` has overwritten the existing record with new data
        const newRecordsQueryReply = await dwn.processMessage(alice.did, recordsQueryMessageData.message);

        expect(newRecordsQueryReply.status.code).to.equal(200);
        expect(newRecordsQueryReply.entries?.length).to.equal(1);
        expect(newRecordsQueryReply.entries![0].encodedData).to.equal(newDataEncoded);
      });

      it('should not allow non-initial writes to be written without supplying data', async () => {
        //scenario:  you have an initial write without the data and a subsequent write with data to be able to write.
        // the DWN should accept an initial write without data, however prevent the user from querying for it until it's updated.

        const alice = await TestDataGenerator.generateDidKeyPersona();

        // write a record into the dwn
        const { recordsWrite, dataStream, dataBytes } = await TestDataGenerator.generateRecordsWrite({ author: alice });
        const reply = await dwn.processMessage(alice.did, recordsWrite.message, { dataStream });
        expect(reply.status.code).to.equal(202);

        // verify `RecordsWrite` inserted can be queried
        const recordsQueryMessageData = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : { recordId: recordsWrite.message.recordId }
        });
        const recordsQueryReply = await dwn.processMessage(alice.did, recordsQueryMessageData.message);

        expect(recordsQueryReply.status.code).to.equal(200);
        expect(recordsQueryReply.entries?.length).to.equal(1);

        // generate and write a new `RecordsWrite` to overwrite the existing record
        const newDataBytes = Encoder.stringToBytes('new data');
        const newRecordsWrite = await TestDataGenerator.generateFromRecordsWrite({
          author        : alice,
          existingWrite : recordsWrite,
          data          : newDataBytes
        });

        // records write should be rejected.
        const newRecordsWriteReply = await dwn.processMessage(alice.did, newRecordsWrite.message);
        expect(newRecordsWriteReply.status.code).to.equal(400);
        expect(newRecordsWriteReply.status.detail).to.contain(DwnErrorCode.RecordsWriteDataCidMismatch);

        // verify the original `RecordsWrite` and data are still available
        const newRecordsQueryReply = await dwn.processMessage(alice.did, recordsQueryMessageData.message);

        expect(newRecordsQueryReply.status.code).to.equal(200);
        expect(newRecordsQueryReply.entries?.length).to.equal(1);
        const originalEncodedData = Encoder.bytesToBase64Url(dataBytes!);
        expect(newRecordsQueryReply.entries![0].encodedData).to.equal(originalEncodedData);
      });

      describe('owner signature tests', () => {
        it('should use `ownerSignature` for authorization when it is given - flat-space', async () => {
          // scenario: Alice fetch a message authored by Bob from Bob's DWN and retains (writes) it in her DWN
          const alice = await TestDataGenerator.generateDidKeyPersona();
          const bob = await TestDataGenerator.generateDidKeyPersona();

          // Bob writes a message to his DWN
          const { message, dataStream, dataBytes } = await TestDataGenerator.generateRecordsWrite({ author: bob, published: true });
          const writeReply = await dwn.processMessage(bob.did, message, { dataStream });
          expect(writeReply.status.code).to.equal(202);

          // Alice fetches the message from Bob's DWN
          const recordsRead = await RecordsRead.create({
            filter : { recordId: message.recordId },
            signer : Jws.createSigner(alice)
          });

          const readReply = await dwn.processMessage(bob.did, recordsRead.message);
          expect(readReply.status.code).to.equal(200);
          expect(readReply.record).to.exist;
          expect(readReply.record?.descriptor).to.exist;

          // Alice augments Bob's message as an external owner
          const { data, ...messageFetched } = readReply.record!; // remove data from message
          const ownerSignedMessage = await RecordsWrite.parse(messageFetched);
          await ownerSignedMessage.signAsOwner(Jws.createSigner(alice));

          // Test that Alice can successfully retain/write Bob's message to her DWN
          const aliceDataStream = readReply.record!.data;
          const aliceWriteReply = await dwn.processMessage(alice.did, ownerSignedMessage.message, { dataStream: aliceDataStream });
          expect(aliceWriteReply.status.code).to.equal(202);

          // Test that Bob's message can be read from Alice's DWN
          const readReply2 = await dwn.processMessage(alice.did, recordsRead.message);
          expect(readReply2.status.code).to.equal(200);
          expect(readReply2.record).to.exist;
          expect(readReply2.record?.descriptor).to.exist;

          const dataFetched = await DataStream.toBytes(readReply2.record!.data!);
          expect(ArrayUtility.byteArraysEqual(dataFetched, dataBytes!)).to.be.true;
        });

        it('should use `ownerSignature` for authorization when it is given - protocol-space', async () => {
          // scenario: Alice and Bob both have the same protocol which does NOT allow external entities to write,
          // but Alice can store a message authored by Bob as a owner in her own DWN
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

          // Sanity test that Bob cannot write to a protocol record to Alice's DWN
          const bobRecordsWrite = await TestDataGenerator.generateRecordsWrite({
            author       : bob,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'foo'
          });
          const recordsWriteReply = await dwn.processMessage(alice.did, bobRecordsWrite.message, { dataStream: bobRecordsWrite.dataStream });
          expect(recordsWriteReply.status.code).to.equal(401);

          // Skipping Alice fetching the message from Bob's DWN (as this is tested already in the flat-space test)

          // Alice augments Bob's message as an external owner
          const ownerSignedMessage = await RecordsWrite.parse(bobRecordsWrite.message);
          await ownerSignedMessage.signAsOwner(Jws.createSigner(alice));

          // Test that Alice can successfully retain/write Bob's message to her DWN
          const aliceDataStream = DataStream.fromBytes(bobRecordsWrite.dataBytes!);
          const aliceWriteReply = await dwn.processMessage(alice.did, ownerSignedMessage.message, { dataStream: aliceDataStream });
          expect(aliceWriteReply.status.code).to.equal(202);

          // Test that Bob's message can be read from Alice's DWN
          const recordsRead = await RecordsRead.create({
            filter : { recordId: bobRecordsWrite.message.recordId },
            signer : Jws.createSigner(alice)
          });
          const readReply = await dwn.processMessage(alice.did, recordsRead.message);
          expect(readReply.status.code).to.equal(200);
          expect(readReply.record).to.exist;
          expect(readReply.record?.descriptor).to.exist;

          const dataFetched = await DataStream.toBytes(readReply.record!.data!);
          expect(ArrayUtility.byteArraysEqual(dataFetched, bobRecordsWrite.dataBytes!)).to.be.true;
        });

        it('should throw if `ownerSignature` in `authorization` is mismatching with the tenant - flat-space', async () => {
          // scenario: Carol attempts to store a message with Alice being the owner, and should fail
          const alice = await TestDataGenerator.generateDidKeyPersona();
          const bob = await TestDataGenerator.generateDidKeyPersona();
          const carol = await TestDataGenerator.generateDidKeyPersona();

          // Bob creates a message, we skip writing to bob's DWN because that's orthogonal to this test
          const { recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite({ author: bob, published: true });

          // Alice augments Bob's message as an external owner, we also skipping writing to Alice's DWN because that's also orthogonal to this test
          await recordsWrite.signAsOwner(Jws.createSigner(alice));

          // Test that Carol is not able to store the message Alice created
          const carolWriteReply = await dwn.processMessage(carol.did, recordsWrite.message, { dataStream });
          expect(carolWriteReply.status.code).to.equal(401);
          expect(carolWriteReply.status.detail).to.contain('RecordsWriteOwnerAndTenantMismatch');
        });

        it('should throw if `ownerSignature` in `authorization` is mismatching with the tenant - protocol-space', async () => {
          // scenario: Alice, Bob, and Carol all have the same protocol which does NOT allow external entities to write,
          // scenario: Carol attempts to store a message with Alice being the owner, and should fail
          const alice = await TestDataGenerator.generateDidKeyPersona();
          const bob = await TestDataGenerator.generateDidKeyPersona();
          const carol = await TestDataGenerator.generateDidKeyPersona();

          const protocolDefinition = minimalProtocolDefinition;

          // Bob creates a message, we skip writing to Bob's DWN because that's orthogonal to this test
          const { recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite({
            author       : bob,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'foo'
          });

          // Alice augments Bob's message as an external owner, we also skipping writing to Alice's DWN because that's also orthogonal to this test
          await recordsWrite.signAsOwner(Jws.createSigner(alice));

          // Carol installs the protocol
          const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
            author: carol,
            protocolDefinition
          });
          const protocolsConfigureReply = await dwn.processMessage(carol.did, protocolsConfig.message);
          expect(protocolsConfigureReply.status.code).to.equal(202);

          // Test that Carol is not able to store the message Alice created
          const carolWriteReply = await dwn.processMessage(carol.did, recordsWrite.message, { dataStream });
          expect(carolWriteReply.status.code).to.equal(401);
          expect(carolWriteReply.status.detail).to.contain('RecordsWriteOwnerAndTenantMismatch');
        });

        it('should throw if `ownerSignature` fails verification', async () => {
          // scenario: Malicious Bob attempts to retain an externally authored message in Alice's DWN by providing an invalid `ownerSignature`
          const alice = await TestDataGenerator.generateDidKeyPersona();
          const bob = await TestDataGenerator.generateDidKeyPersona();

          // Bob creates a message, we skip writing to bob's DWN because that's orthogonal to this test
          const { recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite({ author: bob, published: true });

          // Bob pretends to be Alice by adding an invalid `ownerSignature`
          // We do this by creating a valid signature first then swap out with an invalid one
          await recordsWrite.signAsOwner(Jws.createSigner(alice));
          const bobSignature = recordsWrite.message.authorization.signature.signatures[0];
          recordsWrite.message.authorization.ownerSignature!.signatures[0].signature = bobSignature.signature; // invalid `ownerSignature`

          // Test that Bob is not able to store the message in Alice's DWN using an invalid `ownerSignature`
          const aliceWriteReply = await dwn.processMessage(alice.did, recordsWrite.message, { dataStream });
          expect(aliceWriteReply.status.detail).to.contain(DwnErrorCode.GeneralJwsVerifierInvalidSignature);
        });
      });

      describe('should inherit data from previous RecordsWrite given a matching dataCid and dataSize and no dataStream', () => {
        it('with data above the threshold for encodedData', async () => {
          const { message, author, dataStream, dataBytes } = await TestDataGenerator.generateRecordsWrite({
            data      : TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded + 1),
            published : false
          });
          const tenant = author.did;

          TestStubGenerator.stubDidResolver(didResolver, [author]);

          const initialWriteReply = await dwn.processMessage(tenant, message, { dataStream });
          expect(initialWriteReply.status.code).to.equal(202);

          const write2 = await RecordsWrite.createFrom({
            recordsWriteMessage : message,
            published           : true,
            signer              : Jws.createSigner(author),
          });

          const writeUpdateReply = await dwn.processMessage(tenant, write2.message);
          expect(writeUpdateReply.status.code).to.equal(202);
          const readMessage = await RecordsRead.create({
            filter: {
              recordId: message.recordId,
            }
          });

          const readMessageReply = await dwn.processMessage(tenant, readMessage.message);
          expect(readMessageReply.status.code).to.equal(200);
          expect(readMessageReply.record).to.exist;
          const data = await DataStream.toBytes(readMessageReply.record!.data);
          expect(data).to.eql(dataBytes);
        });

        it('with data equal to or below the threshold for encodedData', async () => {
          const { message, author, dataStream, dataBytes } = await TestDataGenerator.generateRecordsWrite({
            data      : TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded),
            published : false
          });
          const tenant = author.did;

          TestStubGenerator.stubDidResolver(didResolver, [author]);

          const initialWriteReply = await dwn.processMessage(tenant, message, { dataStream });
          expect(initialWriteReply.status.code).to.equal(202);

          const write2 = await RecordsWrite.createFrom({
            recordsWriteMessage : message,
            published           : true,
            signer              : Jws.createSigner(author),
          });

          const writeUpdateReply = await dwn.processMessage(tenant, write2.message);
          expect(writeUpdateReply.status.code).to.equal(202);
          const readMessage = await RecordsRead.create({
            filter: {
              recordId: message.recordId,
            }
          });

          const readMessageReply = await dwn.processMessage(tenant, readMessage.message);
          expect(readMessageReply.status.code).to.equal(200);
          expect(readMessageReply.record).to.exist;
          const data = await DataStream.toBytes(readMessageReply.record!.data);
          expect(data).to.eql(dataBytes);
        });
      });

      describe('should return 400 if actual data size mismatches with `dataSize` in descriptor', () => {
        it('with dataStream and `dataSize` larger than encodedData threshold', async () => {
          const alice = await TestDataGenerator.generateDidKeyPersona();
          const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({
            author : alice,
            data   : TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded + 1)
          });

          // replace the dataSize to simulate mismatch, will need to generate `recordId` and `authorization` property again
          message.descriptor.dataSize = DwnConstant.maxDataSizeAllowedToBeEncoded + 100;
          const descriptorCid = await Cid.computeCid(message.descriptor);
          const recordId = await RecordsWrite.getEntryId(alice.did, message.descriptor);
          const signer = Jws.createSigner(alice);
          const signature = await RecordsWrite.createSignerSignature({
            recordId,
            contextId   : message.contextId,
            descriptorCid,
            attestation : message.attestation,
            encryption  : message.encryption,
            signer
          });
          message.recordId = recordId;
          message.authorization = { signature };

          const reply = await dwn.processMessage(alice.did, message, { dataStream });
          expect(reply.status.code).to.equal(400);
          expect(reply.status.detail).to.contain(DwnErrorCode.RecordsWriteDataSizeMismatch);
        });

        it('with only `dataSize` larger than encodedData threshold', async () => {
          const alice = await TestDataGenerator.generateDidKeyPersona();
          const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({
            author : alice,
            data   : TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded)
          });

          // replace the dataSize to simulate mismatch, will need to generate `recordId` and `authorization` property again
          message.descriptor.dataSize = DwnConstant.maxDataSizeAllowedToBeEncoded + 100;
          const descriptorCid = await Cid.computeCid(message.descriptor);
          const recordId = await RecordsWrite.getEntryId(alice.did, message.descriptor);
          const signer = Jws.createSigner(alice);
          const signature = await RecordsWrite.createSignerSignature({
            recordId,
            contextId   : message.contextId,
            descriptorCid,
            attestation : message.attestation,
            encryption  : message.encryption,
            signer
          });
          message.recordId = recordId;
          message.authorization = { signature };

          const reply = await dwn.processMessage(alice.did, message, { dataStream });
          expect(reply.status.code).to.equal(400);
          expect(reply.status.detail).to.contain(DwnErrorCode.RecordsWriteDataSizeMismatch);
        });

        it('with only dataStream larger than encodedData threshold', async () => {
          const alice = await TestDataGenerator.generateDidKeyPersona();
          const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({
            author : alice,
            data   : TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded + 1)
          });

          // replace the dataSize to simulate mismatch, will need to generate `recordId` and `authorization` property again
          message.descriptor.dataSize = 1;
          const descriptorCid = await Cid.computeCid(message.descriptor);
          const recordId = await RecordsWrite.getEntryId(alice.did, message.descriptor);
          const signer = Jws.createSigner(alice);
          const signature = await RecordsWrite.createSignerSignature({
            recordId,
            contextId   : message.contextId,
            descriptorCid,
            attestation : message.attestation,
            encryption  : message.encryption,
            signer
          });
          message.recordId = recordId;
          message.authorization = { signature };

          const reply = await dwn.processMessage(alice.did, message, { dataStream });
          expect(reply.status.code).to.equal(400);
          expect(reply.status.detail).to.contain(DwnErrorCode.RecordsWriteDataSizeMismatch);
        });

        it('with both `dataSize` and dataStream below than encodedData threshold', async () => {
          const alice = await TestDataGenerator.generateDidKeyPersona();
          const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({
            author: alice
          });

          // replace the dataSize to simulate mismatch, will need to generate `recordId` and `authorization` property again
          message.descriptor.dataSize = 1;
          const descriptorCid = await Cid.computeCid(message.descriptor);
          const recordId = await RecordsWrite.getEntryId(alice.did, message.descriptor);
          const signer = Jws.createSigner(alice);
          const signature = await RecordsWrite.createSignerSignature({
            recordId,
            contextId   : message.contextId,
            descriptorCid,
            attestation : message.attestation,
            encryption  : message.encryption,
            signer
          });
          message.recordId = recordId;
          message.authorization = { signature };

          const reply = await dwn.processMessage(alice.did, message, { dataStream });
          expect(reply.status.code).to.equal(400);
          expect(reply.status.detail).to.contain(DwnErrorCode.RecordsWriteDataSizeMismatch);
        });
      });

      it('should return 400 for if dataStream is not present for a write after a delete', async () => {
        const { message, author, dataStream, dataBytes } = await TestDataGenerator.generateRecordsWrite({
          data      : TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded),
          published : false
        });
        const tenant = author.did;

        TestStubGenerator.stubDidResolver(didResolver, [author]);

        const initialWriteReply = await dwn.processMessage(tenant, message, { dataStream });
        expect(initialWriteReply.status.code).to.equal(202);

        const recordsDelete = await RecordsDelete.create({
          recordId : message.recordId,
          signer   : Jws.createSigner(author),
        });
        const deleteReply = await dwn.processMessage(tenant, recordsDelete.message);
        expect(deleteReply.status.code).to.equal(202);

        const write = await RecordsWrite.createFrom({
          recordsWriteMessage : message,
          signer              : Jws.createSigner(author),
        });

        const withoutDataReply = await dwn.processMessage(tenant, write.message);
        expect(withoutDataReply.status.code).to.equal(400);
        expect(withoutDataReply.status.detail).to.contain(DwnErrorCode.RecordsWriteMissingDataStream);
        const updatedWriteData = DataStream.fromBytes(dataBytes!);
        const withoutDataReply2 = await dwn.processMessage(tenant, write.message, { dataStream: updatedWriteData });
        expect(withoutDataReply2.status.code).to.equal(202);
      });

      it('should return 400 for if dataStream is not present for a write after a delete with data above the threshold', async () => {
        const { message, author, dataStream, dataBytes } = await TestDataGenerator.generateRecordsWrite({
          data      : TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded + 1),
          published : false
        });
        const tenant = author.did;

        TestStubGenerator.stubDidResolver(didResolver, [author]);

        const initialWriteReply = await dwn.processMessage(tenant, message, { dataStream });
        expect(initialWriteReply.status.code).to.equal(202);

        const recordsDelete = await RecordsDelete.create({
          recordId : message.recordId,
          signer   : Jws.createSigner(author),
        });
        const deleteReply = await dwn.processMessage(tenant, recordsDelete.message);
        expect(deleteReply.status.code).to.equal(202);

        const write = await RecordsWrite.createFrom({
          recordsWriteMessage : message,
          signer              : Jws.createSigner(author),
        });

        const withoutDataReply = await dwn.processMessage(tenant, write.message);
        expect(withoutDataReply.status.code).to.equal(400);
        expect(withoutDataReply.status.detail).to.contain(DwnErrorCode.RecordsWriteMissingDataStream);
        const updatedWriteData = DataStream.fromBytes(dataBytes!);
        const withoutDataReply2 = await dwn.processMessage(tenant, write.message, { dataStream: updatedWriteData });
        expect(withoutDataReply2.status.code).to.equal(202);
      });

      it('should return 400 for data CID mismatch with both dataStream and `dataSize` larger than encodedData threshold', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const { message } = await TestDataGenerator.generateRecordsWrite({
          author : alice,
          data   : TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded + 1)
        });
        const dataStream =
          DataStream.fromBytes(TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded + 1)); // mismatch data stream

        const reply = await dwn.processMessage(alice.did, message, { dataStream });
        expect(reply.status.code).to.equal(400);
        expect(reply.status.detail).to.contain(DwnErrorCode.RecordsWriteDataCidMismatch);
      });

      it('should return 400 for data CID mismatch with `dataSize` larger than encodedData threshold', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const { message } = await TestDataGenerator.generateRecordsWrite({
          author : alice,
          data   : TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded + 1)
        });
        const dataStream =
          DataStream.fromBytes(TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded)); // mismatch data stream

        const reply = await dwn.processMessage(alice.did, message, { dataStream });
        expect(reply.status.code).to.equal(400);
        expect(reply.status.detail).to.contain(DwnErrorCode.RecordsWriteDataCidMismatch);
      });

      it('should return 400 for data CID mismatch with dataStream larger than encodedData threshold', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const { message } = await TestDataGenerator.generateRecordsWrite({
          author : alice,
          data   : TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded)
        });
        const dataStream =
          DataStream.fromBytes(TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded + 1)); // mismatch data stream

        const reply = await dwn.processMessage(alice.did, message, { dataStream });
        expect(reply.status.code).to.equal(400);
        expect(reply.status.detail).to.contain(DwnErrorCode.RecordsWriteDataCidMismatch);
      });

      it('should return 400 for data CID mismatch with both dataStream and `dataSize` below than encodedData threshold', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const { message } = await TestDataGenerator.generateRecordsWrite({
          author : alice,
          data   : TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded)
        });
        const dataStream =
          DataStream.fromBytes(TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded)); // mismatch data stream

        const reply = await dwn.processMessage(alice.did, message, { dataStream });
        expect(reply.status.code).to.equal(400);
        expect(reply.status.detail).to.contain(DwnErrorCode.RecordsWriteDataCidMismatch);
      });

      it('#359 - should not allow access of data by referencing a different`dataCid` in "modify" `RecordsWrite` with large data', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();

        // alice writes a record
        const dataString = TestDataGenerator.randomString(DwnConstant.maxDataSizeAllowedToBeEncoded + 1);
        const dataSize = dataString.length;
        const data = Encoder.stringToBytes(dataString);
        const dataCid = await Cid.computeDagPbCidFromBytes(data);

        const write1 = await TestDataGenerator.generateRecordsWrite({
          author: alice,
          data,
        });

        const write1Reply = await dwn.processMessage(alice.did, write1.message, { dataStream: write1.dataStream });
        expect(write1Reply.status.code).to.equal(202);

        // alice writes another record (which will be modified later)
        const write2 = await TestDataGenerator.generateRecordsWrite({ author: alice });
        const write2Reply = await dwn.processMessage(alice.did, write2.message, { dataStream: write2.dataStream });
        expect(write2Reply.status.code).to.equal(202);

        // modify write2 by referencing the `dataCid` in write1 (which should not be allowed)
        const write2Change = await TestDataGenerator.generateRecordsWrite({
          author       : alice,
          recipient    : write2.message.descriptor.recipient,
          recordId     : write2.message.recordId,
          dateCreated  : write2.message.descriptor.dateCreated,
          protocolPath : write2.message.descriptor.protocolPath,
          schema       : write2.message.descriptor.schema,
          dataFormat   : write2.message.descriptor.dataFormat,
          // unauthorized reference to data in write1
          dataCid,
          dataSize
        });
        const write2ChangeReply = await dwn.processMessage(alice.did, write2Change.message);
        expect(write2ChangeReply.status.code).to.equal(400); // should be disallowed
        expect(write2ChangeReply.status.detail).to.contain(DwnErrorCode.RecordsWriteDataCidMismatch);

        // further sanity test to make sure the change is not written, ie. write2 still has the original data
        const read = await RecordsRead.create({
          filter: {
            recordId: write2.message.recordId,
          },
          signer: Jws.createSigner(alice)
        });

        const readReply = await dwn.processMessage(alice.did, read.message);
        expect(readReply.status.code).to.equal(200);

        const readDataBytes = await DataStream.toBytes(readReply.record!.data!);
        expect(ArrayUtility.byteArraysEqual(readDataBytes, write2.dataBytes!)).to.be.true;
      });

      it('#359 - should not allow access of data by referencing a different`dataCid` in "modify" `RecordsWrite`', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();

        // alice writes a record
        const dataString = TestDataGenerator.randomString(DwnConstant.maxDataSizeAllowedToBeEncoded);
        const dataSize = dataString.length;
        const data = Encoder.stringToBytes(dataString);
        const dataCid = await Cid.computeDagPbCidFromBytes(data);

        const write1 = await TestDataGenerator.generateRecordsWrite({
          author: alice,
          data,
        });

        const write1Reply = await dwn.processMessage(alice.did, write1.message, { dataStream: write1.dataStream });
        expect(write1Reply.status.code).to.equal(202);

        // alice writes another record (which will be modified later)
        const write2 = await TestDataGenerator.generateRecordsWrite({ author: alice });
        const write2Reply = await dwn.processMessage(alice.did, write2.message, { dataStream: write2.dataStream });
        expect(write2Reply.status.code).to.equal(202);

        // modify write2 by referencing the `dataCid` in write1 (which should not be allowed)
        const write2Change = await TestDataGenerator.generateRecordsWrite({
          author       : alice,
          recipient    : write2.message.descriptor.recipient,
          recordId     : write2.message.recordId,
          dateCreated  : write2.message.descriptor.dateCreated,
          protocolPath : write2.message.descriptor.protocolPath,
          schema       : write2.message.descriptor.schema,
          dataFormat   : write2.message.descriptor.dataFormat,
          // unauthorized reference to data in write1
          dataCid,
          dataSize
        });
        const write2ChangeReply = await dwn.processMessage(alice.did, write2Change.message);
        expect(write2ChangeReply.status.code).to.equal(400); // should be disallowed
        expect(write2ChangeReply.status.detail).to.contain(DwnErrorCode.RecordsWriteDataCidMismatch);

        // further sanity test to make sure the change is not written, ie. write2 still has the original data
        const read = await RecordsRead.create({
          filter: {
            recordId: write2.message.recordId,
          },
          signer: Jws.createSigner(alice)
        });

        const readReply = await dwn.processMessage(alice.did, read.message);
        expect(readReply.status.code).to.equal(200);

        const readDataBytes = await DataStream.toBytes(readReply.record!.data!);
        expect(ArrayUtility.byteArraysEqual(readDataBytes, write2.dataBytes!)).to.be.true;
      });

      describe('initial write & subsequent write tests', () => {
        describe('createFrom()', () => {
          it('should accept a published RecordsWrite using createFrom() without specifying `data` or `datePublished`', async () => {
            const data = Encoder.stringToBytes('test');
            const encodedData = Encoder.bytesToBase64Url(data);

            // new record
            const { message, author, recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite({
              published: false,
              data,
            });
            const tenant = author.did;

            // setting up a stub DID resolver
            TestStubGenerator.stubDidResolver(didResolver, [author]);

            const reply = await dwn.processMessage(tenant, message, { dataStream });
            expect(reply.status.code).to.equal(202);

            // changing the `published` property
            const newWrite = await RecordsWrite.createFrom({
              recordsWriteMessage : recordsWrite.message,
              published           : true,
              signer              : Jws.createSigner(author)
            });

            const newWriteReply = await dwn.processMessage(tenant, newWrite.message);
            expect(newWriteReply.status.code).to.equal(202);

            // verify the new record state can be queried
            const recordsQueryMessageData = await TestDataGenerator.generateRecordsQuery({
              author,
              filter: { recordId: message.recordId }
            });

            const recordsQueryReply = await dwn.processMessage(tenant, recordsQueryMessageData.message);
            expect(recordsQueryReply.status.code).to.equal(200);
            expect(recordsQueryReply.entries?.length).to.equal(1);
            expect(recordsQueryReply.entries![0].descriptor.published).to.equal(true);

            // very importantly verify the original data is still returned
            expect(recordsQueryReply.entries![0].encodedData).to.equal(encodedData);
          });

          it('should inherit parent published state when using createFrom() to create RecordsWrite', async () => {
            const { message, author, recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite({
              published: true
            });
            const tenant = author.did;

            // setting up a stub DID resolver
            TestStubGenerator.stubDidResolver(didResolver, [author]);
            const reply = await dwn.processMessage(tenant, message, { dataStream });

            expect(reply.status.code).to.equal(202);

            const newData = Encoder.stringToBytes('new data');
            const newWrite = await RecordsWrite.createFrom({
              recordsWriteMessage : recordsWrite.message,
              data                : newData,
              signer              : Jws.createSigner(author)
            });

            const newWriteReply = await dwn.processMessage(tenant, newWrite.message, { dataStream: DataStream.fromBytes(newData) });

            expect(newWriteReply.status.code).to.equal(202);

            // verify the new record state can be queried
            const recordsQueryMessageData = await TestDataGenerator.generateRecordsQuery({
              author,
              filter: { recordId: message.recordId }
            });

            const recordsQueryReply = await dwn.processMessage(tenant, recordsQueryMessageData.message);
            expect(recordsQueryReply.status.code).to.equal(200);
            expect(recordsQueryReply.entries?.length).to.equal(1);

            const recordsWriteReturned = recordsQueryReply.entries![0];
            expect(recordsWriteReturned.encodedData).to.equal(Encoder.bytesToBase64Url(newData));
            expect(recordsWriteReturned.descriptor.published).to.equal(true);
            expect(recordsWriteReturned.descriptor.datePublished).to.equal(message.descriptor.datePublished);
          });
        });

        it('should fail with 400 if modifying a record but its initial write cannot be found in DB', async () => {
          const recordId = await TestDataGenerator.randomCborSha256Cid();
          const { message, author, dataStream } = await TestDataGenerator.generateRecordsWrite({
            recordId,
            data: Encoder.stringToBytes('anything') // simulating modification of a message
          });
          const tenant = author.did;

          TestStubGenerator.stubDidResolver(didResolver, [author]);
          const reply = await dwn.processMessage(tenant, message, { dataStream });

          expect(reply.status.code).to.equal(400);
          expect(reply.status.detail).to.contain('initial write is not found');
        });

        it('should return 400 if `dateCreated` and `messageTimestamp` are not the same in an initial write', async () => {
          const { author, message, dataStream } = await TestDataGenerator.generateRecordsWrite({
            dateCreated      : '2023-01-10T10:20:30.405060Z',
            messageTimestamp : Time.getCurrentTimestamp() // this always generate a different timestamp
          });
          const tenant = author.did;

          TestStubGenerator.stubDidResolver(didResolver, [author]);

          const reply = await dwn.processMessage(tenant, message, { dataStream });

          expect(reply.status.code).to.equal(400);
          expect(reply.status.detail).to.contain('must match dateCreated');
        });

        it('should return 400 if `contextId` in an initial protocol-base write mismatches with the expected deterministic `contextId`', async () => {
        // generate a message with protocol so that computed contextId is also computed and included in message
          const { message, dataStream, author } = await TestDataGenerator.generateRecordsWrite({ protocol: 'http://any.value', protocolPath: 'any/value' });

          message.contextId = await TestDataGenerator.randomCborSha256Cid(); // make contextId mismatch from computed value

          TestStubGenerator.stubDidResolver(didResolver, [author]);

          const reply = await dwn.processMessage('unused-tenant-DID', message, { dataStream });
          expect(reply.status.code).to.equal(400);
          expect(reply.status.detail).to.contain('does not match deterministic contextId');
        });

        describe('event log', () => {
          it('should add an event to the event log on initial write', async () => {
            const { message, author, dataStream } = await TestDataGenerator.generateRecordsWrite();
            TestStubGenerator.stubDidResolver(didResolver, [author]);

            const reply = await dwn.processMessage(author.did, message, { dataStream });
            expect(reply.status.code).to.equal(202);

            const { events } = await eventLog.getEvents(author.did);
            expect(events.length).to.equal(1);

            const messageCid = await Message.getCid(message);
            expect(events[0]).to.equal(messageCid);
          });

          it('should only keep first write and latest write when subsequent writes happen', async () => {
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

            const newestWrite = await RecordsWrite.createFrom({
              recordsWriteMessage : recordsWrite.message,
              published           : true,
              signer              : Jws.createSigner(author)
            });

            const newestWriteReply = await dwn.processMessage(author.did, newestWrite.message);
            expect(newestWriteReply.status.code).to.equal(202);

            const { events } = await eventLog.getEvents(author.did);
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

      describe('protocol based writes', () => {
        it('should allow write with allow-anyone rule', async () => {
          // scenario: Bob writes into Alice's DWN given Alice's "email" protocol allow-anyone rule

          // write a protocol definition with an allow-anyone rule
          const protocolDefinition = emailProtocolDefinition as ProtocolDefinition;
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

          // generate a `RecordsWrite` message from bob
          const bobData = Encoder.stringToBytes('data from bob');
          const emailFromBob = await TestDataGenerator.generateRecordsWrite(
            {
              author       : bob,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'email',
              schema       : protocolDefinition.types.email.schema,
              dataFormat   : protocolDefinition.types.email.dataFormats![0],
              data         : bobData
            }
          );

          const bobWriteReply = await dwn.processMessage(alice.did, emailFromBob.message, { dataStream: emailFromBob.dataStream });
          expect(bobWriteReply.status.code).to.equal(202);

          // verify bob's message got written to the DB
          const messageDataForQueryingBobsWrite = await TestDataGenerator.generateRecordsQuery({
            author : alice,
            filter : { recordId: emailFromBob.message.recordId }
          });
          const bobRecordsQueryReply = await dwn.processMessage(alice.did, messageDataForQueryingBobsWrite.message);
          expect(bobRecordsQueryReply.status.code).to.equal(200);
          expect(bobRecordsQueryReply.entries?.length).to.equal(1);
          expect(bobRecordsQueryReply.entries![0].encodedData).to.equal(Encoder.bytesToBase64Url(bobData));
        });

        it('should allow update with allow-anyone rule', async () => {
          // scenario: Alice creates a record on her DWN, and Bob (anyone) is able to update it. Bob is not able to
          //           create a record.

          const alice = await TestDataGenerator.generateDidKeyPersona();
          const bob = await TestDataGenerator.generateDidKeyPersona();

          const protocolDefinition = anyoneCollaborateProtocolDefinition;

          const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition
          });
          const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
          expect(protocolsConfigureReply.status.code).to.equal(202);

          // Alice creates a doc
          const docRecord = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            recipient    : alice.did,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'doc'
          });
          const docRecordsReply = await dwn.processMessage(alice.did, docRecord.message, { dataStream: docRecord.dataStream });
          expect(docRecordsReply.status.code).to.equal(202);

          // Bob updates Alice's doc
          const bobsData = await TestDataGenerator.randomBytes(10);
          const docUpdateRecord = await TestDataGenerator.generateFromRecordsWrite({
            author        : bob,
            existingWrite : docRecord.recordsWrite,
            data          : bobsData
          });
          const docUpdateRecordsReply = await dwn.processMessage(alice.did, docUpdateRecord.message, { dataStream: docUpdateRecord.dataStream });
          expect(docUpdateRecordsReply.status.code).to.equal(202);

          // Bob tries and fails to create a new record
          const bobDocRecord = await TestDataGenerator.generateRecordsWrite({
            author       : bob,
            recipient    : bob.did,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'doc'
          });
          const bobDocRecordsReply = await dwn.processMessage(alice.did, bobDocRecord.message, { dataStream: bobDocRecord.dataStream });
          expect(bobDocRecordsReply.status.code).to.equal(401);
          expect(bobDocRecordsReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationActionNotAllowed);
        });

        describe('recipient rules', () => {
          it('should allow write with ancestor recipient rule', async () => {
            // scenario: VC issuer writes into Alice's DWN an asynchronous credential response upon receiving Alice's credential application
            //           Carol tries to write a credential response but is rejected

            const protocolDefinition = credentialIssuanceProtocolDefinition;
            const credentialApplicationSchema = protocolDefinition.types.credentialApplication.schema;
            const credentialResponseSchema = protocolDefinition.types.credentialResponse.schema;

            const alice = await TestDataGenerator.generatePersona();
            const vcIssuer = await TestDataGenerator.generatePersona();
            const carol = await TestDataGenerator.generatePersona();

            const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
              author: alice,
              protocolDefinition
            });

            // setting up a stub DID resolver
            TestStubGenerator.stubDidResolver(didResolver, [alice, vcIssuer, carol]);

            const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
            expect(protocolsConfigureReply.status.code).to.equal(202);

            // write a credential application to Alice's DWN to simulate that she has sent a credential application to a VC issuer
            const encodedCredentialApplication = new TextEncoder().encode('credential application data');
            const credentialApplication = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              recipient    : vcIssuer.did,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'credentialApplication', // this comes from `types` in protocol definition
              schema       : credentialApplicationSchema,
              dataFormat   : protocolDefinition.types.credentialApplication.dataFormats[0],
              data         : encodedCredentialApplication
            });

            const credentialApplicationReply = await dwn.processMessage(
              alice.did,
              credentialApplication.message,
              { dataStream: credentialApplication.dataStream }
            );
            expect(credentialApplicationReply.status.code).to.equal(202);

            // generate a credential application response message from VC issuer
            const encodedCredentialResponse = new TextEncoder().encode('credential response data');
            const credentialResponse = await TestDataGenerator.generateRecordsWrite(
              {
                author          : vcIssuer,
                recipient       : alice.did,
                protocol        : protocolDefinition.protocol,
                protocolPath    : 'credentialApplication/credentialResponse', // this comes from `types` in protocol definition
                parentContextId : credentialApplication.message.contextId,
                schema          : credentialResponseSchema,
                dataFormat      : protocolDefinition.types.credentialResponse.dataFormats[0],
                data            : encodedCredentialResponse
              }
            );

            const credentialResponseReply =
              await dwn.processMessage(alice.did, credentialResponse.message, { dataStream: credentialResponse.dataStream });
            expect(credentialResponseReply.status.code).to.equal(202);

            // verify VC issuer's message got written to the DB
            const messageDataForQueryingCredentialResponse = await TestDataGenerator.generateRecordsQuery({
              author : alice,
              filter : { recordId: credentialResponse.message.recordId }
            });
            const applicationResponseQueryReply = await dwn.processMessage(alice.did, messageDataForQueryingCredentialResponse.message);
            expect(applicationResponseQueryReply.status.code).to.equal(200);
            expect(applicationResponseQueryReply.entries?.length).to.equal(1);
            expect(applicationResponseQueryReply.entries![0].encodedData)
              .to.equal(base64url.baseEncode(encodedCredentialResponse));
          });

          it('should allow update with ancestor recipient rule', async () => {
            // scenario: Alice creates a post with Bob as recipient. Alice adds a tag to the post. Bob is able to update
            //           the tag because he is recipient of the post. Bob is not able to create a new tag.

            const alice = await TestDataGenerator.generateDidKeyPersona();
            const bob = await TestDataGenerator.generateDidKeyPersona();

            const protocolDefinition = recipientCanProtocol;

            const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
              author: alice,
              protocolDefinition
            });
            const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
            expect(protocolsConfigureReply.status.code).to.equal(202);

            // Alice creates a post with Bob as recipient
            const docRecord = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              recipient    : bob.did,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'post'
            });
            const docRecordsReply = await dwn.processMessage(alice.did, docRecord.message, { dataStream: docRecord.dataStream });
            expect(docRecordsReply.status.code).to.equal(202);

            // Alice creates a post/tag
            const tagRecord = await TestDataGenerator.generateRecordsWrite({
              author          : alice,
              recipient       : alice.did,
              protocol        : protocolDefinition.protocol,
              protocolPath    : 'post/tag',
              parentContextId : docRecord.message.contextId!,
            });
            const tagRecordsReply = await dwn.processMessage(alice.did, tagRecord.message, { dataStream: tagRecord.dataStream });
            expect(tagRecordsReply.status.code).to.equal(202);

            // Bob updates Alice's post
            const bobsData = await TestDataGenerator.randomBytes(10);
            const tagUpdateRecord = await TestDataGenerator.generateFromRecordsWrite({
              author        : bob,
              existingWrite : tagRecord.recordsWrite,
              data          : bobsData
            });
            const tagUpdateRecordsReply = await dwn.processMessage(alice.did, tagUpdateRecord.message, { dataStream: tagUpdateRecord.dataStream });
            expect(tagUpdateRecordsReply.status.code).to.equal(202);

            // Bob tries and fails to create a new record
            const bobTagRecord = await TestDataGenerator.generateRecordsWrite({
              author          : bob,
              recipient       : bob.did,
              protocol        : protocolDefinition.protocol,
              protocolPath    : 'post/tag',
              parentContextId : docRecord.message.contextId!,
            });
            const bobTagRecordsReply = await dwn.processMessage(alice.did, bobTagRecord.message, { dataStream: bobTagRecord.dataStream });
            expect(bobTagRecordsReply.status.code).to.equal(401);
            expect(bobTagRecordsReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationActionNotAllowed);
          });

          it('should allowed update with direct recipient rule', async () => {
            // scenario: Alice creates a 'post' with Bob as recipient. Bob is able to update
            //           the 'post' because he was recipient of it. Carol is not able to update it.

            const protocolDefinition = recipientCanProtocol as ProtocolDefinition;
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

            // Carol is unable to update the 'post'
            const carolRecordsWrite = await TestDataGenerator.generateFromRecordsWrite({
              author        : carol,
              existingWrite : recordsWrite.recordsWrite
            });
            const carolRecordsWriteReply = await dwn.processMessage(alice.did, carolRecordsWrite.message);
            expect(carolRecordsWriteReply.status.code).to.eq(401);
            expect(carolRecordsWriteReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationActionNotAllowed);

            // Bob is able to update the post
            const bobRecordsWrite = await TestDataGenerator.generateFromRecordsWrite({
              author        : bob,
              existingWrite : recordsWrite.recordsWrite,
            });
            const bobRecordsWriteReply = await dwn.processMessage(alice.did, bobRecordsWrite.message, { dataStream: bobRecordsWrite.dataStream });
            expect(bobRecordsWriteReply.status.code).to.eq(202);
          });
        });

        describe('author action rules', () => {
          it('allow author to write with ancestor author rule and block non-authors', async () => {
            // scenario: Alice posts an image on the social media protocol to Bob's, then she adds a caption
            //           AliceImposter attempts to post add a caption to Alice's image, but is blocked
            const protocolDefinition = socialMediaProtocolDefinition;

            const alice = await TestDataGenerator.generatePersona();
            const aliceImposter = await TestDataGenerator.generatePersona();
            const bob = await TestDataGenerator.generatePersona();

            // setting up a stub DID resolver
            TestStubGenerator.stubDidResolver(didResolver, [alice, aliceImposter, bob]);

            // Install social-media protocol
            const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
              author: bob,
              protocolDefinition
            });
            const protocolsConfigureReply = await dwn.processMessage(bob.did, protocolsConfig.message);
            expect(protocolsConfigureReply.status.code).to.equal(202);

            // Alice writes image to bob's DWN
            const encodedImage = new TextEncoder().encode('cafe-aesthetic.jpg');
            const imageRecordsWrite = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'image', // this comes from `types` in protocol definition
              schema       : protocolDefinition.types.image.schema,
              dataFormat   : protocolDefinition.types.image.dataFormats[0],
              data         : encodedImage
            });
            const imageReply = await dwn.processMessage(bob.did, imageRecordsWrite.message, { dataStream: imageRecordsWrite.dataStream });
            expect(imageReply.status.code).to.equal(202);

            // AliceImposter attempts and fails to caption Alice's image
            const encodedCaptionImposter = new TextEncoder().encode('bad vibes! >:(');
            const captionImposter = await TestDataGenerator.generateRecordsWrite({
              author          : aliceImposter,
              protocol        : protocolDefinition.protocol,
              protocolPath    : 'image/caption', // this comes from `types` in protocol definition
              schema          : protocolDefinition.types.caption.schema,
              dataFormat      : protocolDefinition.types.caption.dataFormats[0],
              parentContextId : imageRecordsWrite.recordsWrite.message.contextId,
              data            : encodedCaptionImposter
            });
            const captionReply = await dwn.processMessage(bob.did, captionImposter.message, { dataStream: captionImposter.dataStream });
            expect(captionReply.status.code).to.equal(401);
            expect(captionReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationActionNotAllowed);

            // Alice is able to add a caption to her image
            const encodedCaption = new TextEncoder().encode('coffee and work vibes!');
            const captionRecordsWrite = await TestDataGenerator.generateRecordsWrite({
              author          : alice,
              protocol        : protocolDefinition.protocol,
              protocolPath    : 'image/caption',
              schema          : protocolDefinition.types.caption.schema,
              dataFormat      : protocolDefinition.types.caption.dataFormats[0],
              parentContextId : imageRecordsWrite.recordsWrite.message.contextId,
              data            : encodedCaption
            });
            const captionResponse = await dwn.processMessage(bob.did, captionRecordsWrite.message, { dataStream: captionRecordsWrite.dataStream });
            expect(captionResponse.status.code).to.equal(202);

            // Verify Alice's caption got written to the DB
            const messageDataForQueryingCaptionResponse = await TestDataGenerator.generateRecordsQuery({
              author : alice,
              filter : { recordId: captionRecordsWrite.message.recordId }
            });
            const applicationResponseQueryReply = await dwn.processMessage(bob.did, messageDataForQueryingCaptionResponse.message);
            expect(applicationResponseQueryReply.status.code).to.equal(200);
            expect(applicationResponseQueryReply.entries?.length).to.equal(1);
            expect(applicationResponseQueryReply.entries![0].encodedData)
              .to.equal(base64url.baseEncode(encodedCaption));
          });

          it('should allow update with ancestor author rule', async () => {
            // scenario: Bob authors a post on Alice's DWN. Alice adds a comment to the post. Bob is able to update the comment,
            //           since he authored the post.

            const alice = await TestDataGenerator.generateDidKeyPersona();
            const bob = await TestDataGenerator.generateDidKeyPersona();

            const protocolDefinition = authorCanProtocolDefinition;

            const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
              author: alice,
              protocolDefinition
            });
            const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
            expect(protocolsConfigureReply.status.code).to.equal(202);

            // Bob creates a post
            const postRecord = await TestDataGenerator.generateRecordsWrite({
              author       : bob,
              recipient    : bob.did,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'post'
            });
            const postRecordsReply = await dwn.processMessage(alice.did, postRecord.message, { dataStream: postRecord.dataStream });
            expect(postRecordsReply.status.code).to.equal(202);

            // Alice creates a post/comment
            const commentRecord = await TestDataGenerator.generateRecordsWrite({
              author          : alice,
              recipient       : alice.did,
              protocol        : protocolDefinition.protocol,
              protocolPath    : 'post/comment',
              parentContextId : postRecord.message.contextId!,
            });
            const commentRecordsReply = await dwn.processMessage(alice.did, commentRecord.message, { dataStream: commentRecord.dataStream });
            expect(commentRecordsReply.status.code).to.equal(202);

            // Bob updates Alice's comment
            const bobsData = await TestDataGenerator.randomBytes(10);
            const postUpdateRecord = await TestDataGenerator.generateFromRecordsWrite({
              author        : alice,
              existingWrite : commentRecord.recordsWrite,
              data          : bobsData
            });
            const commentUpdateRecordsReply =
              await dwn.processMessage(alice.did, postUpdateRecord.message, { dataStream: postUpdateRecord.dataStream });
            expect(commentUpdateRecordsReply.status.code).to.equal(202);

            // Bob tries and fails to create a new comment
            const bobPostRecord = await TestDataGenerator.generateRecordsWrite({
              author          : bob,
              recipient       : bob.did,
              protocol        : protocolDefinition.protocol,
              protocolPath    : 'post/comment',
              parentContextId : postRecord.message.contextId!,
            });
            const bobPostRecordsReply = await dwn.processMessage(alice.did, bobPostRecord.message, { dataStream: bobPostRecord.dataStream });
            expect(bobPostRecordsReply.status.code).to.equal(401);
            expect(bobPostRecordsReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationActionNotAllowed);
          });
        });

        describe('role rules', () => {
          describe('write root-level role records', () => {
            it('allows a root-level role record with unique recipient to be created and updated', async () => {
              // scenario: Alice adds Bob to the 'friend' role. Then she updates the 'friend' record.

              const alice = await TestDataGenerator.generateDidKeyPersona();
              const bob = await TestDataGenerator.generateDidKeyPersona();

              const protocolDefinition = friendRoleProtocolDefinition;

              const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
                author: alice,
                protocolDefinition
              });
              const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
              expect(protocolsConfigureReply.status.code).to.equal(202);

              // Alice writes a 'friend' root-level role record with Bob as recipient
              const friendRoleRecord = await TestDataGenerator.generateRecordsWrite({
                author       : alice,
                recipient    : bob.did,
                protocol     : protocolDefinition.protocol,
                protocolPath : 'friend',
                data         : new TextEncoder().encode('Bob is my friend'),
              });
              const friendRoleReply = await dwn.processMessage(alice.did, friendRoleRecord.message, { dataStream: friendRoleRecord.dataStream });
              expect(friendRoleReply.status.code).to.equal(202);

              // Alice updates Bob's 'friend' record
              const updateFriendRecord = await TestDataGenerator.generateFromRecordsWrite({
                author        : alice,
                existingWrite : friendRoleRecord.recordsWrite,
              });
              const updateFriendReply =
                await dwn.processMessage(alice.did, updateFriendRecord.message, { dataStream: updateFriendRecord.dataStream });
              expect(updateFriendReply.status.code).to.equal(202);
            });

            it('should reject role RecordsWrite if recipient is undefined', async () => {
              // scenario: Alice writes a root-level role record with no recipient and it is rejected

              const alice = await TestDataGenerator.generateDidKeyPersona();

              const protocolDefinition = friendRoleProtocolDefinition;

              const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
                author: alice,
                protocolDefinition
              });
              const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
              expect(protocolsConfigureReply.status.code).to.equal(202);

              // Alice writes a 'friend' root-level role record with no recipient
              const friendRoleRecord = await TestDataGenerator.generateRecordsWrite({
                author       : alice,
                protocol     : protocolDefinition.protocol,
                protocolPath : 'friend',
                data         : new TextEncoder().encode('Bob is my friend'),
              });
              const friendRoleReply = await dwn.processMessage(alice.did, friendRoleRecord.message, { dataStream: friendRoleRecord.dataStream });
              expect(friendRoleReply.status.code).to.equal(400);
              expect(friendRoleReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationRoleMissingRecipient);
            });

            it('should allow a new root-level role record to be created for the same recipient if their old one was deleted', async () => {
              // scenario: Alice adds Bob to the 'friend' role, then deletes the role. Alice writes a new record adding Bob as a 'friend' again.

              const alice = await TestDataGenerator.generateDidKeyPersona();
              const bob = await TestDataGenerator.generateDidKeyPersona();

              const protocolDefinition = friendRoleProtocolDefinition;

              const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
                author: alice,
                protocolDefinition
              });
              const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
              expect(protocolsConfigureReply.status.code).to.equal(202);

              // Alice writes a 'friend' root-level role record with Bob as recipient
              const friendRoleRecord = await TestDataGenerator.generateRecordsWrite({
                author       : alice,
                recipient    : bob.did,
                protocol     : protocolDefinition.protocol,
                protocolPath : 'friend',
                data         : new TextEncoder().encode('Bob is my friend'),
              });
              const friendRoleReply = await dwn.processMessage(alice.did, friendRoleRecord.message, { dataStream: friendRoleRecord.dataStream });
              expect(friendRoleReply.status.code).to.equal(202);

              // Alice deletes Bob's 'friend' role record
              const deleteFriend = await TestDataGenerator.generateRecordsDelete({
                author   : alice,
                recordId : friendRoleRecord.message.recordId,
              });
              const deleteFriendReply = await dwn.processMessage(alice.did, deleteFriend.message);
              expect(deleteFriendReply.status.code).to.equal(202);

              // Alice writes a new record adding Bob as a 'friend' again
              const duplicateFriendRecord = await TestDataGenerator.generateRecordsWrite({
                author       : alice,
                recipient    : bob.did,
                protocol     : protocolDefinition.protocol,
                protocolPath : 'friend',
                data         : new TextEncoder().encode('Bob is still my friend'),
              });
              const duplicateFriendReply =
                await dwn.processMessage(alice.did, duplicateFriendRecord.message, { dataStream: duplicateFriendRecord.dataStream });
              expect(duplicateFriendReply.status.code).to.equal(202);
            });
          });

          describe('write context role records', () => {
            it('can authorized a create or update RecordsWrite using the invoked a context role', async () => {
              // scenario: Alice creates a thread and adds Bob to the 'thread/participant' role. Then she updates Bob's role record.

              const alice = await TestDataGenerator.generateDidKeyPersona();
              const bob = await TestDataGenerator.generateDidKeyPersona();

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

              // Alice adds Bob as a 'thread/participant' in that thread
              const participantRecord = await TestDataGenerator.generateRecordsWrite({
                author          : alice,
                recipient       : bob.did,
                protocol        : protocolDefinition.protocol,
                protocolPath    : 'thread/participant',
                parentContextId : threadRecord.message.contextId,
              });
              const participantRecordReply =
                await dwn.processMessage(alice.did, participantRecord.message, { dataStream: participantRecord.dataStream });
              expect(participantRecordReply.status.code).to.equal(202);

              // Alice updates Bob's role record
              const participantUpdateRecord = await TestDataGenerator.generateFromRecordsWrite({
                author        : alice,
                existingWrite : participantRecord.recordsWrite,
              });
              const participantUpdateRecordReply =
                await dwn.processMessage(alice.did, participantUpdateRecord.message, { dataStream: participantUpdateRecord.dataStream });
              expect(participantUpdateRecordReply.status.code).to.equal(202);
            });

            it('can create the same role under different contexts', async () => {
              // scenario: Alice creates a thread and adds Bob to the 'thread/participant' role. Alice repeats the steps with a new thread.

              const alice = await TestDataGenerator.generateDidKeyPersona();
              const bob = await TestDataGenerator.generateDidKeyPersona();

              const protocolDefinition = threadRoleProtocolDefinition;

              const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
                author: alice,
                protocolDefinition
              });
              const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
              expect(protocolsConfigureReply.status.code).to.equal(202);

              // Alice creates the first thread
              const threadRecord1 = await TestDataGenerator.generateRecordsWrite({
                author       : alice,
                recipient    : bob.did,
                protocol     : protocolDefinition.protocol,
                protocolPath : 'thread'
              });
              const threadRecordReply1 = await dwn.processMessage(alice.did, threadRecord1.message, { dataStream: threadRecord1.dataStream });
              expect(threadRecordReply1.status.code).to.equal(202);

              // Alice adds Bob as a 'thread/participant' to the first thread
              const participantRecord1 = await TestDataGenerator.generateRecordsWrite({
                author          : alice,
                recipient       : bob.did,
                protocol        : protocolDefinition.protocol,
                protocolPath    : 'thread/participant',
                parentContextId : threadRecord1.message.contextId,
              });
              const participantRecordReply1 =
                await dwn.processMessage(alice.did, participantRecord1.message, { dataStream: participantRecord1.dataStream });
              expect(participantRecordReply1.status.code).to.equal(202);

              // Alice creates a second thread
              const threadRecord2 = await TestDataGenerator.generateRecordsWrite({
                author       : alice,
                recipient    : bob.did,
                protocol     : protocolDefinition.protocol,
                protocolPath : 'thread'
              });
              const threadRecordReply2 = await dwn.processMessage(alice.did, threadRecord2.message, { dataStream: threadRecord2.dataStream });
              expect(threadRecordReply2.status.code).to.equal(202);

              // Alice adds Bob as a 'thread/participant' to the second thread
              const participantRecord2 = await TestDataGenerator.generateRecordsWrite({
                author          : alice,
                recipient       : bob.did,
                protocol        : protocolDefinition.protocol,
                protocolPath    : 'thread/participant',
                parentContextId : threadRecord2.message.contextId,
              });
              const participantRecordReply2 =
                await dwn.processMessage(alice.did, participantRecord2.message, { dataStream: participantRecord2.dataStream });
              expect(participantRecordReply2.status.code).to.equal(202);
            });

            it('rejects writes to a $role record if there already exists one in the same context', async () => {
              // scenario: Alice creates a thread and adds Bob to the 'thread/participant' role. She adds Bob to the role second time and fails

              const alice = await TestDataGenerator.generateDidKeyPersona();
              const bob = await TestDataGenerator.generateDidKeyPersona();

              const protocolDefinition = threadRoleProtocolDefinition;

              const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
                author: alice,
                protocolDefinition
              });
              const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
              expect(protocolsConfigureReply.status.code).to.equal(202);

              // Alice creates the first thread
              const threadRecord = await TestDataGenerator.generateRecordsWrite({
                author       : alice,
                recipient    : bob.did,
                protocol     : protocolDefinition.protocol,
                protocolPath : 'thread'
              });
              const threadRecordReply = await dwn.processMessage(alice.did, threadRecord.message, { dataStream: threadRecord.dataStream });
              expect(threadRecordReply.status.code).to.equal(202);

              // Alice adds Bob as a 'thread/participant' to the thread
              const participantRecord1 = await TestDataGenerator.generateRecordsWrite({
                author          : alice,
                recipient       : bob.did,
                protocol        : protocolDefinition.protocol,
                protocolPath    : 'thread/participant',
                parentContextId : threadRecord.message.contextId,
              });
              const participantRecordReply1 =
                await dwn.processMessage(alice.did, participantRecord1.message, { dataStream: participantRecord1.dataStream });
              expect(participantRecordReply1.status.code).to.equal(202);

              // Alice adds Bob as a 'thread/participant' again to the same thread
              const participantRecord2 = await TestDataGenerator.generateRecordsWrite({
                author          : alice,
                recipient       : bob.did,
                protocol        : protocolDefinition.protocol,
                protocolPath    : 'thread/participant',
                parentContextId : threadRecord.message.contextId,
              });
              const participantRecordReply2 =
                await dwn.processMessage(alice.did, participantRecord2.message, { dataStream: participantRecord2.dataStream });
              expect(participantRecordReply2.status.code).to.equal(400);
              expect(participantRecordReply2.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationDuplicateRoleRecipient);
            });

            it('allows a new context role record to be created for the same recipient in the same context if their old one was deleted', async () => {
              // scenario: Alice creates a thread and adds Bob to the 'thread/participant' role. She deletes the role and then adds a new one.

              const alice = await TestDataGenerator.generateDidKeyPersona();
              const bob = await TestDataGenerator.generateDidKeyPersona();

              const protocolDefinition = threadRoleProtocolDefinition;

              const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
                author: alice,
                protocolDefinition
              });
              const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
              expect(protocolsConfigureReply.status.code).to.equal(202);

              // Alice creates the first thread
              const threadRecord = await TestDataGenerator.generateRecordsWrite({
                author       : alice,
                recipient    : bob.did,
                protocol     : protocolDefinition.protocol,
                protocolPath : 'thread'
              });
              const threadRecordReply = await dwn.processMessage(alice.did, threadRecord.message, { dataStream: threadRecord.dataStream });
              expect(threadRecordReply.status.code).to.equal(202);

              // Alice adds Bob as a 'thread/participant' to the thread
              const participantRecord1 = await TestDataGenerator.generateRecordsWrite({
                author          : alice,
                recipient       : bob.did,
                protocol        : protocolDefinition.protocol,
                protocolPath    : 'thread/participant',
                parentContextId : threadRecord.message.contextId,
              });
              const participantRecordReply1 =
                await dwn.processMessage(alice.did, participantRecord1.message, { dataStream: participantRecord1.dataStream });
              expect(participantRecordReply1.status.code).to.equal(202);

              // Alice deletes the participant record
              const participantDelete = await TestDataGenerator.generateRecordsDelete({
                author   : alice,
                recordId : participantRecord1.message.recordId,
              });
              const participantDeleteReply = await dwn.processMessage(alice.did, participantDelete.message);
              expect(participantDeleteReply.status.code).to.equal(202);

              // Alice creates a new 'thread/participant' record
              const participantRecord2 = await TestDataGenerator.generateRecordsWrite({
                author          : alice,
                recipient       : bob.did,
                protocol        : protocolDefinition.protocol,
                protocolPath    : 'thread/participant',
                parentContextId : threadRecord.message.contextId,
              });
              const participantRecordReply2 =
                await dwn.processMessage(alice.did, participantRecord2.message, { dataStream: participantRecord2.dataStream });
              expect(participantRecordReply2.status.code).to.equal(202);
            });
          });

          describe('role based writes', () => {
            it('uses a root-level role to authorize a write', async () => {
              // scenario: Alice gives Bob a friend role. Bob invokes his
              //           friend role in order to write a chat message

              const alice = await TestDataGenerator.generateDidKeyPersona();
              const bob = await TestDataGenerator.generateDidKeyPersona();

              const protocolDefinition = friendRoleProtocolDefinition;

              const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
                author: alice,
                protocolDefinition
              });
              const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
              expect(protocolsConfigureReply.status.code).to.equal(202);

              // Alice writes a 'friend' $root-level role record with Bob as recipient
              const friendRoleRecord = await TestDataGenerator.generateRecordsWrite({
                author       : alice,
                recipient    : bob.did,
                protocol     : protocolDefinition.protocol,
                protocolPath : 'friend',
                data         : new TextEncoder().encode('Bob is my friend'),
              });
              const friendRoleReply = await dwn.processMessage(alice.did, friendRoleRecord.message, { dataStream: friendRoleRecord.dataStream });
              expect(friendRoleReply.status.code).to.equal(202);

              // Bob writes a 'chat' record
              const chatRecord = await TestDataGenerator.generateRecordsWrite({
                author       : bob,
                recipient    : alice.did,
                protocol     : protocolDefinition.protocol,
                protocolPath : 'chat',
                data         : new TextEncoder().encode('Bob can write this cuz he is Alices friend'),
                protocolRole : 'friend'
              });
              const chatReply = await dwn.processMessage(alice.did, chatRecord.message, { dataStream: chatRecord.dataStream });
              expect(chatReply.status.code).to.equal(202);
            });

            it('uses a root-level role to authorize an update', async () => {
              // scenario: Alice gives Bob a admin role. Bob invokes his
              //           admin role in order to update a chat message that Alice wrote

              const alice = await TestDataGenerator.generateDidKeyPersona();
              const bob = await TestDataGenerator.generateDidKeyPersona();

              const protocolDefinition = friendRoleProtocolDefinition;

              const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
                author: alice,
                protocolDefinition
              });
              const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
              expect(protocolsConfigureReply.status.code).to.equal(202);

              // Alice writes a 'admin' root-level role record with Bob as recipient
              const friendRoleRecord = await TestDataGenerator.generateRecordsWrite({
                author       : alice,
                recipient    : bob.did,
                protocol     : protocolDefinition.protocol,
                protocolPath : 'admin',
                data         : new TextEncoder().encode('Bob is my friend'),
              });
              const friendRoleReply = await dwn.processMessage(alice.did, friendRoleRecord.message, { dataStream: friendRoleRecord.dataStream });
              expect(friendRoleReply.status.code).to.equal(202);

              // Alice creates a 'chat' record
              const chatRecord = await TestDataGenerator.generateRecordsWrite({
                author       : alice,
                recipient    : alice.did,
                protocol     : protocolDefinition.protocol,
                protocolPath : 'chat',
                data         : new TextEncoder().encode('Bob can write this cuz he is Alices friend'),
              });
              const chatReply = await dwn.processMessage(alice.did, chatRecord.message, { dataStream: chatRecord.dataStream });
              expect(chatReply.status.code).to.equal(202);

              // Bob invokes his admin role to update the 'chat' record
              const chatUpdateRecord = await TestDataGenerator.generateFromRecordsWrite({
                author        : bob,
                existingWrite : chatRecord.recordsWrite,
                protocolRole  : 'admin',
              });
              const chatUpdateReply = await dwn.processMessage(alice.did, chatUpdateRecord.message, { dataStream: chatUpdateRecord.dataStream });
              expect(chatUpdateReply.status.code).to.equal(202);
            });

            it('rejects root-level role authorized writes if the protocolRole is not a valid protocol path to an active role record', async () => {
              // scenario: Bob tries to invoke the 'chat' role to write to Alice's DWN, but 'chat' is not a role.

              const alice = await TestDataGenerator.generateDidKeyPersona();
              const bob = await TestDataGenerator.generateDidKeyPersona();

              const protocolDefinition = friendRoleProtocolDefinition;

              const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
                author: alice,
                protocolDefinition
              });
              const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
              expect(protocolsConfigureReply.status.code).to.equal(202);

              // Alice writes a 'chat' record with Bob as recipient
              const chatRecord = await TestDataGenerator.generateRecordsWrite({
                author       : alice,
                recipient    : bob.did,
                protocol     : protocolDefinition.protocol,
                protocolPath : 'chat',
                data         : new TextEncoder().encode('Blah blah blah'),
              });
              const chatReply = await dwn.processMessage(alice.did, chatRecord.message, { dataStream: chatRecord.dataStream });
              expect(chatReply.status.code).to.equal(202);

              // Bob tries to invoke a 'chat' role but 'chat' is not a role
              const writeChatRecord = await TestDataGenerator.generateRecordsWrite({
                author       : bob,
                recipient    : bob.did,
                protocol     : protocolDefinition.protocol,
                protocolPath : 'chat',
                data         : new TextEncoder().encode('Blah blah blah'),
                protocolRole : 'chat',
              });
              const chatReadReply = await dwn.processMessage(alice.did, writeChatRecord.message, { dataStream: writeChatRecord.dataStream });
              expect(chatReadReply.status.code).to.equal(401);
              expect(chatReadReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationNotARole);
            });

            it('rejects root-level role authorized writes if there is no active role for the recipient', async () => {
              // scenario: Bob tries to invoke a role to write, but he has not been given one.

              const alice = await TestDataGenerator.generateDidKeyPersona();
              const bob = await TestDataGenerator.generateDidKeyPersona();

              const protocolDefinition = friendRoleProtocolDefinition;

              const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
                author: alice,
                protocolDefinition
              });
              const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
              expect(protocolsConfigureReply.status.code).to.equal(202);

              // Bob writes a 'chat' record invoking a friend role that he does not have
              const chatRecord = await TestDataGenerator.generateRecordsWrite({
                author       : bob,
                recipient    : bob.did,
                protocol     : protocolDefinition.protocol,
                protocolPath : 'chat',
                data         : new TextEncoder().encode('Blah blah blah'),
                protocolRole : 'friend'
              });
              const chatReply = await dwn.processMessage(alice.did, chatRecord.message, { dataStream: chatRecord.dataStream });
              expect(chatReply.status.code).to.equal(401);
              expect(chatReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationMatchingRoleRecordNotFound);
            });

            it('uses a context role to authorize a write', async () => {
              // scenario: Alice creates a thread and adds Bob to the 'thread/participant' role. Bob invokes the record to write in the thread

              const alice = await TestDataGenerator.generateDidKeyPersona();
              const bob = await TestDataGenerator.generateDidKeyPersona();

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

              // Alice adds Bob as a 'thread/participant' in that thread
              const participantRecord = await TestDataGenerator.generateRecordsWrite({
                author          : alice,
                recipient       : bob.did,
                protocol        : protocolDefinition.protocol,
                protocolPath    : 'thread/participant',
                parentContextId : threadRecord.message.contextId,
              });
              const participantRecordReply =
                await dwn.processMessage(alice.did, participantRecord.message, { dataStream: participantRecord.dataStream });
              expect(participantRecordReply.status.code).to.equal(202);

              // Bob invokes the role to write to the thread
              const chatRecord = await TestDataGenerator.generateRecordsWrite({
                author          : bob,
                protocol        : protocolDefinition.protocol,
                protocolPath    : 'thread/chat',
                parentContextId : threadRecord.message.contextId,
                protocolRole    : 'thread/participant'
              });
              const chatRecordReply = await dwn.processMessage(alice.did, chatRecord.message, { dataStream: chatRecord.dataStream });
              expect(chatRecordReply.status.code).to.equal(202);
            });

            it('uses a context role to authorize an update', async () => {
              // scenario: Alice creates a thread and adds Bob to the 'thread/admin' role.
              //           Bob invokes the record to write in the thread

              const alice = await TestDataGenerator.generateDidKeyPersona();
              const bob = await TestDataGenerator.generateDidKeyPersona();

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

              // Alice adds Bob as a 'thread/participant' in that thread
              const participantRecord = await TestDataGenerator.generateRecordsWrite({
                author          : alice,
                recipient       : bob.did,
                protocol        : protocolDefinition.protocol,
                protocolPath    : 'thread/admin',
                parentContextId : threadRecord.message.contextId,
              });
              const participantRecordReply =
                await dwn.processMessage(alice.did, participantRecord.message, { dataStream: participantRecord.dataStream });
              expect(participantRecordReply.status.code).to.equal(202);

              // Alice writes a chat message in the thread
              const chatRecord = await TestDataGenerator.generateRecordsWrite({
                author          : alice,
                protocol        : protocolDefinition.protocol,
                protocolPath    : 'thread/chat',
                parentContextId : threadRecord.message.contextId,
              });
              const chatRecordReply = await dwn.processMessage(alice.did, chatRecord.message, { dataStream: chatRecord.dataStream });
              expect(chatRecordReply.status.code).to.equal(202);

              // Bob invokes his admin role to update the chat message
              const chatUpdateRecord = await TestDataGenerator.generateFromRecordsWrite({
                author        : bob,
                existingWrite : chatRecord.recordsWrite,
                protocolRole  : 'thread/admin',
              });
              const chatUpdateRecordReply =
                await dwn.processMessage(alice.did, chatUpdateRecord.message, { dataStream: chatUpdateRecord.dataStream });
              expect(chatUpdateRecordReply.status.code).to.equal(202);
            });

            it('rejects context role authorized writes if the protocolRole is not a valid protocol path to an active role record', async () => {
              // scenario: Alice creates a thread and adds Bob as a participant. ALice creates another thread. Bob tries and fails to invoke his
              //           contextRole to write a chat in the second thread

              const alice = await TestDataGenerator.generateDidKeyPersona();
              const bob = await TestDataGenerator.generateDidKeyPersona();

              const protocolDefinition = threadRoleProtocolDefinition;

              const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
                author: alice,
                protocolDefinition
              });
              const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
              expect(protocolsConfigureReply.status.code).to.equal(202);

              // Alice creates a thread
              const threadRecord1 = await TestDataGenerator.generateRecordsWrite({
                author       : alice,
                recipient    : bob.did,
                protocol     : protocolDefinition.protocol,
                protocolPath : 'thread'
              });
              const threadRecordReply1 = await dwn.processMessage(alice.did, threadRecord1.message, { dataStream: threadRecord1.dataStream });
              expect(threadRecordReply1.status.code).to.equal(202);

              // Alice adds Bob as a 'thread/participant' in that thread
              const participantRecord = await TestDataGenerator.generateRecordsWrite({
                author          : alice,
                recipient       : bob.did,
                protocol        : protocolDefinition.protocol,
                protocolPath    : 'thread/participant',
                parentContextId : threadRecord1.message.contextId,
              });
              const participantRecordReply =
                await dwn.processMessage(alice.did, participantRecord.message, { dataStream: participantRecord.dataStream });
              expect(participantRecordReply.status.code).to.equal(202);

              // Alice creates a second thread
              const threadRecord2 = await TestDataGenerator.generateRecordsWrite({
                author       : alice,
                recipient    : bob.did,
                protocol     : protocolDefinition.protocol,
                protocolPath : 'thread'
              });
              const threadRecordReply2 = await dwn.processMessage(alice.did, threadRecord2.message, { dataStream: threadRecord2.dataStream });
              expect(threadRecordReply2.status.code).to.equal(202);

              // Bob invokes his role to try to write to the second thread
              const chatRecord = await TestDataGenerator.generateRecordsWrite({
                author          : bob,
                protocol        : protocolDefinition.protocol,
                protocolPath    : 'thread/chat',
                parentContextId : threadRecord2.message.contextId,
                protocolRole    : 'thread/participant'
              });
              const chatRecordReply = await dwn.processMessage(alice.did, chatRecord.message, { dataStream: chatRecord.dataStream });
              expect(chatRecordReply.status.code).to.equal(401);
              expect(chatRecordReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationMatchingRoleRecordNotFound);
            });

            it('rejects attempts to invoke an invalid path as a protocolRole', async () => {
              // scenario: Bob tries to invoke 'notARealPath' as a protocolRole and fails

              const alice = await TestDataGenerator.generateDidKeyPersona();
              const bob = await TestDataGenerator.generateDidKeyPersona();

              const protocolDefinition = threadRoleProtocolDefinition;

              const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
                author: alice,
                protocolDefinition
              });
              const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
              expect(protocolsConfigureReply.status.code).to.equal(202);

              // Bob invokes a fake protocolRole to write
              const fakeRoleInvocation = await TestDataGenerator.generateRecordsWrite({
                author       : bob,
                recipient    : alice.did,
                protocol     : protocolDefinition.protocol,
                protocolPath : 'thread',
                protocolRole : 'notARealPath',
              });
              const fakeRoleInvocationReply =
                await dwn.processMessage(alice.did, fakeRoleInvocation.message, { dataStream: fakeRoleInvocation.dataStream });
              expect(fakeRoleInvocationReply.status.code).to.equal(401);
              expect(fakeRoleInvocationReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationNotARole);
            });
          });
        });

        it('should allow updating records by the initial author', async () => {
        // scenario: Bob writes into Alice's DWN given Alice's "message" protocol allow-anyone rule, then modifies the message

          // write a protocol definition with an allow-anyone rule
          const protocolDefinition = messageProtocolDefinition;
          const protocol = protocolDefinition.protocol;
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

          // generate a `RecordsWrite` message from bob
          const bobData = new TextEncoder().encode('message from bob');
          const messageFromBob = await TestDataGenerator.generateRecordsWrite(
            {
              author       : bob,
              protocol,
              protocolPath : 'message', // this comes from `types` in protocol definition
              schema       : protocolDefinition.types.message.schema,
              dataFormat   : protocolDefinition.types.message.dataFormats[0],
              data         : bobData
            }
          );

          const bobWriteReply = await dwn.processMessage(alice.did, messageFromBob.message, { dataStream: messageFromBob.dataStream });
          expect(bobWriteReply.status.code).to.equal(202);

          // verify bob's message got written to the DB
          const messageDataForQueryingBobsWrite = await TestDataGenerator.generateRecordsQuery({
            author : alice,
            filter : { recordId: messageFromBob.message.recordId }
          });
          const bobRecordsQueryReply = await dwn.processMessage(alice.did, messageDataForQueryingBobsWrite.message);
          expect(bobRecordsQueryReply.status.code).to.equal(200);
          expect(bobRecordsQueryReply.entries?.length).to.equal(1);
          expect(bobRecordsQueryReply.entries![0].encodedData).to.equal(base64url.baseEncode(bobData));

          // generate a new message from bob updating the existing message
          const updatedMessageBytes = Encoder.stringToBytes('updated message from bob');
          const updatedMessageFromBob = await TestDataGenerator.generateFromRecordsWrite({
            author        : bob,
            existingWrite : messageFromBob.recordsWrite,
            data          : updatedMessageBytes
          });

          const newWriteReply = await dwn.processMessage(alice.did, updatedMessageFromBob.message, { dataStream: updatedMessageFromBob.dataStream });
          expect(newWriteReply.status.code).to.equal(202);

          // verify bob's message got written to the DB
          const newRecordQueryReply = await dwn.processMessage(alice.did, messageDataForQueryingBobsWrite.message);
          expect(newRecordQueryReply.status.code).to.equal(200);
          expect(newRecordQueryReply.entries?.length).to.equal(1);
          expect(newRecordQueryReply.entries![0].encodedData).to.equal(Encoder.bytesToBase64Url(updatedMessageBytes));
        });

        it('should disallow overwriting existing records by a different author if author is not authorized to `update`', async () => {
          // scenario: Bob writes into Alice's DWN given Alice's "message" protocol, Carol then attempts to modify the existing message

          // write a protocol definition with an allow-anyone rule
          const protocolDefinition = messageProtocolDefinition;
          const protocol = protocolDefinition.protocol;
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

          // generate a `RecordsWrite` message from bob
          const bobData = new TextEncoder().encode('data from bob');
          const messageFromBob = await TestDataGenerator.generateRecordsWrite(
            {
              author       : bob,
              protocol,
              protocolPath : 'message', // this comes from `types` in protocol definition
              schema       : protocolDefinition.types.message.schema,
              dataFormat   : protocolDefinition.types.message.dataFormats[0],
              data         : bobData
            }
          );

          const bobWriteReply = await dwn.processMessage(alice.did, messageFromBob.message, { dataStream: messageFromBob.dataStream });
          expect(bobWriteReply.status.code).to.equal(202);

          // verify bob's message got written to the DB
          const messageDataForQueryingBobsWrite = await TestDataGenerator.generateRecordsQuery({
            author : alice,
            filter : { recordId: messageFromBob.message.recordId }
          });
          const bobRecordsQueryReply = await dwn.processMessage(alice.did, messageDataForQueryingBobsWrite.message);
          expect(bobRecordsQueryReply.status.code).to.equal(200);
          expect(bobRecordsQueryReply.entries?.length).to.equal(1);
          expect(bobRecordsQueryReply.entries![0].encodedData).to.equal(base64url.baseEncode(bobData));

          // generate a new message from carol updating the existing message, which should not be allowed/accepted
          const modifiedMessageData = new TextEncoder().encode('modified message by carol');
          const modifiedMessageFromCarol = await TestDataGenerator.generateRecordsWrite(
            {
              author       : carol,
              protocol,
              protocolPath : 'message', // this comes from `types` in protocol definition
              schema       : protocolDefinition.types.message.schema,
              dataFormat   : protocolDefinition.types.message.dataFormats[0],
              data         : modifiedMessageData,
              recordId     : messageFromBob.message.recordId,
            }
          );

          const carolWriteReply =
            await dwn.processMessage(alice.did, modifiedMessageFromCarol.message, { dataStream: modifiedMessageFromCarol.dataStream });
          expect(carolWriteReply.status.code).to.equal(401);
          expect(carolWriteReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationActionNotAllowed);
        });

        it('should not allow to change immutable recipient', async () => {
        // scenario: Bob writes into Alice's DWN given Alice's "message" protocol allow-anyone rule, then tries to modify immutable recipient

          // NOTE: no need to test the same for parent, protocol, and contextId
          // because changing them will result in other error conditions

          // write a protocol definition with an allow-anyone rule
          const protocolDefinition = messageProtocolDefinition;
          const protocol = protocolDefinition.protocol;
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

          // generate a `RecordsWrite` message from bob
          const bobData = new TextEncoder().encode('message from bob');
          const messageFromBob = await TestDataGenerator.generateRecordsWrite(
            {
              author       : bob,
              protocol,
              protocolPath : 'message', // this comes from `types` in protocol definition
              schema       : protocolDefinition.types.message.schema,
              dataFormat   : protocolDefinition.types.message.dataFormats[0],
              data         : bobData
            }
          );

          const bobWriteReply = await dwn.processMessage(alice.did, messageFromBob.message, { dataStream: messageFromBob.dataStream });
          expect(bobWriteReply.status.code).to.equal(202);

          // verify bob's message got written to the DB
          const messageDataForQueryingBobsWrite = await TestDataGenerator.generateRecordsQuery({
            author : alice,
            filter : { recordId: messageFromBob.message.recordId }
          });
          const bobRecordsQueryReply = await dwn.processMessage(alice.did, messageDataForQueryingBobsWrite.message);
          expect(bobRecordsQueryReply.status.code).to.equal(200);
          expect(bobRecordsQueryReply.entries?.length).to.equal(1);
          expect(bobRecordsQueryReply.entries![0].encodedData).to.equal(base64url.baseEncode(bobData));

          // generate a new message from bob changing immutable recipient
          const updatedMessageFromBob = await TestDataGenerator.generateRecordsWrite(
            {
              author       : bob,
              dateCreated  : messageFromBob.message.descriptor.dateCreated,
              protocol,
              protocolPath : 'message', // this comes from `types` in protocol definition
              schema       : protocolDefinition.types.message.schema,
              dataFormat   : protocolDefinition.types.message.dataFormats[0],
              data         : bobData,
              recordId     : messageFromBob.message.recordId,
              recipient    : bob.did // this immutable property was Alice's DID initially
            }
          );

          const newWriteReply = await dwn.processMessage(alice.did, updatedMessageFromBob.message, { dataStream: updatedMessageFromBob.dataStream });
          expect(newWriteReply.status.code).to.equal(400);
          expect(newWriteReply.status.detail).to.contain('recipient is an immutable property');
        });

        it('should block unauthorized write with recipient rule', async () => {
        // scenario: fake VC issuer attempts write into Alice's DWN a credential response
        // upon learning the ID of Alice's credential application to actual issuer

          const protocolDefinition = credentialIssuanceProtocolDefinition;
          const protocol = protocolDefinition.protocol;
          const credentialApplicationSchema = protocolDefinition.types.credentialApplication.schema;
          const credentialResponseSchema = protocolDefinition.types.credentialResponse.schema;

          const alice = await TestDataGenerator.generatePersona();
          const fakeVcIssuer = await TestDataGenerator.generatePersona();

          const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition
          });

          // setting up a stub DID resolver
          TestStubGenerator.stubDidResolver(didResolver, [alice, fakeVcIssuer]);

          const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
          expect(protocolsConfigureReply.status.code).to.equal(202);

          // write a credential application to Alice's DWN to simulate that she has sent a credential application to a VC issuer
          const vcIssuer = await TestDataGenerator.generatePersona();
          const encodedCredentialApplication = new TextEncoder().encode('credential application data');
          const credentialApplication = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            recipient    : vcIssuer.did,
            protocol,
            protocolPath : 'credentialApplication', // this comes from `types` in protocol definition
            schema       : credentialApplicationSchema,
            dataFormat   : protocolDefinition.types.credentialApplication.dataFormats[0],
            data         : encodedCredentialApplication
          });
          const credentialApplicationContextId = await credentialApplication.recordsWrite.getEntryId();

          const credentialApplicationReply =
            await dwn.processMessage(alice.did, credentialApplication.message, { dataStream: credentialApplication.dataStream });
          expect(credentialApplicationReply.status.code).to.equal(202);

          // generate a credential application response message from a fake VC issuer
          const encodedCredentialResponse = new TextEncoder().encode('credential response data');
          const credentialResponse = await TestDataGenerator.generateRecordsWrite(
            {
              author          : fakeVcIssuer,
              recipient       : alice.did,
              protocol,
              protocolPath    : 'credentialApplication/credentialResponse', // this comes from `types` in protocol definition
              parentContextId : credentialApplicationContextId,
              schema          : credentialResponseSchema,
              dataFormat      : protocolDefinition.types.credentialResponse.dataFormats[0],
              data            : encodedCredentialResponse
            }
          );

          const credentialResponseReply =
            await dwn.processMessage(alice.did, credentialResponse.message, { dataStream: credentialResponse.dataStream });
          expect(credentialResponseReply.status.code).to.equal(401);
          expect(credentialResponseReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationActionNotAllowed);
        });

        it('should fail authorization if protocol definition cannot be found for a protocol-based RecordsWrite', async () => {
          const alice = await TestDataGenerator.generateDidKeyPersona();
          const protocol = 'nonExistentProtocol';
          const data = Encoder.stringToBytes('any data');
          const credentialApplication = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            recipient    : alice.did,
            protocol,
            protocolPath : 'credentialApplication/credentialResponse', // this comes from `types` in protocol definition
            data
          });

          const reply = await dwn.processMessage(alice.did, credentialApplication.message, { dataStream: credentialApplication.dataStream });
          expect(reply.status.code).to.equal(400);
          expect(reply.status.detail).to.contain('unable to find protocol definition');
        });

        it('should fail authorization if record schema is incorrect for a protocol-based RecordsWrite', async () => {
          const alice = await TestDataGenerator.generateDidKeyPersona();

          const protocolDefinition = credentialIssuanceProtocolDefinition;
          const protocol = protocolDefinition.protocol;
          const protocolConfig = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition
          });

          const protocolConfigureReply = await dwn.processMessage(alice.did, protocolConfig.message);
          expect(protocolConfigureReply.status.code).to.equal(202);

          const data = Encoder.stringToBytes('any data');
          const credentialApplication = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            recipient    : alice.did,
            protocol,
            protocolPath : 'credentialApplication', // this comes from `types` in protocol definition
            schema       : 'unexpectedSchema',
            data
          });

          const reply = await dwn.processMessage(alice.did, credentialApplication.message, { dataStream: credentialApplication.dataStream });
          expect(reply.status.code).to.equal(400);
          expect(reply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationInvalidSchema);
        });

        it('should fail authorization if given `protocolPath` contains an invalid record type', async () => {
          const alice = await TestDataGenerator.generateDidKeyPersona();

          const protocolDefinition = credentialIssuanceProtocolDefinition;
          const protocol = protocolDefinition.protocol;
          const protocolConfig = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition
          });

          const protocolConfigureReply = await dwn.processMessage(alice.did, protocolConfig.message);
          expect(protocolConfigureReply.status.code).to.equal(202);


          const data = Encoder.stringToBytes('any data');
          const credentialApplication = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            recipient    : alice.did,
            protocol,
            protocolPath : 'invalidType',
            data
          });

          const reply = await dwn.processMessage(alice.did, credentialApplication.message, { dataStream: credentialApplication.dataStream });
          expect(reply.status.code).to.equal(400);
          expect(reply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationInvalidType);
        });

        it('should fail authorization if given `protocolPath` is mismatching with actual path', async () => {
          const alice = await TestDataGenerator.generateDidKeyPersona();

          const protocolDefinition = credentialIssuanceProtocolDefinition;
          const protocol = protocolDefinition.protocol;
          const protocolConfig = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition,
          });

          const protocolConfigureReply = await dwn.processMessage(alice.did, protocolConfig.message);
          expect(protocolConfigureReply.status.code).to.equal(202);

          const data = Encoder.stringToBytes('any data');
          const credentialApplication = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            recipient    : alice.did,
            protocol,
            protocolPath : 'credentialApplication/credentialResponse', // incorrect path. correct path is `credentialResponse` because this record has no parent
            schema       : protocolDefinition.types.credentialResponse.schema,
            data
          });

          const reply = await dwn.processMessage(alice.did, credentialApplication.message, { dataStream: credentialApplication.dataStream });
          expect(reply.status.code).to.equal(400);
          expect(reply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationParentlessIncorrectProtocolPath);
        });

        it('#690 - should only allow data format of a protocol-space record to be updated to any value allowed by the protocol configuration', async () => {
          const alice = await TestDataGenerator.generateDidKeyPersona();

          const protocolDefinition = socialMediaProtocolDefinition;
          const protocol = protocolDefinition.protocol;

          const protocolConfig = await TestDataGenerator.generateProtocolsConfigure({
            author             : alice,
            protocolDefinition : protocolDefinition,
          });

          const protocolConfigureReply = await dwn.processMessage(alice.did, protocolConfig.message);
          expect(protocolConfigureReply.status.code).to.equal(202);

          // write image record
          const data = TestDataGenerator.randomBytes(100);
          const imageRecordsWrite = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            recipient    : alice.did,
            protocol,
            protocolPath : 'image',
            schema       : protocolDefinition.types.image.schema,
            dataFormat   : protocolDefinition.types.image.dataFormats[0],
            data
          });
          const writeReply = await dwn.processMessage(alice.did, imageRecordsWrite.message, { dataStream: imageRecordsWrite.dataStream });
          expect(writeReply.status.code).to.equal(202);

          // update the image to a not-allowed data format
          const newDataBytes = TestDataGenerator.randomBytes(100);
          const notAllowedUpdateWrite = await RecordsWrite.createFrom({
            recordsWriteMessage : imageRecordsWrite.message,
            dataFormat          : `not-allowed-data-format`,
            signer              : Jws.createSigner(alice),
            data                : newDataBytes
          });

          const newDataStream = DataStream.fromBytes(newDataBytes);
          const notAllowedUpdateWriteReply = await dwn.processMessage(alice.did, notAllowedUpdateWrite.message, { dataStream: newDataStream });
          expect(notAllowedUpdateWriteReply.status.code).to.equal(400);
          expect(notAllowedUpdateWriteReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationIncorrectDataFormat);


          // update the image to a different allowed dataFormat
          const updateWrite = await RecordsWrite.createFrom({
            recordsWriteMessage : imageRecordsWrite.message,
            dataFormat          : protocolDefinition.types.image.dataFormats[1],
            signer              : Jws.createSigner(alice),
            data                : newDataBytes
          });

          const updateReply = await dwn.processMessage(alice.did, updateWrite.message, { dataStream: newDataStream });
          expect(updateReply.status.code).to.equal(202);

          // verify the data format of the record is updated
          const recordsRead = await RecordsRead.create({
            filter : { recordId: imageRecordsWrite.message.recordId },
            signer : Jws.createSigner(alice),
          });
          const recordsReadReply = await dwn.processMessage(alice.did, recordsRead.message);
          expect(recordsReadReply.status.code).to.equal(200);
          expect(recordsReadReply.record?.descriptor.dataFormat).to.equal(protocolDefinition.types.image.dataFormats[1]);
        });

        it('#690 - should allow any data format for a record if protocol definition does not explicitly specify the list of allowed data formats', async () => {
          const alice = await TestDataGenerator.generateDidKeyPersona();

          const protocolDefinition = minimalProtocolDefinition;
          const protocol = protocolDefinition.protocol;

          const protocolConfig = await TestDataGenerator.generateProtocolsConfigure({
            author             : alice,
            protocolDefinition : protocolDefinition,
          });

          const protocolConfigureReply = await dwn.processMessage(alice.did, protocolConfig.message);
          expect(protocolConfigureReply.status.code).to.equal(202);

          // write image record
          const data = TestDataGenerator.randomBytes(100);
          const imageRecordsWrite = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            recipient    : alice.did,
            protocol,
            protocolPath : 'foo',
            schema       : 'any-schema',
            dataFormat   : 'any-data-format',
            data
          });
          const writeReply = await dwn.processMessage(alice.did, imageRecordsWrite.message, { dataStream: imageRecordsWrite.dataStream });
          expect(writeReply.status.code).to.equal(202);

          // update the image to a different data format
          const newDataFormat = 'any-new-data-format';
          const newDataBytes = TestDataGenerator.randomBytes(100);
          const updateWrite = await RecordsWrite.createFrom({
            recordsWriteMessage : imageRecordsWrite.message,
            dataFormat          : newDataFormat,
            signer              : Jws.createSigner(alice),
            data                : newDataBytes
          });

          const newDataStream = DataStream.fromBytes(newDataBytes);
          const updateReply = await dwn.processMessage(alice.did, updateWrite.message, { dataStream: newDataStream });
          expect(updateReply.status.code).to.equal(202);

          // verify the data format of the record is updated
          const recordsRead = await RecordsRead.create({
            filter : { recordId: imageRecordsWrite.message.recordId },
            signer : Jws.createSigner(alice),
          });
          const recordsReadReply = await dwn.processMessage(alice.did, recordsRead.message);
          expect(recordsReadReply.status.code).to.equal(200);
          expect(recordsReadReply.record?.descriptor.dataFormat).to.equal(newDataFormat);
        });

        it('should fail authorization if record schema is not allowed at the hierarchical level attempted for the RecordsWrite', async () => {
        // scenario: Attempt writing of records at 3 levels in the hierarchy to cover all possible cases of missing rule sets
          const alice = await TestDataGenerator.generateDidKeyPersona();

          const protocolDefinition = credentialIssuanceProtocolDefinition;
          const protocol = protocolDefinition.protocol;
          const protocolConfig = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition
          });
          const credentialApplicationSchema = protocolDefinition.types.credentialApplication.schema;
          const credentialResponseSchema = protocolDefinition.types.credentialResponse.schema;

          const protocolConfigureReply = await dwn.processMessage(alice.did, protocolConfig.message);
          expect(protocolConfigureReply.status.code).to.equal(202);

          // Try and fail to write a 'credentialResponse', which is not allowed at the top level of the record hierarchy
          const data = Encoder.stringToBytes('any data');
          const failedCredentialResponse = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            recipient    : alice.did,
            protocol,
            protocolPath : 'credentialResponse',
            schema       : credentialResponseSchema, // this is a known schema type, but not allowed for a protocol root record
            data
          });
          const failedCredentialResponseReply =
            await dwn.processMessage(alice.did, failedCredentialResponse.message, { dataStream: failedCredentialResponse.dataStream });
          expect(failedCredentialResponseReply.status.code).to.equal(400);
          expect(failedCredentialResponseReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationMissingRuleSet);

          // Successfully write a 'credentialApplication' at the top level of the of the record hierarchy
          const credentialApplication = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            recipient    : alice.did,
            protocol,
            protocolPath : 'credentialApplication', // allowed at root level
            schema       : credentialApplicationSchema,
            data
          });
          const credentialApplicationReply = await dwn.processMessage(
            alice.did, credentialApplication.message, { dataStream: credentialApplication.dataStream });
          expect(credentialApplicationReply.status.code).to.equal(202);

          // Try and fail to write another 'credentialApplication' below the first 'credentialApplication'
          const failedCredentialApplication = await TestDataGenerator.generateRecordsWrite({
            author          : alice,
            recipient       : alice.did,
            protocol,
            protocolPath    : 'credentialApplication/credentialApplication', // credentialApplications may not be nested below another credentialApplication
            schema          : credentialApplicationSchema,
            parentContextId : credentialApplication.message.contextId,
            data
          });
          const failedCredentialApplicationReply2 =
            await dwn.processMessage(alice.did, failedCredentialApplication.message, { dataStream: failedCredentialApplication.dataStream });
          expect(failedCredentialApplicationReply2.status.code).to.equal(400);
          expect(failedCredentialApplicationReply2.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationMissingRuleSet);

          // Successfully write a 'credentialResponse' below the 'credentialApplication'
          const credentialResponse = await TestDataGenerator.generateRecordsWrite({
            author          : alice,
            recipient       : alice.did,
            protocol,
            protocolPath    : 'credentialApplication/credentialResponse',
            schema          : credentialResponseSchema,
            parentContextId : credentialApplication.message.contextId,
            data
          });
          const credentialResponseReply =
            await dwn.processMessage(alice.did, credentialResponse.message, { dataStream: credentialResponse.dataStream });
          expect(credentialResponseReply.status.code).to.equal(202);

          // Try and fail to write a 'credentialApplication' below 'credentialApplication/credentialResponse'
          // Testing case where there is no rule set for any record type at the given level in the hierarchy
          const nestedCredentialApplication = await TestDataGenerator.generateRecordsWrite({
            author          : alice,
            recipient       : alice.did,
            protocol,
            protocolPath    : 'credentialApplication/credentialResponse/credentialApplication',
            schema          : credentialApplicationSchema,
            parentContextId : credentialResponse.message.contextId,
            data
          });
          const nestedCredentialApplicationReply =
            await dwn.processMessage(alice.did, nestedCredentialApplication.message, { dataStream: nestedCredentialApplication.dataStream });
          expect(nestedCredentialApplicationReply.status.code).to.equal(400);
          expect(nestedCredentialApplicationReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationMissingRuleSet);
        });

        it('should only allow DWN owner to write if record does not have an action rule defined', async () => {
          const alice = await TestDataGenerator.generateDidKeyPersona();

          // write a protocol definition without an explicit action rule
          const protocolDefinition = privateProtocol;
          const protocol = protocolDefinition.protocol;
          const protocolConfig = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition
          });

          const protocolConfigureReply = await dwn.processMessage(alice.did, protocolConfig.message);
          expect(protocolConfigureReply.status.code).to.equal(202);

          // test that Alice is allowed to write to her own DWN
          const data = Encoder.stringToBytes('any data');
          const aliceWriteMessageData = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            recipient    : alice.did,
            protocol,
            protocolPath : 'privateNote', // this comes from `types`
            schema       : protocolDefinition.types.privateNote.schema,
            dataFormat   : protocolDefinition.types.privateNote.dataFormats[0],
            data
          });

          let reply = await dwn.processMessage(alice.did, aliceWriteMessageData.message, { dataStream: aliceWriteMessageData.dataStream });
          expect(reply.status.code).to.equal(202);

          // test that Bob is not allowed to write to Alice's DWN
          const bob = await TestDataGenerator.generateDidKeyPersona();
          const bobWriteMessageData = await TestDataGenerator.generateRecordsWrite({
            author       : bob,
            recipient    : alice.did,
            protocol,
            protocolPath : 'privateNote', // this comes from `types`
            schema       : 'private-note',
            dataFormat   : protocolDefinition.types.privateNote.dataFormats[0],
            data
          });

          reply = await dwn.processMessage(alice.did, bobWriteMessageData.message, { dataStream: bobWriteMessageData.dataStream });
          expect(reply.status.code).to.equal(401);
          expect(reply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationActionRulesNotFound);
        });

        it('should look up recipient path with ancestor depth of 2+ (excluding self) in action rule correctly', async () => {
          // simulate a DEX protocol with at least 3 layers of message exchange: ask -> offer -> fulfillment
          // make sure recipient of offer can send fulfillment

          const alice = await TestDataGenerator.generateDidKeyPersona();
          const pfi = await TestDataGenerator.generateDidKeyPersona();

          // write a DEX protocol definition
          const protocolDefinition = dexProtocolDefinition;
          const protocol = protocolDefinition.protocol;

          // write the DEX protocol in the PFI
          const protocolConfig = await TestDataGenerator.generateProtocolsConfigure({
            author             : pfi,
            protocolDefinition : protocolDefinition
          });

          const protocolConfigureReply = await dwn.processMessage(pfi.did, protocolConfig.message);
          expect(protocolConfigureReply.status.code).to.equal(202);

          // simulate Alice's ask and PFI's offer already occurred
          const data = Encoder.stringToBytes('irrelevant');
          const askMessageData = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            recipient    : pfi.did,
            schema       : protocolDefinition.types.ask.schema,
            protocol,
            protocolPath : 'ask',
            data
          });

          let reply = await dwn.processMessage(pfi.did, askMessageData.message, { dataStream: askMessageData.dataStream });
          expect(reply.status.code).to.equal(202);

          const offerMessageData = await TestDataGenerator.generateRecordsWrite({
            author          : pfi,
            recipient       : alice.did,
            schema          : protocolDefinition.types.offer.schema,
            parentContextId : askMessageData.message.contextId,
            protocol,
            protocolPath    : 'ask/offer',
            data
          });

          reply = await dwn.processMessage(pfi.did, offerMessageData.message, { dataStream: offerMessageData.dataStream });
          expect(reply.status.code).to.equal(202);

          // the actual test: making sure fulfillment message is accepted
          const fulfillmentMessageData = await TestDataGenerator.generateRecordsWrite({
            author          : alice,
            recipient       : pfi.did,
            schema          : protocolDefinition.types.fulfillment.schema,
            parentContextId : offerMessageData.message.contextId,
            protocol,
            protocolPath    : 'ask/offer/fulfillment',
            data
          });
          reply = await dwn.processMessage(pfi.did, fulfillmentMessageData.message, { dataStream: fulfillmentMessageData.dataStream });
          expect(reply.status.code).to.equal(202);

          // verify the fulfillment message is stored
          const recordsQueryMessageData = await TestDataGenerator.generateRecordsQuery({
            author : pfi,
            filter : { recordId: fulfillmentMessageData.message.recordId }
          });

          // verify the data is written
          const recordsQueryReply = await dwn.processMessage(
            pfi.did, recordsQueryMessageData.message);
          expect(recordsQueryReply.status.code).to.equal(200);
          expect(recordsQueryReply.entries?.length).to.equal(1);
          expect(recordsQueryReply.entries![0].descriptor.dataCid).to.equal(fulfillmentMessageData.message.descriptor.dataCid);
        });

        it('should fail authorization if incoming message contains `parentId` that leads to no record', async () => {
          // 1. DEX protocol with at least 3 layers of message exchange: ask -> offer -> fulfillment
          // 2. Alice sends an ask to a PFI
          // 3. Alice sends a fulfillment to an non-existent offer to the PFI

          const alice = await TestDataGenerator.generateDidKeyPersona();
          const pfi = await TestDataGenerator.generateDidKeyPersona();

          // write a DEX protocol definition
          const protocolDefinition = dexProtocolDefinition;
          const protocol = protocolDefinition.protocol;

          // write the DEX protocol in the PFI
          const protocolConfig = await TestDataGenerator.generateProtocolsConfigure({
            author             : pfi,
            protocolDefinition : protocolDefinition
          });

          const protocolConfigureReply = await dwn.processMessage(pfi.did, protocolConfig.message);
          expect(protocolConfigureReply.status.code).to.equal(202);

          // simulate Alice's ask
          const data = Encoder.stringToBytes('irrelevant');
          const askMessageData = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            recipient    : pfi.did,
            schema       : protocolDefinition.types.ask.schema,
            protocol,
            protocolPath : 'ask',
            data
          });

          let reply = await dwn.processMessage(pfi.did, askMessageData.message, { dataStream: askMessageData.dataStream });
          expect(reply.status.code).to.equal(202);

          // the actual test: making sure fulfillment message fails
          const fulfillmentMessageData = await TestDataGenerator.generateRecordsWrite({
            author          : alice,
            recipient       : pfi.did,
            schema          : protocolDefinition.types.fulfillment.schema,
            parentContextId : 'nonExistentId', // NOTE: this will point to a non-existent parent
            protocolPath    : 'ask/offer/fulfillment',
            protocol,
            data
          });

          reply = await dwn.processMessage(pfi.did, fulfillmentMessageData.message, { dataStream: fulfillmentMessageData.dataStream });
          expect(reply.status.code).to.equal(400);
          expect(reply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationIncorrectProtocolPath);
        });

        it('should 400 if expected CID of `encryption` mismatches the `encryptionCid` in `authorization`', async () => {
          const alice = await TestDataGenerator.generatePersona();
          TestStubGenerator.stubDidResolver(didResolver, [alice]);

          // configure protocol
          const protocolDefinition = emailProtocolDefinition as ProtocolDefinition;
          const protocol = protocolDefinition.protocol;
          const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition
          });

          const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
          expect(protocolsConfigureReply.status.code).to.equal(202);

          const bobMessageBytes = Encoder.stringToBytes('message from bob');
          const bobMessageStream = DataStream.fromBytes(bobMessageBytes);
          const dataEncryptionInitializationVector = TestDataGenerator.randomBytes(16);
          const dataEncryptionKey = TestDataGenerator.randomBytes(32);
          const bobMessageEncryptedStream = await Encryption.aes256CtrEncrypt(
            dataEncryptionKey, dataEncryptionInitializationVector, bobMessageStream
          );
          const bobMessageEncryptedBytes = await DataStream.toBytes(bobMessageEncryptedStream);

          const encryptionInput: EncryptionInput = {
            algorithm            : EncryptionAlgorithm.Aes256Ctr,
            initializationVector : dataEncryptionInitializationVector,
            key                  : dataEncryptionKey,
            keyEncryptionInputs  : [{
              publicKeyId      : alice.keyId, // reusing signing key for encryption purely as a convenience
              publicKey        : alice.keyPair.publicJwk,
              algorithm        : EncryptionAlgorithm.EciesSecp256k1,
              derivationScheme : KeyDerivationScheme.ProtocolPath
            }]
          };
          const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            protocol,
            protocolPath : 'email',
            schema       : 'email',
            data         : bobMessageEncryptedBytes,
            encryptionInput
          });

        // replace valid `encryption` property with a mismatching one
        message.encryption!.initializationVector = Encoder.stringToBase64Url('any value which will result in a different CID');

        const recordsWriteHandler = new RecordsWriteHandler(didResolver, messageStore, dataStore, eventLog, eventStream);
        const writeReply = await recordsWriteHandler.handle({ tenant: alice.did, message, dataStream: dataStream! });

        expect(writeReply.status.code).to.equal(400);
        expect(writeReply.status.detail).to.contain(DwnErrorCode.RecordsWriteValidateIntegrityEncryptionCidMismatch);
        });

        it('should return 400 if protocol is not normalized', async () => {
          const alice = await TestDataGenerator.generateDidKeyPersona();

          const protocolDefinition = emailProtocolDefinition;

          // write a message into DB
          const recordsWrite = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            data         : new TextEncoder().encode('data1'),
            protocol     : 'example.com/',
            protocolPath : 'email', // from email protocol
            schema       : protocolDefinition.types.email.schema
          });

          // overwrite protocol because #create auto-normalizes protocol
          recordsWrite.message.descriptor.protocol = 'example.com/';

          // Re-create auth because we altered the descriptor after signing
          const descriptorCid = await Cid.computeCid(recordsWrite.message.descriptor);
          const attestation = await RecordsWrite.createAttestation(descriptorCid);
          const signature = await RecordsWrite.createSignerSignature({
            recordId   : recordsWrite.message.recordId,
            contextId  : recordsWrite.message.contextId,
            descriptorCid,
            attestation,
            encryption : recordsWrite.message.encryption,
            signer     : Jws.createSigner(alice)
          });
          recordsWrite.message = {
            ...recordsWrite.message,
            attestation,
            authorization: { signature }
          };

          // Send records write message
          const reply = await dwn.processMessage(alice.did, recordsWrite.message, { dataStream: recordsWrite.dataStream });
          expect(reply.status.code).to.equal(400);
          expect(reply.status.detail).to.contain(DwnErrorCode.UrlProtocolNotNormalized);
        });

        it('#359 - should not allow access of data by referencing `dataCid` in protocol authorized `RecordsWrite`', async () => {
          const alice = await TestDataGenerator.generateDidKeyPersona();
          const bob = await TestDataGenerator.generateDidKeyPersona();

          // alice writes a private record
          const dataString = TestDataGenerator.randomString(DwnConstant.maxDataSizeAllowedToBeEncoded);
          const dataSize = dataString.length;
          const data = Encoder.stringToBytes(dataString);
          const dataCid = await Cid.computeDagPbCidFromBytes(data);

          const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({
            author: alice,
            data,
          });

          const reply = await dwn.processMessage(alice.did, message, { dataStream });
          expect(reply.status.code).to.equal(202);

          const protocolDefinition = socialMediaProtocolDefinition;
          const protocol = protocolDefinition.protocol;

          // alice has a social media protocol that allows anyone to write and read images
          const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition
          });
          const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
          expect(protocolsConfigureReply.status.code).to.equal(202);

          // bob learns of metadata (ie. dataCid) of alice's secret data,
          // attempts to gain unauthorized access by writing to alice's DWN through open protocol referencing the dataCid without supplying the data
          const imageRecordsWrite = await TestDataGenerator.generateRecordsWrite({
            author       : bob,
            protocol,
            protocolPath : 'image',
            schema       : protocolDefinition.types.image.schema,
            dataFormat   : 'image/jpeg',
            dataCid, // bob learns of, and references alice's secrete data's CID
            dataSize,
            recipient    : alice.did
          });
          const imageReply = await dwn.processMessage(alice.did, imageRecordsWrite.message, { dataStream: imageRecordsWrite.dataStream });
          expect(imageReply.status.code).to.equal(202); // allows write but is not readable or queryable

          // verify the record is not able to be read
          const bobRecordsReadData = await RecordsRead.create({
            filter: {
              recordId: imageRecordsWrite.message.recordId,
            },
            signer: Jws.createSigner(bob)
          });
          const bobRecordsReadReply = await dwn.processMessage(alice.did, bobRecordsReadData.message);
          expect(bobRecordsReadReply.status.code).to.equal(404);

          // verify the record is not part of a query
          const bobRecordsQuery= await RecordsQuery.create({
            filter: {
              schema: protocolDefinition.types.image.schema,
            },
            signer: Jws.createSigner(bob)
          });
          const bobRecordsQueryReply = await dwn.processMessage(alice.did, bobRecordsQuery.message);
          expect(bobRecordsQueryReply.status.code).to.equal(200);
          expect(bobRecordsQueryReply.entries?.length).to.equal(0);

          //further sanity query for specific recordId
          const bobRecordsQueryRecordId = await RecordsQuery.create({
            filter: {
              recordId: imageRecordsWrite.message.recordId,
            },
            signer: Jws.createSigner(bob)
          });
          const bobRecordsQueryRecordIdReply = await dwn.processMessage(alice.did, bobRecordsQueryRecordId.message);
          expect(bobRecordsQueryRecordIdReply.status.code).to.equal(200);
          expect(bobRecordsQueryRecordIdReply.entries?.length).to.equal(0);

          // attempt update recordsWrite without data, this will reject
          const updateRecord = await RecordsWrite.createFrom({
            recordsWriteMessage : imageRecordsWrite.message,
            signer              : Jws.createSigner(bob),
            published           : true,
          });
          const updateRecordReply = await dwn.processMessage(alice.did, updateRecord.message);
          expect(updateRecordReply.status.code).to.equal(400);
          expect(updateRecordReply.status.detail).to.include(DwnErrorCode.RecordsWriteMissingEncodedDataInPrevious);

          // sanity still can't query
          const bobRecordsQueryReply2 = await dwn.processMessage(alice.did, bobRecordsQuery.message);
          expect(bobRecordsQueryReply2.status.code).to.equal(200);
          expect(bobRecordsQueryReply2.entries?.length).to.equal(0);
        });

        it('#359 - should not allow access of data by referencing `dataCid` in protocol authorized `RecordsWrite` with large data', async () => {
          const alice = await TestDataGenerator.generateDidKeyPersona();
          const bob = await TestDataGenerator.generateDidKeyPersona();

          // alice writes a private record
          const dataString = TestDataGenerator.randomString(DwnConstant.maxDataSizeAllowedToBeEncoded + 1);
          const dataSize = dataString.length;
          const data = Encoder.stringToBytes(dataString);
          const dataCid = await Cid.computeDagPbCidFromBytes(data);

          const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({
            author: alice,
            data,
          });

          const reply = await dwn.processMessage(alice.did, message, { dataStream });
          expect(reply.status.code).to.equal(202);

          const protocolDefinition = socialMediaProtocolDefinition;
          const protocol = protocolDefinition.protocol;

          // alice has a social media protocol that allows anyone to write and read images
          const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition
          });
          const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
          expect(protocolsConfigureReply.status.code).to.equal(202);

          // bob learns of metadata (ie. dataCid) of alice's secret data,
          // attempts to gain unauthorized access by writing to alice's DWN through open protocol referencing the dataCid without supplying the data
          const imageRecordsWrite = await TestDataGenerator.generateRecordsWrite({
            author       : bob,
            protocol,
            protocolPath : 'image',
            schema       : protocolDefinition.types.image.schema,
            dataFormat   : 'image/jpeg',
            dataCid, // bob learns of, and references alice's secrete data's CID
            dataSize,
            recipient    : alice.did
          });
          const imageReply = await dwn.processMessage(alice.did, imageRecordsWrite.message, { dataStream: imageRecordsWrite.dataStream });
          expect(imageReply.status.code).to.equal(202); // allows write but is not readable or queryable

          // verify the record is not able to be read
          const bobRecordsReadData = await RecordsRead.create({
            filter: {
              recordId: imageRecordsWrite.message.recordId,
            },
            signer: Jws.createSigner(bob)
          });
          const bobRecordsReadReply = await dwn.processMessage(alice.did, bobRecordsReadData.message);
          expect(bobRecordsReadReply.status.code).to.equal(404);

          // verify the record is not part of a query
          const bobRecordsQuery= await RecordsQuery.create({
            filter: {
              schema: protocolDefinition.types.image.schema,
            },
            signer: Jws.createSigner(bob)
          });
          const bobRecordsQueryReply = await dwn.processMessage(alice.did, bobRecordsQuery.message);
          expect(bobRecordsQueryReply.status.code).to.equal(200);
          expect(bobRecordsQueryReply.entries?.length).to.equal(0);

          //further sanity query for specific recordId
          const bobRecordsQueryRecordId = await RecordsQuery.create({
            filter: {
              recordId: imageRecordsWrite.message.recordId,
            },
            signer: Jws.createSigner(bob)
          });
          const bobRecordsQueryRecordIdReply = await dwn.processMessage(alice.did, bobRecordsQueryRecordId.message);
          expect(bobRecordsQueryRecordIdReply.status.code).to.equal(200);
          expect(bobRecordsQueryRecordIdReply.entries?.length).to.equal(0);

          // attempt update recordsWrite without data, this will reject
          const updateRecord = await RecordsWrite.createFrom({
            recordsWriteMessage : imageRecordsWrite.message,
            signer              : Jws.createSigner(bob),
            published           : true,
          });
          const updateRecordReply = await dwn.processMessage(alice.did, updateRecord.message);
          expect(updateRecordReply.status.code).to.equal(400);
          expect(updateRecordReply.status.detail).to.include(DwnErrorCode.RecordsWriteMissingDataInPrevious);

          // sanity still can't query
          const bobRecordsQueryReply2 = await dwn.processMessage(alice.did, bobRecordsQuery.message);
          expect(bobRecordsQueryReply2.status.code).to.equal(200);
          expect(bobRecordsQueryReply2.entries?.length).to.equal(0);
        });

        it('should allow record with or without schema if protocol does not require schema for a record type', async () => {
          // scenario: Alice's DWN has a protocol that allows anyone to write a record without schema

          // write a protocol definition that has a record type without schema
          const protocolDefinition = anyoneCollaborateProtocolDefinition as ProtocolDefinition;
          const alice = await TestDataGenerator.generateDidKeyPersona();

          const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition
          });

          const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
          expect(protocolsConfigureReply.status.code).to.equal(202);

          // write a `RecordsWrite` message without schema
          const data = TestDataGenerator.randomBytes(100);
          const dataStream = DataStream.fromBytes(data);
          const docWrite = await RecordsWrite.create(
            {
              protocol     : protocolDefinition.protocol,
              protocolPath : 'doc',
              dataFormat   : 'application/octet-stream',
              data,
              signer       : Jws.createSigner(alice)
            }
          );

          const writeReply = await dwn.processMessage(alice.did, docWrite.message, { dataStream });
          expect(writeReply.status.code).to.equal(202);

          // write a `RecordsWrite` message with schema
          const data2 = TestDataGenerator.randomBytes(100);
          const data2Stream = DataStream.fromBytes(data2);
          const doc2Write = await RecordsWrite.create(
            {
              protocol     : protocolDefinition.protocol,
              protocolPath : 'doc',
              schema       : TestDataGenerator.randomString(10),
              dataFormat   : 'application/octet-stream',
              data         : data2,
              signer       : Jws.createSigner(alice)
            }
          );

          const write2Reply = await dwn.processMessage(alice.did, doc2Write.message, { dataStream: data2Stream });
          expect(write2Reply.status.code).to.equal(202);

          // verify messages got written to the DB
          const recordsQuery = await RecordsQuery.create({
            filter : { protocolPath: 'doc' },
            signer : Jws.createSigner(alice)
          });
          const recordsReadReply = await dwn.processMessage(alice.did, recordsQuery.message);
          expect(recordsReadReply.status.code).to.equal(200);
          expect(recordsReadReply.entries?.length).to.equal(2);
        });

        it('should allow authorization if protocol message size is within min and max size', async () => {
          const alice = await TestDataGenerator.generatePersona();
          TestStubGenerator.stubDidResolver(didResolver, [alice]);

          const protocolDefinition = {
            protocol  : 'http://blob-size.xyz',
            published : true,
            types     : {
              blob: {}
            },
            structure: {
              blob: {
                $size: {
                  min : 1,
                  max : 1000
                }
              }
            }
          };

          const protocol = protocolDefinition.protocol;
          const protocolConfig = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition,
          });

          const protocolConfigureReply = await dwn.processMessage(alice.did, protocolConfig.message);
          expect(protocolConfigureReply.status.code).to.equal(202);

          // test min record size
          const data = TestDataGenerator.randomBytes(1);
          const testRecord = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            recipient    : alice.did,
            protocol,
            protocolPath : 'blob',
            data
          });

          const reply = await dwn.processMessage(alice.did, testRecord.message, { dataStream: testRecord.dataStream });
          expect(reply.status.code).to.equal(202);

          // test max record size
          const data2 = TestDataGenerator.randomBytes(1000);
          const testRecord2 = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            recipient    : alice.did,
            protocol,
            protocolPath : 'blob',
            data         : data2
          });

          const reply2 = await dwn.processMessage(alice.did, testRecord2.message, { dataStream: testRecord2.dataStream });
          expect(reply2.status.code).to.equal(202);

          // test beyond max size
          const data3 = TestDataGenerator.randomBytes(1001);
          const testRecord3 = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            recipient    : alice.did,
            protocol,
            protocolPath : 'blob',
            data         : data3
          });

          const reply3 = await dwn.processMessage(alice.did, testRecord3.message, { dataStream: testRecord3.dataStream });
          expect(reply3.status.code).to.equal(400);
          expect(reply3.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationMaxSizeInvalid);
        });

        it('should fail authorization if protocol message size is less than specified minimum size', async () => {
          const alice = await TestDataGenerator.generatePersona();
          TestStubGenerator.stubDidResolver(didResolver, [alice]);

          const protocolDefinition = {
            protocol  : 'http://blob-size.xyz',
            published : true,
            types     : {
              blob: {}
            },
            structure: {
              blob: {
                $size: {
                  min: 1000
                }
              }
            }
          };

          const protocol = protocolDefinition.protocol;
          const protocolConfig = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition,
          });

          const protocolConfigureReply = await dwn.processMessage(alice.did, protocolConfig.message);
          expect(protocolConfigureReply.status.code).to.equal(202);

          const data = TestDataGenerator.randomBytes(999);
          const testRecord = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            recipient    : alice.did,
            protocol,
            protocolPath : 'blob',
            data
          });

          const reply = await dwn.processMessage(alice.did, testRecord.message, { dataStream: testRecord.dataStream });
          expect(reply.status.code).to.equal(400);
          expect(reply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationMinSizeInvalid);

          // test valid min record size
          const data2 = TestDataGenerator.randomBytes(1000);
          const testRecord2 = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            recipient    : alice.did,
            protocol,
            protocolPath : 'blob',
            data         : data2
          });

          const reply2 = await dwn.processMessage(alice.did, testRecord2.message, { dataStream: testRecord2.dataStream });
          expect(reply2.status.code).to.equal(202);
        });

        it('should fail authorization if protocol message size is more than specified maximum size', async () => {
          const alice = await TestDataGenerator.generatePersona();
          TestStubGenerator.stubDidResolver(didResolver, [alice]);

          const protocolDefinition = {
            protocol  : 'http://blob-size.xyz',
            published : true,
            types     : {
              blob: {}
            },
            structure: {
              blob: {
                $size: {
                  max: 1000
                }
              }
            }
          };

          const protocol = protocolDefinition.protocol;
          const protocolConfig = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition,
          });

          const protocolConfigureReply = await dwn.processMessage(alice.did, protocolConfig.message);
          expect(protocolConfigureReply.status.code).to.equal(202);

          const data = TestDataGenerator.randomBytes(1001);
          const testRecord = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            recipient    : alice.did,
            protocol,
            protocolPath : 'blob',
            data
          });

          const reply = await dwn.processMessage(alice.did, testRecord.message, { dataStream: testRecord.dataStream });
          expect(reply.status.code).to.equal(400);
          expect(reply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationMaxSizeInvalid);

          // test valid max record size
          const data2 = TestDataGenerator.randomBytes(1000);
          const testRecord2 = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            recipient    : alice.did,
            protocol,
            protocolPath : 'blob',
            data         : data2
          });

          const reply2 = await dwn.processMessage(alice.did, testRecord2.message, { dataStream: testRecord2.dataStream });
          expect(reply2.status.code).to.equal(202);
        });

        it('should fail if a write references a parent that has been deleted', async () => {
          // scenario:
          // 0. Alice installs a nested protocol foo -> bar -> baz
          // 1. Alice writes foo1
          // 2. Alice deletes foo1
          // 3. Alice tries to write a bar1 referencing the deleted foo and should fail

          const alice = await TestDataGenerator.generateDidKeyPersona();

          const protocolDefinition = nestedProtocol as ProtocolDefinition;

          // 0. Alice installs a nested protocol foo -> bar -> baz
          const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition
          });
          const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
          expect(protocolsConfigureReply.status.code).to.equal(202);


          // 1. Alice writes foo1
          const fooOptions = {
            author       : alice,
            protocol     : nestedProtocol.protocol,
            protocolPath : 'foo',
            schema       : nestedProtocol.types.foo.schema,
            dataFormat   : nestedProtocol.types.foo.dataFormats[0],
          };

          const foo1 = await TestDataGenerator.generateRecordsWrite(fooOptions);
          const foo1WriteResponse = await dwn.processMessage(alice.did, foo1.message, { dataStream: foo1.dataStream });
          expect(foo1WriteResponse.status.code).equals(202);

          // 2. Alice deletes foo1
          const deleteFoo = await TestDataGenerator.generateRecordsDelete({
            author   : alice,
            recordId : foo1.message.recordId
          });
          const deleteFooReply = await dwn.processMessage(alice.did, deleteFoo.message);
          expect(deleteFooReply.status.code).equals(202);

          // 3. Alice tries to write a bar1 referencing the deleted foo and should fail
          const barOptions = {
            author          : alice,
            protocol        : nestedProtocol.protocol,
            protocolPath    : 'foo/bar',
            schema          : nestedProtocol.types.bar.schema,
            dataFormat      : nestedProtocol.types.bar.dataFormats[0],
            parentContextId : foo1.message.contextId
          };
          const bar1 = await TestDataGenerator.generateRecordsWrite(barOptions);
          const bar1WriteResponse = await dwn.processMessage(alice.did, bar1.message, { dataStream: bar1.dataStream });
          expect(bar1WriteResponse.status.code).equals(400);
          expect(bar1WriteResponse.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationIncorrectProtocolPath);
        });

        it('should fail if a write references a mismatching parent that compared to the parent in the `contextId` ', async () => {
          // scenario:
          // 0. Alice installs a nested protocol foo -> bar -> baz
          // 1. Alice writes foo1
          // 2. Alice tries to write a bar1 referencing the foo1 in parentId, but contextId does not reference the same parent

          const alice = await TestDataGenerator.generateDidKeyPersona();

          const protocolDefinition = nestedProtocol as ProtocolDefinition;

          // 0. Alice installs a nested protocol foo -> bar -> baz
          const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition
          });
          const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
          expect(protocolsConfigureReply.status.code).to.equal(202);


          // 1. Alice writes foo1
          const fooOptions = {
            author       : alice,
            protocol     : nestedProtocol.protocol,
            protocolPath : 'foo',
            schema       : nestedProtocol.types.foo.schema,
            dataFormat   : nestedProtocol.types.foo.dataFormats[0],
          };

          const foo1 = await TestDataGenerator.generateRecordsWrite(fooOptions);
          const foo1WriteResponse = await dwn.processMessage(alice.did, foo1.message, { dataStream: foo1.dataStream });
          expect(foo1WriteResponse.status.code).equals(202);

          // 2. Alice tries to write a bar1 referencing the foo1 in parentId, but contextId does not reference the same parent
          const barOptions = {
            author          : alice,
            protocol        : nestedProtocol.protocol,
            protocolPath    : 'foo/bar',
            schema          : nestedProtocol.types.bar.schema,
            dataFormat      : nestedProtocol.types.bar.dataFormats[0],
            parentContextId : foo1.message.contextId
          };
          const bar1 = await TestDataGenerator.generateRecordsWrite(barOptions);

          // replace the contextId with a different parent
          const contextIdSegments = bar1.message.contextId!.split(`/`);
          contextIdSegments[1] = 'differentParent';
          bar1.message.contextId = contextIdSegments.join(`/`);

          // resign the message
          const recordId = await RecordsWrite.getEntryId(alice.did, bar1.message.descriptor);
          const descriptorCid = await Cid.computeCid(bar1.message.descriptor);
          const signature = await RecordsWrite.createSignerSignature({
            recordId,
            contextId   : bar1.message.contextId,
            descriptorCid,
            encryption  : undefined,
            attestation : undefined,
            signer      : Jws.createSigner(alice)
          });
          bar1.message.recordId = recordId;
          bar1.message.authorization = { signature };

          const bar1WriteResponse = await dwn.processMessage(alice.did, bar1.message);
          expect(bar1WriteResponse.status.code).equals(400);
          expect(bar1WriteResponse.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationIncorrectContextId);
        });
      });

      describe('grant based writes', () => {
        it('allows external parties to write a record using a grant with unrestricted RecordsWrite scope', async () => {
          // scenario: Alice gives Bob a grant with unrestricted RecordsWrite scope.
          //           Bob is able to write both a protocol and a non-protocol record.

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

          // Alice issues Bob a PermissionsGrant for unrestricted RecordsWrite access
          const permissionsGrant = await TestDataGenerator.generatePermissionsGrant({
            author     : alice,
            grantedBy  : alice.did,
            grantedFor : alice.did,
            grantedTo  : bob.did,
            scope      : {
              interface : DwnInterfaceName.Records,
              method    : DwnMethodName.Write,
            }
          });
          const permissionsGrantReply = await dwn.processMessage(alice.did, permissionsGrant.message);
          expect(permissionsGrantReply.status.code).to.equal(202);
          const permissionsGrantId: string = await Message.getCid(permissionsGrant.message);

          // Bob invokes the grant to write a protocol record to Alice's DWN
          const protocolRecordsWrite = await TestDataGenerator.generateRecordsWrite({
            author       : bob,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'foo',
            permissionsGrantId,
          });
          const recordsWriteReply =
            await dwn.processMessage(alice.did, protocolRecordsWrite.message, { dataStream: protocolRecordsWrite.dataStream });
          expect(recordsWriteReply.status.code).to.equal(202);

          // Bob writes a non-protocol record to Alice's DWN
          const nonProtocolRecordsWrite = await TestDataGenerator.generateRecordsWrite({
            author: bob,
            permissionsGrantId,
          });
          const recordsWriteReply2 =
            await dwn.processMessage(alice.did, nonProtocolRecordsWrite.message, { dataStream: nonProtocolRecordsWrite.dataStream });
          expect(recordsWriteReply2.status.code).to.equal(202);
        });

        describe('protocol records', () => {
          it('allows writes of protocol records with matching protocol grant scopes', async () => {
            // scenario: Alice gives Bob a grant to read all records in the protocol
            //           Bob invokes that grant to write a protocol record.

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

            // Alice gives Bob a PermissionsGrant
            const permissionsGrant = await TestDataGenerator.generatePermissionsGrant({
              author     : alice,
              grantedBy  : alice.did,
              grantedFor : alice.did,
              grantedTo  : bob.did,
              scope      : {
                interface : DwnInterfaceName.Records,
                method    : DwnMethodName.Write,
                protocol  : protocolDefinition.protocol,
              }
            });
            const permissionsGrantReply = await dwn.processMessage(alice.did, permissionsGrant.message);
            expect(permissionsGrantReply.status.code).to.equal(202);

            // Bob invokes the grant in order to write a record to the protocol
            const { recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite({
              author             : bob,
              protocol           : protocolDefinition.protocol,
              protocolPath       : 'foo',
              permissionsGrantId : await Message.getCid(permissionsGrant.message),
            });
            const recordsWriteReply = await dwn.processMessage(alice.did, recordsWrite.message, { dataStream });
            expect(recordsWriteReply.status.code).to.equal(202);
          });

          it('rejects writes of protocol records with mismatching protocol grant scopes', async () => {
            // scenario: Alice gives Bob a grant to write to a protocol. Bob tries and fails to
            //           invoke the grant to write to another protocol.

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

            // Alice gives Bob a PermissionsGrant with a different protocol than what Bob will try to write to
            const permissionsGrant = await TestDataGenerator.generatePermissionsGrant({
              author     : alice,
              grantedBy  : alice.did,
              grantedFor : alice.did,
              grantedTo  : bob.did,
              scope      : {
                interface : DwnInterfaceName.Records,
                method    : DwnMethodName.Write,
                protocol  : 'some-other-protocol',
              }
            });
            const permissionsGrantReply = await dwn.processMessage(alice.did, permissionsGrant.message);
            expect(permissionsGrantReply.status.code).to.equal(202);

            // Bob invokes the grant, failing to write to a different protocol than the grant allows
            const { recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite({
              author             : bob,
              protocol           : protocolDefinition.protocol,
              protocolPath       : 'foo',
              permissionsGrantId : await Message.getCid(permissionsGrant.message),
            });
            const recordsWriteReply = await dwn.processMessage(alice.did, recordsWrite.message, { dataStream });
            expect(recordsWriteReply.status.code).to.equal(401);
            expect(recordsWriteReply.status.detail).to.contain(DwnErrorCode.RecordsGrantAuthorizationScopeProtocolMismatch);
          });

          it('rejects writes of protocol records with non-protocol grant scopes', async () => {
            // scenario: Alice issues Bob a grant allowing him to write some non-protocol records.
            //           Bob invokes the grant to write a protocol record

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

            // Alice gives Bob a PermissionsGrant with a non-protocol scope
            const permissionsGrant = await TestDataGenerator.generatePermissionsGrant({
              author     : alice,
              grantedBy  : alice.did,
              grantedFor : alice.did,
              grantedTo  : bob.did,
              scope      : {
                interface : DwnInterfaceName.Records,
                method    : DwnMethodName.Write,
                schema    : 'some-schema',
              }
            });
            const permissionsGrantReply = await dwn.processMessage(alice.did, permissionsGrant.message);
            expect(permissionsGrantReply.status.code).to.equal(202);

            // Bob invokes the grant, failing to write to a different protocol than the grant allows
            const { recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite({
              author             : bob,
              protocol           : protocolDefinition.protocol,
              protocolPath       : 'foo',
              permissionsGrantId : await Message.getCid(permissionsGrant.message),
            });
            const recordsWriteReply = await dwn.processMessage(alice.did, recordsWrite.message, { dataStream });
            expect(recordsWriteReply.status.code).to.equal(401);
            expect(recordsWriteReply.status.detail).to.contain(DwnErrorCode.RecordsGrantAuthorizationScopeNotProtocol);
          });

          it('allows writes of protocol records with matching contextId grant scopes', async () => {
            // scenario: Alice gives Bob a grant to write to a specific contextId.
            //           Bob invokes that grant to write a record in the allowed contextId.

            const alice = await TestDataGenerator.generateDidKeyPersona();
            const bob = await TestDataGenerator.generateDidKeyPersona();

            const protocolDefinition = emailProtocolDefinition as ProtocolDefinition;

            // Alice installs the protocol
            const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
              author: alice,
              protocolDefinition
            });
            const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
            expect(protocolsConfigureReply.status.code).to.equal(202);

            // Alice creates the context that she will give Bob access to
            const alicesRecordsWrite = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              data         : new TextEncoder().encode('data1'),
              protocol     : protocolDefinition.protocol,
              protocolPath : 'email',
              schema       : protocolDefinition.types.email.schema,
              dataFormat   : protocolDefinition.types.email.dataFormats![0],
            });
            const alicesRecordsWriteReply =
              await dwn.processMessage(alice.did, alicesRecordsWrite.message, { dataStream: alicesRecordsWrite.dataStream });
            expect(alicesRecordsWriteReply.status.code).to.equal(202);

            // Alice gives Bob a PermissionsGrant
            const permissionsGrant = await TestDataGenerator.generatePermissionsGrant({
              author     : alice,
              grantedBy  : alice.did,
              grantedFor : alice.did,
              grantedTo  : bob.did,
              scope      : {
                interface : DwnInterfaceName.Records,
                method    : DwnMethodName.Write,
                protocol  : protocolDefinition.protocol,
                contextId : alicesRecordsWrite.message.contextId,
              }
            });
            const permissionsGrantReply = await dwn.processMessage(alice.did, permissionsGrant.message);
            expect(permissionsGrantReply.status.code).to.equal(202);

            // Bob invokes the grant in order to write a record to the protocol
            const bobsRecordsWrite = await TestDataGenerator.generateRecordsWrite({
              author             : bob,
              protocol           : protocolDefinition.protocol,
              protocolPath       : 'email/email',
              schema             : protocolDefinition.types.email.schema,
              dataFormat         : protocolDefinition.types.email.dataFormats![0],
              parentContextId    : alicesRecordsWrite.message.contextId,
              permissionsGrantId : await Message.getCid(permissionsGrant.message),
            });
            const bobsRecordsWriteReply = await dwn.processMessage(alice.did, bobsRecordsWrite.message, { dataStream: bobsRecordsWrite.dataStream });
            expect(bobsRecordsWriteReply.status.code).to.equal(202);
          });

          it('rejects writes of protocol records with mismatching contextId grant scopes', async () => {
            // scenario: Alice gives Bob a grant to write to a specific contextId. Bob tries and fails to
            //           invoke the grant to write to another contextId.

            const alice = await TestDataGenerator.generateDidKeyPersona();
            const bob = await TestDataGenerator.generateDidKeyPersona();

            const protocolDefinition = emailProtocolDefinition as ProtocolDefinition;

            // Alice installs the protocol
            const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
              author: alice,
              protocolDefinition
            });
            const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
            expect(protocolsConfigureReply.status.code).to.equal(202);

            // Alice creates the context that she will give Bob access to
            const alicesRecordsWrite = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              data         : new TextEncoder().encode('data1'),
              protocol     : protocolDefinition.protocol,
              protocolPath : 'email',
              schema       : protocolDefinition.types.email.schema,
              dataFormat   : protocolDefinition.types.email.dataFormats![0],
            });
            const alicesRecordsWriteReply =
              await dwn.processMessage(alice.did, alicesRecordsWrite.message, { dataStream: alicesRecordsWrite.dataStream });
            expect(alicesRecordsWriteReply.status.code).to.equal(202);

            // Alice gives Bob a PermissionsGrant
            const permissionsGrant = await TestDataGenerator.generatePermissionsGrant({
              author     : alice,
              grantedBy  : alice.did,
              grantedFor : alice.did,
              grantedTo  : bob.did,
              scope      : {
                interface : DwnInterfaceName.Records,
                method    : DwnMethodName.Write,
                protocol  : protocolDefinition.protocol,
                contextId : await TestDataGenerator.randomCborSha256Cid(), // different contextId than what Bob will try to write to
              }
            });
            const permissionsGrantReply = await dwn.processMessage(alice.did, permissionsGrant.message);
            expect(permissionsGrantReply.status.code).to.equal(202);

            // Bob invokes the grant in order to write a record to the protocol
            const bobsRecordsWrite = await TestDataGenerator.generateRecordsWrite({
              author             : bob,
              protocol           : protocolDefinition.protocol,
              protocolPath       : 'email/email',
              schema             : protocolDefinition.types.email.schema,
              dataFormat         : protocolDefinition.types.email.dataFormats![0],
              parentContextId    : alicesRecordsWrite.message.contextId,
              permissionsGrantId : await Message.getCid(permissionsGrant.message),
            });
            const bobsRecordsWriteReply = await dwn.processMessage(alice.did, bobsRecordsWrite.message, { dataStream: bobsRecordsWrite.dataStream });
            expect(bobsRecordsWriteReply.status.code).to.equal(401);
            expect(bobsRecordsWriteReply.status.detail).to.contain(DwnErrorCode.RecordsGrantAuthorizationScopeContextIdMismatch);
          });

          it('allows writes of protocol records with matching protocolPath grant scopes', async () => {
            // scenario: Alice gives Bob a grant to write to a specific protocolPath.
            //           Bob invokes that grant to write a record in the allowed protocolPath.

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

            // Alice gives Bob a PermissionsGrant
            const permissionsGrant = await TestDataGenerator.generatePermissionsGrant({
              author     : alice,
              grantedBy  : alice.did,
              grantedFor : alice.did,
              grantedTo  : bob.did,
              scope      : {
                interface    : DwnInterfaceName.Records,
                method       : DwnMethodName.Write,
                protocol     : protocolDefinition.protocol,
                protocolPath : 'foo',
              }
            });
            const permissionsGrantReply = await dwn.processMessage(alice.did, permissionsGrant.message);
            expect(permissionsGrantReply.status.code).to.equal(202);

            // Bob invokes the grant in order to write a record to the protocol
            const bobsRecordsWrite = await TestDataGenerator.generateRecordsWrite({
              author             : bob,
              protocol           : protocolDefinition.protocol,
              protocolPath       : 'foo',
              permissionsGrantId : await Message.getCid(permissionsGrant.message),
            });
            const bobsRecordsWriteReply = await dwn.processMessage(alice.did, bobsRecordsWrite.message, { dataStream: bobsRecordsWrite.dataStream });
            expect(bobsRecordsWriteReply.status.code).to.equal(202);
          });

          it('rejects writes of protocol records with mismatching protocolPath grant scopes', async () => {
            // scenario: Alice gives Bob a grant to write to a specific protocolPath. Bob tries and fails to
            //           invoke the grant to write to another protocolPath.

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

            // Alice gives Bob a PermissionsGrant
            const permissionsGrant = await TestDataGenerator.generatePermissionsGrant({
              author     : alice,
              grantedBy  : alice.did,
              grantedFor : alice.did,
              grantedTo  : bob.did,
              scope      : {
                interface    : DwnInterfaceName.Records,
                method       : DwnMethodName.Write,
                protocol     : protocolDefinition.protocol,
                protocolPath : 'some-other-protocol-path',
              }
            });
            const permissionsGrantReply = await dwn.processMessage(alice.did, permissionsGrant.message);
            expect(permissionsGrantReply.status.code).to.equal(202);

            // Bob invokes the grant in order to write a record to the protocol
            const bobsRecordsWrite = await TestDataGenerator.generateRecordsWrite({
              author             : bob,
              protocol           : protocolDefinition.protocol,
              protocolPath       : 'foo',
              permissionsGrantId : await Message.getCid(permissionsGrant.message),
            });
            const bobsRecordsWriteReply = await dwn.processMessage(alice.did, bobsRecordsWrite.message, { dataStream: bobsRecordsWrite.dataStream });
            expect(bobsRecordsWriteReply.status.code).to.equal(401);
            expect(bobsRecordsWriteReply.status.detail).to.contain(DwnErrorCode.RecordsGrantAuthorizationScopeProtocolPathMismatch);
          });
        });

        describe('grant scope schema', () => {
          it('allows access if the RecordsWrite grant scope schema includes the schema of the record', async () => {
            // scenario: Alice issues Bob a grant allowing him to write to flat records of a given schema.
            //           Bob invokes that grant to write a record with matching schema

            const alice = await TestDataGenerator.generateDidKeyPersona();
            const bob = await TestDataGenerator.generateDidKeyPersona();

            // Alice gives Bob a PermissionsGrant for a certain schema
            const schema = 'http://example.com/schema';
            const permissionsGrant = await TestDataGenerator.generatePermissionsGrant({
              author     : alice,
              grantedBy  : alice.did,
              grantedFor : alice.did,
              grantedTo  : bob.did,
              scope      : {
                interface : DwnInterfaceName.Records,
                method    : DwnMethodName.Write,
                schema,
              }
            });
            const permissionsGrantReply = await dwn.processMessage(alice.did, permissionsGrant.message);
            expect(permissionsGrantReply.status.code).to.equal(202);

            // Bob invokes the grant to write a record
            const { recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite({
              author             : bob,
              schema,
              permissionsGrantId : await Message.getCid(permissionsGrant.message),
            });
            const recordsWriteReply = await dwn.processMessage(alice.did, recordsWrite.message, { dataStream });
            expect(recordsWriteReply.status.code).to.equal(202);
          });

          it('rejects with 401 if RecordsWrite grant scope schema does not have the same schema as the record', async () => {
            // scenario: Alice issues a grant for Bob to write flat records of a certain schema.
            //           Bob tries and fails to write records of a different schema

            const alice = await TestDataGenerator.generateDidKeyPersona();
            const bob = await TestDataGenerator.generateDidKeyPersona();


            // Alice gives Bob a PermissionsGrant for a certain schema
            const permissionsGrant = await TestDataGenerator.generatePermissionsGrant({
              author     : alice,
              grantedBy  : alice.did,
              grantedFor : alice.did,
              grantedTo  : bob.did,
              scope      : {
                interface : DwnInterfaceName.Records,
                method    : DwnMethodName.Write,
                schema    : 'some-schema',
              }
            });
            const permissionsGrantReply = await dwn.processMessage(alice.did, permissionsGrant.message);
            expect(permissionsGrantReply.status.code).to.equal(202);

            // Bob invokes the grant, failing write a record
            const { recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite({
              author             : bob,
              schema             : 'some-other-schema',
              permissionsGrantId : await Message.getCid(permissionsGrant.message),
            });
            const recordsWriteReply = await dwn.processMessage(alice.did, recordsWrite.message, { dataStream });
            expect(recordsWriteReply.status.code).to.equal(401);
            expect(recordsWriteReply.status.detail).to.contain(DwnErrorCode.RecordsGrantAuthorizationScopeSchema);
          });
        });

        describe('grant condition published', () => {
          it('Rejects unpublished records if grant condition `published` === required', async () => {
            // scenario: Alice gives Bob a grant with condition `published` === required.
            //           Bob is able to write a public record but not able to write an unpublished record.

            const alice = await TestDataGenerator.generateDidKeyPersona();
            const bob = await TestDataGenerator.generateDidKeyPersona();

            // Alice creates a grant for Bob with `published` === required
            const permissionsGrant = await TestDataGenerator.generatePermissionsGrant({
              author     : alice,
              grantedBy  : alice.did,
              grantedFor : alice.did,
              grantedTo  : bob.did,
              scope      : {
                interface : DwnInterfaceName.Records,
                method    : DwnMethodName.Write,
              },
              conditions: {
                publication: PermissionsConditionPublication.Required,
              }
            });
            const permissionsGrantReply = await dwn.processMessage(alice.did, permissionsGrant.message);
            expect(permissionsGrantReply.status.code).to.equal(202);

            const permissionsGrantId = await Message.getCid(permissionsGrant.message);

            // Bob is able to write a published record
            const publishedRecordsWrite = await TestDataGenerator.generateRecordsWrite({
              author    : bob,
              published : true,
              permissionsGrantId
            });
            const publishedRecordsWriteReply = await dwn.processMessage(
              alice.did,
              publishedRecordsWrite.message,
              { dataStream: publishedRecordsWrite.dataStream }
            );
            expect(publishedRecordsWriteReply.status.code).to.equal(202);

            // Bob is not able to write an unpublished record
            const unpublishedRecordsWrite = await TestDataGenerator.generateRecordsWrite({
              author    : bob,
              published : false,
              permissionsGrantId
            });
            const unpublishedRecordsWriteReply =
              await dwn.processMessage(alice.did, unpublishedRecordsWrite.message, { dataStream: unpublishedRecordsWrite.dataStream });
            expect(unpublishedRecordsWriteReply.status.code).to.equal(401);
            expect(unpublishedRecordsWriteReply.status.detail).to.contain(DwnErrorCode.RecordsGrantAuthorizationConditionPublicationRequired);
          });

          it('Rejects published records if grant condition `published` === prohibited', async () => {
            // scenario: Alice gives Bob a grant with condition `published` === prohibited.
            //           Bob is able to write a unpublished record but not able to write a public record.

            const alice = await TestDataGenerator.generateDidKeyPersona();
            const bob = await TestDataGenerator.generateDidKeyPersona();

            // Alice creates a grant for Bob with `published` === prohibited
            const permissionsGrant = await TestDataGenerator.generatePermissionsGrant({
              author     : alice,
              grantedBy  : alice.did,
              grantedFor : alice.did,
              grantedTo  : bob.did,
              scope      : {
                interface : DwnInterfaceName.Records,
                method    : DwnMethodName.Write,
              },
              conditions: {
                publication: PermissionsConditionPublication.Prohibited
              }
            });
            const permissionsGrantReply = await dwn.processMessage(alice.did, permissionsGrant.message);
            expect(permissionsGrantReply.status.code).to.equal(202);

            const permissionsGrantId = await Message.getCid(permissionsGrant.message);

            // Bob not is able to write a published record
            const publishedRecordsWrite = await TestDataGenerator.generateRecordsWrite({
              author    : bob,
              published : true,
              permissionsGrantId
            });
            const publishedRecordsWriteReply = await dwn.processMessage(
              alice.did,
              publishedRecordsWrite.message,
              { dataStream: publishedRecordsWrite.dataStream }
            );
            expect(publishedRecordsWriteReply.status.code).to.equal(401);
            expect(publishedRecordsWriteReply.status.detail).to.contain(DwnErrorCode.RecordsGrantAuthorizationConditionPublicationProhibited);

            // Bob is able to write an unpublished record
            const unpublishedRecordsWrite = await TestDataGenerator.generateRecordsWrite({
              author    : bob,
              published : false,
              permissionsGrantId
            });
            const unpublishedRecordsWriteReply =
              await dwn.processMessage(alice.did, unpublishedRecordsWrite.message, { dataStream: unpublishedRecordsWrite.dataStream });
            expect(unpublishedRecordsWriteReply.status.code).to.equal(202);
          });

          it('Allows both published and unpublished records if grant condition `published` is undefined', async () => {
            // scenario: Alice gives Bob a grant without condition `published`.
            //           Bob is able to write both an unpublished record and a published record.

            const alice = await TestDataGenerator.generateDidKeyPersona();
            const bob = await TestDataGenerator.generateDidKeyPersona();

            // Alice creates a grant for Bob with `published` === prohibited
            const permissionsGrant = await TestDataGenerator.generatePermissionsGrant({
              author     : alice,
              grantedBy  : alice.did,
              grantedFor : alice.did,
              grantedTo  : bob.did,
              scope      : {
                interface : DwnInterfaceName.Records,
                method    : DwnMethodName.Write,
              },
              conditions: {
                // publication: '', // intentionally undefined
              }
            });
            const permissionsGrantReply = await dwn.processMessage(alice.did, permissionsGrant.message);
            expect(permissionsGrantReply.status.code).to.equal(202);

            const permissionsGrantId = await Message.getCid(permissionsGrant.message);

            // Bob is able to write a published record
            const publishedRecordsWrite = await TestDataGenerator.generateRecordsWrite({
              author    : bob,
              published : true,
              permissionsGrantId
            });
            const publishedRecordsWriteReply = await dwn.processMessage(
              alice.did,
              publishedRecordsWrite.message,
              { dataStream: publishedRecordsWrite.dataStream }
            );
            expect(publishedRecordsWriteReply.status.code).to.equal(202);

            // Bob is able to write an unpublished record
            const unpublishedRecordsWrite = await TestDataGenerator.generateRecordsWrite({
              author    : bob,
              published : false,
              permissionsGrantId
            });
            const unpublishedRecordsWriteReply =
              await dwn.processMessage(alice.did, unpublishedRecordsWrite.message, { dataStream: unpublishedRecordsWrite.dataStream });
            expect(unpublishedRecordsWriteReply.status.code).to.equal(202);
          });
        });
      });

      it('should 400 if dataStream is not provided and dataStore does not contain dataCid', async () => {
      // scenario: A sync writes a pruned initial RecordsWrite, without a `dataStream`. Alice does another regular
      // RecordsWrite for the same record, referencing the same `dataCid` but omitting the `dataStream`.

        // Pruned RecordsWrite
        // Data large enough to use the DataStore
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const data = TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded + 1);
        const prunedRecordsWrite = await TestDataGenerator.generateRecordsWrite({
          author    : alice,
          published : false,
          data,
        });
        const prunedRecordsWriteReply = await dwn.processMessage(alice.did, prunedRecordsWrite.message);
        expect(prunedRecordsWriteReply.status.code).to.equal(202);

        // Update record to published, omitting dataStream
        const recordsWrite = await TestDataGenerator.generateFromRecordsWrite({
          author        : alice,
          existingWrite : prunedRecordsWrite.recordsWrite,
          published     : true,
          data,
        });
        const recordsWriteReply = await dwn.processMessage(alice.did, recordsWrite.message);
        expect(recordsWriteReply.status.code).to.equal(400);
        expect(recordsWriteReply.status.detail).to.contain(DwnErrorCode.RecordsWriteMissingDataInPrevious);
      });

      it('should 400 if dataStream is not provided and previous message does not contain encodedData', async () => {
        // scenario: A sync writes a pruned initial RecordsWrite, without a `dataStream`. Alice does another regular
        // RecordsWrite for the same record, referencing the same `dataCid` but omitting the `dataStream`.

        // Pruned RecordsWrite
        // Data that would be encoded within the message
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const data = TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded);
        const prunedRecordsWrite = await TestDataGenerator.generateRecordsWrite({
          author    : alice,
          published : false,
          data,
        });
        const prunedRecordsWriteReply = await dwn.processMessage(alice.did, prunedRecordsWrite.message);
        expect(prunedRecordsWriteReply.status.code).to.equal(202);

        // Update record to published, omitting dataStream
        const recordsWrite = await TestDataGenerator.generateFromRecordsWrite({
          author        : alice,
          existingWrite : prunedRecordsWrite.recordsWrite,
          published     : true,
          data,
        });
        const recordsWriteReply = await dwn.processMessage(alice.did, recordsWrite.message);
        expect(recordsWriteReply.status.code).to.equal(400);
        expect(recordsWriteReply.status.detail).to.contain(DwnErrorCode.RecordsWriteMissingEncodedDataInPrevious);
      });

      it('should not allow referencing data across tenants', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const bob = await TestDataGenerator.generateDidKeyPersona();
        const data = Encoder.stringToBytes('test');
        const dataCid = await Cid.computeDagPbCidFromBytes(data);
        const encodedData = Encoder.bytesToBase64Url(data);

        // alice writes data to her DWN
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

        // bob learns of the CID of data of alice and tries to gain unauthorized access by referencing it in his own DWN
        const bobWriteData = await TestDataGenerator.generateRecordsWrite({
          author   : bob,
          dataCid,
          dataSize : 4
        });
        const bobWriteReply = await dwn.processMessage(bob.did, bobWriteData.message); // intentionally missing data stream
        expect(bobWriteReply.status.code).to.equal(202); // NOTE: allows write here but does not allow read or query later

        const aliceQueryWriteAfterBobWriteData = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : { recordId: aliceWriteData.message.recordId }
        });
        const aliceQueryWriteAfterBobWriteReply = await dwn.processMessage(alice.did, aliceQueryWriteAfterBobWriteData.message);
        expect(aliceQueryWriteAfterBobWriteReply.status.code).to.equal(200);
        expect(aliceQueryWriteAfterBobWriteReply.entries?.length).to.equal(1);
        expect(aliceQueryWriteAfterBobWriteReply.entries![0].encodedData).to.equal(encodedData);

        // verify that bob has not gained access to alice's data
        const bobQueryAfterBobWriteData = await TestDataGenerator.generateRecordsQuery({
          author : bob,
          filter : { recordId: bobWriteData.message.recordId }
        });
        const bobQueryAfterBobWriteReply = await dwn.processMessage(bob.did, bobQueryAfterBobWriteData.message);
        expect(bobQueryAfterBobWriteReply.status.code).to.equal(200);
        expect(bobQueryAfterBobWriteReply.entries?.length).to.equal(0);
      });

      describe('encodedData threshold', async () => {
        it('should call cloneAndAddEncodedData if dataSize is less than or equal to the threshold', async () => {
          const alice = await TestDataGenerator.generateDidKeyPersona();
          const dataBytes = TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded);
          const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ author: alice, data: dataBytes });
          const processEncoded = sinon.spy(RecordsWriteHandler.prototype as any, 'cloneAndAddEncodedData');

          const writeMessage = await dwn.processMessage(alice.did, message, { dataStream });
          expect(writeMessage.status.code).to.equal(202);
          sinon.assert.calledOnce(processEncoded);
        });

        it('should not call cloneAndAddEncodedData if dataSize is greater than the threshold', async () => {
          const alice = await TestDataGenerator.generateDidKeyPersona();
          const dataBytes = TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded + 1);
          const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ author: alice, data: dataBytes });
          const processEncoded = sinon.spy(RecordsWriteHandler.prototype as any, 'cloneAndAddEncodedData');

          const writeMessage = await dwn.processMessage(alice.did, message, { dataStream });
          expect(writeMessage.status.code).to.equal(202);
          sinon.assert.notCalled(processEncoded);
        });

        it('should have encodedData field if dataSize is less than or equal to the threshold', async () => {
          const alice = await TestDataGenerator.generateDidKeyPersona();
          const dataBytes = TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded);
          const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ author: alice, data: dataBytes });

          const writeMessage = await dwn.processMessage(alice.did, message, { dataStream });
          expect(writeMessage.status.code).to.equal(202);
          const messageCid = await Message.getCid(message);

          const storedMessage = await messageStore.get(alice.did, messageCid);
          expect((storedMessage as RecordsQueryReplyEntry).encodedData).to.exist.and.not.be.undefined;
        });

        it('should not have encodedData field if dataSize greater than threshold', async () => {
          const alice = await TestDataGenerator.generateDidKeyPersona();
          const dataBytes = TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded + 1);
          const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ author: alice, data: dataBytes });

          const writeMessage = await dwn.processMessage(alice.did, message, { dataStream });
          expect(writeMessage.status.code).to.equal(202);
          const messageCid = await Message.getCid(message);

          const storedMessage = await messageStore.get(alice.did, messageCid);
          expect((storedMessage as RecordsQueryReplyEntry).encodedData).to.not.exist;
        });

        it('should retain original RecordsWrite message but without the encodedData if data is under threshold', async () => {
          const alice = await TestDataGenerator.generateDidKeyPersona();
          const dataBytes = TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded);
          const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ author: alice, data: dataBytes });

          const writeMessage = await dwn.processMessage(alice.did, message, { dataStream });
          expect(writeMessage.status.code).to.equal(202);
          const messageCid = await Message.getCid(message);

          const storedMessage = await messageStore.get(alice.did, messageCid);
          expect((storedMessage as RecordsQueryReplyEntry).encodedData).to.exist.and.not.be.undefined;

          const updatedDataBytes = TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded);
          const newWrite = await RecordsWrite.createFrom({
            recordsWriteMessage : message,
            published           : true,
            signer              : Jws.createSigner(alice),
            data                : updatedDataBytes,
          });

          const updateDataStream = DataStream.fromBytes(updatedDataBytes);

          const writeMessage2 = await dwn.processMessage(alice.did, newWrite.message, { dataStream: updateDataStream });
          expect(writeMessage2.status.code).to.equal(202);

          const originalWrite = await messageStore.get(alice.did, messageCid);
          expect((originalWrite as RecordsQueryReplyEntry).encodedData).to.not.exist;

          const newestWrite = await messageStore.get(alice.did, await Message.getCid(newWrite.message));
          expect((newestWrite as RecordsQueryReplyEntry).encodedData).to.exist.and.not.be.undefined;
        });
      });
    });

    describe('authorization validation tests', () => {
      it('should return 400 if `recordId` in payload of the message signature mismatches with `recordId` in the message', async () => {
        const { author, message, recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite();

        // replace signature with mismatching `recordId`, even though signature is still valid
        const signaturePayload = { ...recordsWrite.signaturePayload };
        signaturePayload.recordId = await TestDataGenerator.randomCborSha256Cid(); // make recordId mismatch in authorization payload
        const signaturePayloadBytes = Encoder.objectToBytes(signaturePayload);
        const signer = Jws.createSigner(author);
        const jwsBuilder = await GeneralJwsBuilder.create(signaturePayloadBytes, [signer]);
        message.authorization = { signature: jwsBuilder.getJws() };

        const tenant = author.did;
        const didResolver = TestStubGenerator.createDidResolverStub(author);
        const messageStore = stubInterface<MessageStore>();
        const dataStore = stubInterface<DataStore>();

        const recordsWriteHandler = new RecordsWriteHandler(didResolver, messageStore, dataStore, eventLog, eventStream);
        const reply = await recordsWriteHandler.handle({ tenant, message, dataStream: dataStream! });

        expect(reply.status.code).to.equal(400);
        expect(reply.status.detail).to.contain('does not match recordId in authorization');
      });

      it('should return 400 if `contextId` in payload of message signature mismatches with `contextId` in the message', async () => {
        // generate a message with protocol so that computed contextId is also computed and included in message
        const { author, message, recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite({ protocol: 'http://any.value', protocolPath: 'any/value' });

        // replace `authorization` with mismatching `contextId`, even though signature is still valid
        const signaturePayload = { ...recordsWrite.signaturePayload };
        signaturePayload.contextId = await TestDataGenerator.randomCborSha256Cid(); // make contextId mismatch in authorization payload
        const signaturePayloadBytes = Encoder.objectToBytes(signaturePayload);
        const signer = Jws.createSigner(author);
        const jwsBuilder = await GeneralJwsBuilder.create(signaturePayloadBytes, [signer]);
        message.authorization = { signature: jwsBuilder.getJws() };

        const tenant = author.did;
        const didResolver = sinon.createStubInstance(DidResolver);
        const messageStore = stubInterface<MessageStore>();
        const dataStore = stubInterface<DataStore>();

        const recordsWriteHandler = new RecordsWriteHandler(didResolver, messageStore, dataStore, eventLog, eventStream);
        const reply = await recordsWriteHandler.handle({ tenant, message, dataStream: dataStream! });

        expect(reply.status.code).to.equal(400);
        expect(reply.status.detail).to.contain('does not match contextId in authorization');
      });

      it('should return 401 if `authorization` signature check fails', async () => {
        const { author, message, dataStream } = await TestDataGenerator.generateRecordsWrite();
        const tenant = author.did;

        // setting up a stub DID resolver & message store
        // intentionally not supplying the public key so a different public key is generated to simulate invalid signature
        const mismatchingPersona = await TestDataGenerator.generatePersona({ did: author.did, keyId: author.keyId });
        const didResolver = TestStubGenerator.createDidResolverStub(mismatchingPersona);
        const messageStore = stubInterface<MessageStore>();
        const dataStore = stubInterface<DataStore>();

        const recordsWriteHandler = new RecordsWriteHandler(didResolver, messageStore, dataStore, eventLog, eventStream);
        const reply = await recordsWriteHandler.handle({ tenant, message, dataStream: dataStream! });

        expect(reply.status.code).to.equal(401);
      });

      it('should return 401 if an unauthorized author is attempting write', async () => {
        const author = await TestDataGenerator.generatePersona();
        const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ author });

        // setting up a stub DID resolver & message store
        const didResolver = TestStubGenerator.createDidResolverStub(author);
        const messageStore = stubInterface<MessageStore>();
        const dataStore = stubInterface<DataStore>();

        const recordsWriteHandler = new RecordsWriteHandler(didResolver, messageStore, dataStore, eventLog, eventStream);

        const tenant = await (await TestDataGenerator.generatePersona()).did; // unauthorized tenant
        const reply = await recordsWriteHandler.handle({ tenant, message, dataStream: dataStream! });

        expect(reply.status.code).to.equal(401);
      });
    });

    describe('attestation validation tests', () => {
      it('should fail with 400 if `attestation` payload contains properties other than `descriptorCid`', async () => {
        const { author, message, recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite();
        const tenant = author.did;
        const signer = Jws.createSigner(author);

        // replace `attestation` with one that has an additional property, but go the extra mile of making sure signature is valid
        const descriptorCid = recordsWrite.signaturePayload!.descriptorCid;
        const attestationPayload = { descriptorCid, someAdditionalProperty: 'anyValue' }; // additional property is not allowed
        const attestationPayloadBytes = Encoder.objectToBytes(attestationPayload);
        const attestationBuilder = await GeneralJwsBuilder.create(attestationPayloadBytes, [signer]);
        message.attestation = attestationBuilder.getJws();

        // recreate the `authorization` based on the new` attestationCid`
        const signaturePayload = { ...recordsWrite.signaturePayload };
        signaturePayload.attestationCid = await Cid.computeCid(attestationPayload);
        const signaturePayloadBytes = Encoder.objectToBytes(signaturePayload);
        const authorizationBuilder = await GeneralJwsBuilder.create(signaturePayloadBytes, [signer]);
        message.authorization = { signature: authorizationBuilder.getJws() };

        const didResolver = TestStubGenerator.createDidResolverStub(author);
        const messageStore = stubInterface<MessageStore>();
        const dataStore = stubInterface<DataStore>();

        const recordsWriteHandler = new RecordsWriteHandler(didResolver, messageStore, dataStore, eventLog, eventStream);
        const reply = await recordsWriteHandler.handle({ tenant, message, dataStream: dataStream! });

        expect(reply.status.code).to.equal(400);
        expect(reply.status.detail).to.contain(`Only 'descriptorCid' is allowed in attestation payload`);
      });

      it('should fail validation with 400 if more than 1 attester is given ', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const bob = await TestDataGenerator.generateDidKeyPersona();
        const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ author: alice, attesters: [alice, bob] });

        const recordsWriteHandler = new RecordsWriteHandler(didResolver, messageStore, dataStore, eventLog, eventStream);
        const writeReply = await recordsWriteHandler.handle({ tenant: alice.did, message, dataStream: dataStream! });

        expect(writeReply.status.code).to.equal(400);
        expect(writeReply.status.detail).to.contain('implementation only supports 1 attester');
      });

      it('should fail validation with 400 if the `attestation` does not include the correct `descriptorCid`', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ author: alice, attesters: [alice] });

        // create another write and use its `attestation` value instead, that `attestation` will point to an entirely different `descriptorCid`
        const anotherWrite = await TestDataGenerator.generateRecordsWrite({ attesters: [alice] });
        message.attestation = anotherWrite.message.attestation;

        const recordsWriteHandler = new RecordsWriteHandler(didResolver, messageStore, dataStore, eventLog, eventStream);
        const writeReply = await recordsWriteHandler.handle({ tenant: alice.did, message, dataStream: dataStream! });

        expect(writeReply.status.code).to.equal(400);
        expect(writeReply.status.detail).to.contain('does not match expected descriptorCid');
      });

      it('should fail validation with 400 if expected CID of `attestation` mismatches the `attestationCid` in `authorization`', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ author: alice, attesters: [alice] });

        // replace valid attestation (the one signed by `authorization` with another attestation to the same message (descriptorCid)
        const bob = await TestDataGenerator.generateDidKeyPersona();
        const descriptorCid = await Cid.computeCid(message.descriptor);
        const attestationNotReferencedByAuthorization = await RecordsWrite['createAttestation'](descriptorCid, Jws.createSigners([bob]));
        message.attestation = attestationNotReferencedByAuthorization;

        const recordsWriteHandler = new RecordsWriteHandler(didResolver, messageStore, dataStore, eventLog, eventStream);
        const writeReply = await recordsWriteHandler.handle({ tenant: alice.did, message, dataStream: dataStream! });

        expect(writeReply.status.code).to.equal(400);
        expect(writeReply.status.detail).to.contain('does not match attestationCid');
      });
    });

    describe('unknown error', () => {
      beforeEach(() => {
        sinon.restore(); // wipe all previous stubs/spies/mocks/fakes
      });

      it('should throw if `recordsWriteHandler.processMessageWithoutDataStream()` throws unknown error', async () => {
        // simulate an initial write to test non-data path, as initial writes without data are always accepted (bot not readable)
        // https://github.com/TBD54566975/dwn-sdk-js/issues/628
        const { author, message: initialWriteMessage, recordsWrite: initialWrite } = await TestDataGenerator.generateRecordsWrite();
        await Time.minimalSleep();

        const { message, dataStream } = await TestDataGenerator.generateFromRecordsWrite({ author, existingWrite: initialWrite });
        const tenant = author.did;
        const didResolverStub = TestStubGenerator.createDidResolverStub(author);

        const messageStoreStub = stubInterface<MessageStore>();
        messageStoreStub.query.resolves({ messages: [ initialWriteMessage ] });

        const dataStoreStub = stubInterface<DataStore>();

        const recordsWriteHandler = new RecordsWriteHandler(didResolverStub, messageStoreStub, dataStoreStub, eventLog, eventStream);

        // simulate throwing unexpected error
        sinon.stub(recordsWriteHandler as any, 'processMessageWithoutDataStream').throws(new Error('an unknown error in recordsWriteHandler.processMessageWithoutDataStream()'));
        sinon.stub(recordsWriteHandler as any, 'processMessageWithDataStream').throws(new Error('an unknown error in recordsWriteHandler.processMessageWithDataStream()'));

        let handlerPromise = recordsWriteHandler.handle({ tenant, message, dataStream: dataStream! }); // with data stream
        await expect(handlerPromise).to.be.rejectedWith('an unknown error in recordsWriteHandler.processMessageWithDataStream()');

        handlerPromise = recordsWriteHandler.handle({ tenant, message }); // without data stream
        await expect(handlerPromise).to.be.rejectedWith('an unknown error in recordsWriteHandler.processMessageWithoutDataStream()');
      });

    });
  });
}
