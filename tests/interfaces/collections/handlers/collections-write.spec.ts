import chaiAsPromised from 'chai-as-promised';
import credentialIssuanceProtocolDefinition from '../../../vectors/protocol-definitions/credential-issuance.json' assert { type: 'json' };
import dexProtocolDefinition from '../../../vectors/protocol-definitions/dex.json' assert { type: 'json' };
import sinon from 'sinon';
import chai, { expect } from 'chai';

import { base64url } from 'multiformats/bases/base64';
import { RecordsWriteMessage } from '../../../../src/interfaces/collections/types.js';
import { DidKeyResolver } from '../../../../src/did/did-key-resolver.js';
import { DidResolver } from '../../../../src/did/did-resolver.js';
import { Encoder } from '../../../../src/utils/encoder.js';
import { GeneralJwsSigner } from '../../../../src/jose/jws/general/signer.js';
import { getCurrentTimeInHighPrecision } from '../../../../src/utils/time.js';
import { handleCollectionsQuery } from '../../../../src/interfaces/collections/handlers/collections-query.js';
import { handleRecordsWrite } from '../../../../src/interfaces/collections/handlers/collections-write.js';
import { handleProtocolsConfigure } from '../../../../src/interfaces/protocols/handlers/protocols-configure.js';
import { Message } from '../../../../src/core/message.js';
import { MessageStoreLevel } from '../../../../src/store/message-store-level.js';
import { TestDataGenerator } from '../../../utils/test-data-generator.js';
import { TestStubGenerator } from '../../../utils/test-stub-generator.js';

import { RecordsWrite, ProtocolDefinition } from '../../../../src/index.js';

chai.use(chaiAsPromised);

describe('handleRecordsWrite()', () => {
  let didResolver: DidResolver;
  let messageStore: MessageStoreLevel;

  describe('functional tests', () => {
    before(async () => {
      didResolver = new DidResolver([new DidKeyResolver()]);

      // important to follow this pattern to initialize the message store in tests
      // so that different suites can reuse the same block store and index location for testing
      messageStore = new MessageStoreLevel({
        blockstoreLocation: 'TEST-BLOCKSTORE',
        indexLocation: 'TEST-INDEX'
      });

      await messageStore.open();
    });

    beforeEach(async () => {
      await messageStore.clear(); // clean up before each test rather than after so that a test does not depend on other tests to do the clean up
    });

    after(async () => {
      await messageStore.close();
    });

    it('should only be able to overwrite existing record if new record has a later `dateModified` value', async () => {
      // write a message into DB
      const requester = await TestDataGenerator.generatePersona();
      const target = requester;
      const data1 = new TextEncoder().encode('data1');
      const collectionsWriteMessageData = await TestDataGenerator.generateRecordsWriteMessage({ requester, target, data: data1 });

      // setting up a stub did resolver
      const didResolverStub = TestStubGenerator.createDidResolverStub(requester);

      const collectionsWriteReply = await handleRecordsWrite(collectionsWriteMessageData.message, messageStore, didResolverStub);
      expect(collectionsWriteReply.status.code).to.equal(202);

      const recordId = collectionsWriteMessageData.message.recordId;
      const collectionsQueryMessageData = await TestDataGenerator.generateCollectionsQueryMessage({
        requester,
        target,
        filter: { recordId }
      });

      // verify the message written can be queried
      const collectionsQueryReply = await handleCollectionsQuery(collectionsQueryMessageData.message, messageStore, didResolverStub);
      expect(collectionsQueryReply.status.code).to.equal(200);
      expect(collectionsQueryReply.entries?.length).to.equal(1);
      expect((collectionsQueryReply.entries![0] as RecordsWriteMessage).encodedData).to.equal(base64url.baseEncode(data1));

      // generate and write a new RecordsWrite to overwrite the existing record
      // a new RecordsWrite by default will have a later `dateModified`
      const newDataBytes = Encoder.stringToBytes('new data');
      const newDataEncoded = Encoder.bytesToBase64Url(newDataBytes);
      const newRecordsWrite = await TestDataGenerator.generateFromRecordsWrite({
        requester,
        existingWrite: collectionsWriteMessageData.collectionsWrite,
        data: newDataBytes
      });

      // sanity check that old data and new data are different
      expect(newDataEncoded).to.not.equal(collectionsWriteMessageData.message.encodedData);

      const newRecordsWriteReply = await handleRecordsWrite(newRecordsWrite.message, messageStore, didResolverStub);
      expect(newRecordsWriteReply.status.code).to.equal(202);

      // verify new record has overwritten the existing record
      const newCollectionsQueryReply = await handleCollectionsQuery(collectionsQueryMessageData.message, messageStore, didResolverStub);

      expect(newCollectionsQueryReply.status.code).to.equal(200);
      expect(newCollectionsQueryReply.entries?.length).to.equal(1);
      expect((newCollectionsQueryReply.entries![0] as RecordsWriteMessage).encodedData).to.equal(newDataEncoded);

      // try to write the older message to store again and verify that it is not accepted
      const thirdRecordsWriteReply = await handleRecordsWrite(collectionsWriteMessageData.message, messageStore, didResolverStub);
      expect(thirdRecordsWriteReply.status.code).to.equal(409); // expecting to fail

      // expecting unchanged
      const thirdCollectionsQueryReply = await handleCollectionsQuery(collectionsQueryMessageData.message, messageStore, didResolverStub);
      expect(thirdCollectionsQueryReply.status.code).to.equal(200);
      expect(thirdCollectionsQueryReply.entries?.length).to.equal(1);
      expect((thirdCollectionsQueryReply.entries![0] as RecordsWriteMessage).encodedData).to.equal(newDataEncoded);
    });

    it('should only be able to overwrite existing record if new message CID is larger when `dateModified` value is the same', async () => {
      // start by writing an originating message
      const requester = await TestDataGenerator.generatePersona();
      const target = requester;
      const originatingMessageData = await TestDataGenerator.generateRecordsWriteMessage({
        requester,
        target,
        data: Encoder.stringToBytes('unused')
      });

      // setting up a stub did resolver
      const didResolverStub = TestStubGenerator.createDidResolverStub(requester);

      // sanity check that originating message got written
      const originatingMessageWriteReply = await handleRecordsWrite(originatingMessageData.message, messageStore, didResolverStub);
      expect(originatingMessageWriteReply.status.code).to.equal(202);

      // generate two new RecordsWrite messages with the same `dateModified` value
      const dateModified = getCurrentTimeInHighPrecision();
      const collectionsWrite1 = await TestDataGenerator.generateFromRecordsWrite({
        requester,
        existingWrite: originatingMessageData.collectionsWrite,
        dateModified
      });

      const collectionsWrite2 = await TestDataGenerator.generateFromRecordsWrite({
        requester,
        existingWrite: originatingMessageData.collectionsWrite,
        dateModified
      });

      // determine the lexicographical order of the two messages
      const message1Cid = await Message.getCid(collectionsWrite1.message);
      const message2Cid = await Message.getCid(collectionsWrite2.message);
      let largerCollectionWrite: RecordsWrite;
      let smallerCollectionWrite: RecordsWrite;
      if (message1Cid > message2Cid) {
        largerCollectionWrite = collectionsWrite1;
        smallerCollectionWrite = collectionsWrite2;
      } else {
        largerCollectionWrite = collectionsWrite2;
        smallerCollectionWrite = collectionsWrite1;
      }

      // write the message with the smaller lexicographical message CID first
      const collectionsWriteReply = await handleRecordsWrite(smallerCollectionWrite.message, messageStore, didResolverStub);
      expect(collectionsWriteReply.status.code).to.equal(202);

      // query to fetch the record
      const collectionsQueryMessageData = await TestDataGenerator.generateCollectionsQueryMessage({
        requester,
        target,
        filter: { recordId: originatingMessageData.message.recordId }
      });

      // verify the data is written
      const collectionsQueryReply = await handleCollectionsQuery(collectionsQueryMessageData.message, messageStore, didResolverStub);
      expect(collectionsQueryReply.status.code).to.equal(200);
      expect(collectionsQueryReply.entries?.length).to.equal(1);
      expect((collectionsQueryReply.entries![0] as RecordsWriteMessage).descriptor.dataCid)
        .to.equal(smallerCollectionWrite.message.descriptor.dataCid);

      // attempt to write the message with larger lexicographical message CID
      const newRecordsWriteReply = await handleRecordsWrite(largerCollectionWrite.message, messageStore, didResolverStub);
      expect(newRecordsWriteReply.status.code).to.equal(202);

      // verify new record has overwritten the existing record
      const newCollectionsQueryReply = await handleCollectionsQuery(collectionsQueryMessageData.message, messageStore, didResolverStub);
      expect(newCollectionsQueryReply.status.code).to.equal(200);
      expect(newCollectionsQueryReply.entries?.length).to.equal(1);
      expect((newCollectionsQueryReply.entries![0] as RecordsWriteMessage).descriptor.dataCid)
        .to.equal(largerCollectionWrite.message.descriptor.dataCid);

      // try to write the message with smaller lexicographical message CID again
      const thirdRecordsWriteReply = await handleRecordsWrite(
        smallerCollectionWrite.message,
        messageStore,
        didResolverStub
      );
      expect(thirdRecordsWriteReply.status.code).to.equal(409); // expecting to fail

      // verify the message in store is still the one with larger lexicographical message CID
      const thirdCollectionsQueryReply = await handleCollectionsQuery(collectionsQueryMessageData.message, messageStore, didResolverStub);
      expect(thirdCollectionsQueryReply.status.code).to.equal(200);
      expect(thirdCollectionsQueryReply.entries?.length).to.equal(1);
      expect((thirdCollectionsQueryReply.entries![0] as RecordsWriteMessage).descriptor.dataCid)
        .to.equal(largerCollectionWrite.message.descriptor.dataCid); // expecting unchanged
    });

    it('should not allow changes to immutable properties', async () => {
      const initialWriteData = await TestDataGenerator.generateRecordsWriteMessage();
      const didResolverStub = TestStubGenerator.createDidResolverStub(initialWriteData.requester);
      const initialWriteReply = await handleRecordsWrite(initialWriteData.message, messageStore, didResolverStub);
      expect(initialWriteReply.status.code).to.equal(202);

      const recordId = initialWriteData.message.recordId;
      const dateCreated = initialWriteData.message.descriptor.dateCreated;
      const schema = initialWriteData.message.descriptor.schema;

      // dateCreated test
      let childMessageData = await TestDataGenerator.generateRecordsWriteMessage({
        requester: initialWriteData.requester,
        target: initialWriteData.target,
        recordId,
        schema,
        dateCreated: getCurrentTimeInHighPrecision(), // should not be allowed to be modified
        dataFormat: initialWriteData.message.descriptor.dataFormat
      });

      let reply = await handleRecordsWrite(childMessageData.message, messageStore, didResolverStub);

      expect(reply.status.code).to.equal(400);
      expect(reply.status.detail).to.contain('dateCreated is an immutable property');

      // schema test
      childMessageData = await TestDataGenerator.generateRecordsWriteMessage({
        requester: initialWriteData.requester,
        target: initialWriteData.target,
        recordId,
        schema: 'should-not-allowed-to-be-modified',
        dateCreated,
        dataFormat: initialWriteData.message.descriptor.dataFormat
      });

      reply = await handleRecordsWrite(childMessageData.message, messageStore, didResolverStub);

      expect(reply.status.code).to.equal(400);
      expect(reply.status.detail).to.contain('schema is an immutable property');

      // dataFormat test
      childMessageData = await TestDataGenerator.generateRecordsWriteMessage({
        requester: initialWriteData.requester,
        target: initialWriteData.target,
        recordId,
        schema,
        dateCreated,
        dataFormat: 'should-not-be-allowed-to-change'
      });

      reply = await handleRecordsWrite(childMessageData.message, messageStore, didResolverStub);

      expect(reply.status.code).to.equal(400);
      expect(reply.status.detail).to.contain('dataFormat is an immutable property');
    });

    describe('initial write tests', () => {
      describe('createFrom()', () => {
        it('should accept a publish RecordsWrite using createFrom() without specifying datePublished', async () => {
          const { message, requester, collectionsWrite } = await TestDataGenerator.generateRecordsWriteMessage({
            published: false
          });

          // setting up a stub DID resolver
          const didResolverStub = TestStubGenerator.createDidResolverStub(requester);
          const reply = await handleRecordsWrite(message, messageStore, didResolverStub);

          expect(reply.status.code).to.equal(202);

          const newWrite = await RecordsWrite.createFrom({
            target: requester.did,
            unsignedRecordsWriteMessage: collectionsWrite.message,
            published: true,
            signatureInput: TestDataGenerator.createSignatureInputFromPersona(requester)
          });

          const newWriteReply = await handleRecordsWrite(newWrite.message, messageStore, didResolverStub);

          expect(newWriteReply.status.code).to.equal(202);

          // verify the new record state can be queried
          const collectionsQueryMessageData = await TestDataGenerator.generateCollectionsQueryMessage({
            requester,
            target: requester,
            filter: { recordId: message.recordId }
          });

          const collectionsQueryReply = await handleCollectionsQuery(collectionsQueryMessageData.message, messageStore, didResolverStub);
          expect(collectionsQueryReply.status.code).to.equal(200);
          expect(collectionsQueryReply.entries?.length).to.equal(1);
          expect((collectionsQueryReply.entries![0] as RecordsWriteMessage).descriptor.published).to.equal(true);
        });

        it('should inherit parent published state when using createFrom() to create RecordsWrite', async () => {
          const { message, requester, collectionsWrite } = await TestDataGenerator.generateRecordsWriteMessage({
            published: true
          });

          // setting up a stub DID resolver
          const didResolverStub = TestStubGenerator.createDidResolverStub(requester);
          const reply = await handleRecordsWrite(message, messageStore, didResolverStub);

          expect(reply.status.code).to.equal(202);

          const newData = Encoder.stringToBytes('new data');
          const newWrite = await RecordsWrite.createFrom({
            target: requester.did,
            unsignedRecordsWriteMessage: collectionsWrite.message,
            data: newData,
            signatureInput: TestDataGenerator.createSignatureInputFromPersona(requester)
          });

          const newWriteReply = await handleRecordsWrite(newWrite.message, messageStore, didResolverStub);

          expect(newWriteReply.status.code).to.equal(202);

          // verify the new record state can be queried
          const collectionsQueryMessageData = await TestDataGenerator.generateCollectionsQueryMessage({
            requester,
            target: requester,
            filter: { recordId: message.recordId }
          });

          const collectionsQueryReply = await handleCollectionsQuery(collectionsQueryMessageData.message, messageStore, didResolverStub);
          expect(collectionsQueryReply.status.code).to.equal(200);
          expect(collectionsQueryReply.entries?.length).to.equal(1);

          const collectionsWriteReturned = collectionsQueryReply.entries![0] as RecordsWriteMessage;
          expect(collectionsWriteReturned.encodedData).to.equal(Encoder.bytesToBase64Url(newData));
          expect(collectionsWriteReturned.descriptor.published).to.equal(true);
          expect(collectionsWriteReturned.descriptor.datePublished).to.equal(message.descriptor.datePublished);
        });
      });

      it('should fail with 400 if modifying a record but its initial write cannot be found in DB', async () => {
        const recordId = await TestDataGenerator.randomCborSha256Cid();
        const { message, requester } = await TestDataGenerator.generateRecordsWriteMessage({
          recordId,
          data: Encoder.stringToBytes('anything') // simulating modification of a message
        });

        const didResolverStub = TestStubGenerator.createDidResolverStub(requester);
        const reply = await handleRecordsWrite(message, messageStore, didResolverStub);

        expect(reply.status.code).to.equal(400);
        expect(reply.status.detail).to.contain('initial write is not found');
      });

      it('should return 400 if `dateCreated` and `dateModified` are not the same in an initial write', async () => {
        const { requester, message } = await TestDataGenerator.generateRecordsWriteMessage({
          dateCreated: '2023-01-10T10:20:30.405060',
          dateModified: getCurrentTimeInHighPrecision() // this always generate a different timestamp
        });

        const didResolverStub = TestStubGenerator.createDidResolverStub(requester);
        const reply = await handleRecordsWrite(message, messageStore, didResolverStub);

        expect(reply.status.code).to.equal(400);
        expect(reply.status.detail).to.contain('must match dateCreated');
      });

      it('should return 400 if `contextId` in an initial protocol-base write mismatches with the expected deterministic `contextId`', async () => {
        // generate a message with protocol so that computed contextId is also computed and included in message
        const { message } = await TestDataGenerator.generateRecordsWriteMessage({ protocol: 'anyValue' });

        message.contextId = await TestDataGenerator.randomCborSha256Cid(); // make contextId mismatch from computed value

        const didResolverStub = sinon.createStubInstance(DidResolver);
        const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);

        const reply = await handleRecordsWrite(message, messageStoreStub, didResolverStub);
        expect(reply.status.code).to.equal(400);
        expect(reply.status.detail).to.contain('does not match deterministic contextId');
      });
    });

    describe('protocol based writes', () => {
      it('should allow write with allow-anyone rule', async () => {
        // scenario, Bob writes into Alice's DWN given Alice's "email" protocol allow-anyone rule

        // write a protocol definition with an allow-anyone rule
        const protocol = 'email-protocol';
        const protocolDefinition: ProtocolDefinition = {
          labels: {
            email: {
              schema: 'email'
            }
          },
          records: {
            email: {
              allow: {
                anyone: {
                  to: [
                    'write'
                  ]
                }
              }
            }
          }
        };
        const alice = await TestDataGenerator.generatePersona();

        const protocolsConfigureMessageData = await TestDataGenerator.generateProtocolsConfigureMessage({
          requester: alice,
          target: alice,
          protocol,
          protocolDefinition
        });

        // setting up a stub did resolver
        const aliceDidResolverStub = TestStubGenerator.createDidResolverStub(alice);

        const protocolWriteReply = await handleProtocolsConfigure(protocolsConfigureMessageData.message, messageStore, aliceDidResolverStub);
        expect(protocolWriteReply.status.code).to.equal(202);

        // generate a collections write message from bob allowed by anyone
        const bob = await TestDataGenerator.generatePersona();
        const bobData = new TextEncoder().encode('data from bob');
        const emailMessageDataFromBob = await TestDataGenerator.generateRecordsWriteMessage(
          {
            requester: bob,
            target: alice,
            protocol,
            schema: 'email',
            data: bobData
          }
        );

        const bobDidResolverStub = TestStubGenerator.createDidResolverStub(bob);

        const bobWriteReply = await handleRecordsWrite(emailMessageDataFromBob.message, messageStore, bobDidResolverStub);
        expect(bobWriteReply.status.code).to.equal(202);

        // verify bob's message got written to the DB
        const messageDataForQueryingBobsWrite = await TestDataGenerator.generateCollectionsQueryMessage({
          requester: alice,
          target: alice,
          filter: { recordId: emailMessageDataFromBob.message.recordId }
        });
        const bobRecordQueryReply = await handleCollectionsQuery(messageDataForQueryingBobsWrite.message, messageStore, aliceDidResolverStub);
        expect(bobRecordQueryReply.status.code).to.equal(200);
        expect(bobRecordQueryReply.entries?.length).to.equal(1);
        expect((bobRecordQueryReply.entries![0] as RecordsWriteMessage).encodedData).to.equal(base64url.baseEncode(bobData));
      });

      it('should allow write with recipient rule', async () => {
        // scenario: VC issuer writes into Alice's DWN an asynchronous credential response upon receiving Alice's credential application

        const protocol = 'https://identity.foundation/decentralized-web-node/protocols/credential-issuance';
        const protocolDefinition = credentialIssuanceProtocolDefinition;
        const credentialApplicationSchema = protocolDefinition.labels.credentialApplication.schema;
        const credentialResponseSchema = protocolDefinition.labels.credentialResponse.schema;

        const alice = await TestDataGenerator.generatePersona();

        const protocolsConfigureMessageData = await TestDataGenerator.generateProtocolsConfigureMessage({
          requester: alice,
          target: alice,
          protocol,
          protocolDefinition
        });

        // setting up a stub did resolver
        const aliceDidResolverStub = TestStubGenerator.createDidResolverStub(alice);

        const protocolWriteReply = await handleProtocolsConfigure(protocolsConfigureMessageData.message, messageStore, aliceDidResolverStub);
        expect(protocolWriteReply.status.code).to.equal(202);

        // write a credential application to Alice's DWN to simulate that she has sent a credential application to a VC issuer
        const vcIssuer = await TestDataGenerator.generatePersona();
        const encodedCredentialApplication = new TextEncoder().encode('credential application data');
        const credentialApplicationMessageData = await TestDataGenerator.generateRecordsWriteMessage({
          requester: alice,
          target: alice,
          recipientDid: vcIssuer.did,
          protocol,
          schema: credentialApplicationSchema,
          data: encodedCredentialApplication
        });
        const credentialApplicationContextId = await credentialApplicationMessageData.collectionsWrite.getEntryId();

        const credentialApplicationReply = await handleRecordsWrite(credentialApplicationMessageData.message, messageStore, aliceDidResolverStub);
        expect(credentialApplicationReply.status.code).to.equal(202);

        // generate a credential application response message from VC issuer
        const encodedCredentialResponse = new TextEncoder().encode('credential response data');
        const credentialResponseMessageData = await TestDataGenerator.generateRecordsWriteMessage(
          {
            requester: vcIssuer,
            target: alice,
            recipientDid: alice.did,
            protocol,
            contextId: credentialApplicationContextId,
            parentId: credentialApplicationContextId,
            schema: credentialResponseSchema,
            data: encodedCredentialResponse
          }
        );

        const vcIssuerDidResolverStub = TestStubGenerator.createDidResolverStub(vcIssuer);

        const credentialResponseReply = await handleRecordsWrite(credentialResponseMessageData.message, messageStore, vcIssuerDidResolverStub);
        expect(credentialResponseReply.status.code).to.equal(202);

        // verify VC issuer's message got written to the DB
        const messageDataForQueryingCredentialResponse = await TestDataGenerator.generateCollectionsQueryMessage({
          requester: alice,
          target: alice,
          filter: { recordId: credentialResponseMessageData.message.recordId }
        });
        const applicationResponseQueryReply = await handleCollectionsQuery(
          messageDataForQueryingCredentialResponse.message,
          messageStore,
          aliceDidResolverStub
        );
        expect(applicationResponseQueryReply.status.code).to.equal(200);
        expect(applicationResponseQueryReply.entries?.length).to.equal(1);
        expect((applicationResponseQueryReply.entries![0] as RecordsWriteMessage).encodedData)
          .to.equal(base64url.baseEncode(encodedCredentialResponse));
      });

      it('should allow overwriting records by the same author', async () => {
        // scenario: Bob writes into Alice's DWN given Alice's "notes" protocol allow-anyone rule, then modifies the note

        // write a protocol definition with an allow-anyone rule
        const protocol = 'notes-protocol';
        const protocolDefinition: ProtocolDefinition = {
          labels: {
            notes: {
              schema: 'notes'
            }
          },
          records: {
            notes: {
              allow: {
                anyone: {
                  to: [
                    'write'
                  ]
                }
              }
            }
          }
        };
        const alice = await TestDataGenerator.generatePersona();

        const protocolsConfigureMessageData = await TestDataGenerator.generateProtocolsConfigureMessage({
          requester: alice,
          target: alice,
          protocol,
          protocolDefinition
        });

        // setting up a stub did resolver
        const aliceDidResolverStub = TestStubGenerator.createDidResolverStub(alice);

        const protocolWriteReply = await handleProtocolsConfigure(protocolsConfigureMessageData.message, messageStore, aliceDidResolverStub);
        expect(protocolWriteReply.status.code).to.equal(202);

        // generate a collections write message from bob
        const bob = await TestDataGenerator.generatePersona();
        const bobData = new TextEncoder().encode('data from bob');
        const notesMessageDataFromBob = await TestDataGenerator.generateRecordsWriteMessage(
          {
            requester: bob,
            target: alice,
            protocol,
            schema: 'notes',
            data: bobData
          }
        );

        const bobDidResolverStub = TestStubGenerator.createDidResolverStub(bob);

        const bobWriteReply = await handleRecordsWrite(notesMessageDataFromBob.message, messageStore, bobDidResolverStub);
        expect(bobWriteReply.status.code).to.equal(202);

        // verify bob's message got written to the DB
        const messageDataForQueryingBobsWrite = await TestDataGenerator.generateCollectionsQueryMessage({
          requester: alice,
          target: alice,
          filter: { recordId: notesMessageDataFromBob.message.recordId }
        });
        const bobRecordQueryReply = await handleCollectionsQuery(messageDataForQueryingBobsWrite.message, messageStore, aliceDidResolverStub);
        expect(bobRecordQueryReply.status.code).to.equal(200);
        expect(bobRecordQueryReply.entries?.length).to.equal(1);
        expect((bobRecordQueryReply.entries![0] as RecordsWriteMessage).encodedData).to.equal(base64url.baseEncode(bobData));

        // generate a new message from bob updating the existing notes
        const newNotesBytes = Encoder.stringToBytes('new data from bob');
        const newNotesMessageFromBob = await TestDataGenerator.generateFromRecordsWrite({
          requester: bob,
          existingWrite: notesMessageDataFromBob.collectionsWrite,
          data: newNotesBytes
        });

        const newWriteReply = await handleRecordsWrite(newNotesMessageFromBob.message, messageStore, bobDidResolverStub);
        expect(newWriteReply.status.code).to.equal(202);

        // verify bob's message got written to the DB
        const newRecordQueryReply = await handleCollectionsQuery(messageDataForQueryingBobsWrite.message, messageStore, aliceDidResolverStub);
        expect(newRecordQueryReply.status.code).to.equal(200);
        expect(newRecordQueryReply.entries?.length).to.equal(1);
        expect((newRecordQueryReply.entries![0] as RecordsWriteMessage).encodedData).to.equal(Encoder.bytesToBase64Url(newNotesBytes));
      });

      it('should disallow overwriting existing records by a different author', async () => {
        // scenario: Bob writes into Alice's DWN given Alice's "notes" protocol allow-anyone rule, Carol then attempts to  modify the existing note

        // write a protocol definition with an allow-anyone rule
        const protocol = 'notes-protocol';
        const protocolDefinition: ProtocolDefinition = {
          labels: {
            notes: {
              schema: 'notes'
            }
          },
          records: {
            notes: {
              allow: {
                anyone: {
                  to: [
                    'write'
                  ]
                }
              }
            }
          }
        };
        const alice = await TestDataGenerator.generatePersona();

        const protocolsConfigureMessageData = await TestDataGenerator.generateProtocolsConfigureMessage({
          requester: alice,
          target: alice,
          protocol,
          protocolDefinition
        });

        // setting up a stub did resolver
        const aliceDidResolverStub = TestStubGenerator.createDidResolverStub(alice);

        const protocolWriteReply = await handleProtocolsConfigure(protocolsConfigureMessageData.message, messageStore, aliceDidResolverStub);
        expect(protocolWriteReply.status.code).to.equal(202);

        // generate a collections write message from bob
        const bob = await TestDataGenerator.generatePersona();
        const bobData = new TextEncoder().encode('data from bob');
        const notesMessageDataFromBob = await TestDataGenerator.generateRecordsWriteMessage(
          {
            requester: bob,
            target: alice,
            protocol,
            schema: 'notes',
            data: bobData
          }
        );

        const bobDidResolverStub = TestStubGenerator.createDidResolverStub(bob);

        const bobWriteReply = await handleRecordsWrite(notesMessageDataFromBob.message, messageStore, bobDidResolverStub);
        expect(bobWriteReply.status.code).to.equal(202);

        // verify bob's message got written to the DB
        const messageDataForQueryingBobsWrite = await TestDataGenerator.generateCollectionsQueryMessage({
          requester: alice,
          target: alice,
          filter: { recordId: notesMessageDataFromBob.message.recordId }
        });
        const bobRecordQueryReply = await handleCollectionsQuery(messageDataForQueryingBobsWrite.message, messageStore, aliceDidResolverStub);
        expect(bobRecordQueryReply.status.code).to.equal(200);
        expect(bobRecordQueryReply.entries?.length).to.equal(1);
        expect((bobRecordQueryReply.entries![0] as RecordsWriteMessage).encodedData).to.equal(base64url.baseEncode(bobData));

        // generate a new message from carol updating the existing notes, which should not be allowed/accepted
        const carol = await TestDataGenerator.generatePersona();
        const newNotesData = new TextEncoder().encode('different data by carol');
        const newNotesMessageDataFromBob = await TestDataGenerator.generateRecordsWriteMessage(
          {
            requester: carol,
            target: alice,
            protocol,
            schema: 'notes',
            data: newNotesData,
            recordId: notesMessageDataFromBob.message.recordId,
          }
        );

        const carolDidResolverStub = TestStubGenerator.createDidResolverStub(carol);
        const carolWriteReply = await handleRecordsWrite(newNotesMessageDataFromBob.message, messageStore, carolDidResolverStub);
        expect(carolWriteReply.status.code).to.equal(401);
        expect(carolWriteReply.status.detail).to.contain('must match to author of initial write');
      });

      it('should not allow to change immutable recipientDid', async () => {
        // scenario: Bob writes into Alice's DWN given Alice's "notes" protocol allow-anyone rule, then tries to modify immutable recipientDid

        // NOTE: no need to test the same for parent, protocol, and contextId
        // because changing them will result in other error conditions

        // write a protocol definition with an allow-anyone rule
        const protocol = 'notes-protocol';
        const protocolDefinition: ProtocolDefinition = {
          labels: {
            notes: {
              schema: 'notes'
            }
          },
          records: {
            notes: {
              allow: {
                anyone: {
                  to: [
                    'write'
                  ]
                }
              }
            }
          }
        };
        const alice = await TestDataGenerator.generatePersona();

        const protocolsConfigureMessageData = await TestDataGenerator.generateProtocolsConfigureMessage({
          requester: alice,
          target: alice,
          protocol,
          protocolDefinition
        });

        // setting up a stub did resolver
        const aliceDidResolverStub = TestStubGenerator.createDidResolverStub(alice);

        const protocolWriteReply = await handleProtocolsConfigure(protocolsConfigureMessageData.message, messageStore, aliceDidResolverStub);
        expect(protocolWriteReply.status.code).to.equal(202);

        // generate a collections write message from bob
        const bob = await TestDataGenerator.generatePersona();
        const bobData = new TextEncoder().encode('data from bob');
        const notesMessageDataFromBob = await TestDataGenerator.generateRecordsWriteMessage(
          {
            requester: bob,
            target: alice,
            protocol,
            schema: 'notes',
            data: bobData
          }
        );

        const bobDidResolverStub = TestStubGenerator.createDidResolverStub(bob);

        const bobWriteReply = await handleRecordsWrite(notesMessageDataFromBob.message, messageStore, bobDidResolverStub);
        expect(bobWriteReply.status.code).to.equal(202);

        // verify bob's message got written to the DB
        const messageDataForQueryingBobsWrite = await TestDataGenerator.generateCollectionsQueryMessage({
          requester: alice,
          target: alice,
          filter: { recordId: notesMessageDataFromBob.message.recordId }
        });
        const bobRecordQueryReply = await handleCollectionsQuery(messageDataForQueryingBobsWrite.message, messageStore, aliceDidResolverStub);
        expect(bobRecordQueryReply.status.code).to.equal(200);
        expect(bobRecordQueryReply.entries?.length).to.equal(1);
        expect((bobRecordQueryReply.entries![0] as RecordsWriteMessage).encodedData).to.equal(base64url.baseEncode(bobData));

        // generate a new message from bob changing immutable recipientDid
        const newNotesMessageDataFromBob = await TestDataGenerator.generateRecordsWriteMessage(
          {
            requester: bob,
            target: alice,
            protocol,
            schema: 'notes',
            data: bobData,
            recordId: notesMessageDataFromBob.message.recordId,
            recipientDid: bob.did // this immutable property was Alice's DID initially
          }
        );

        const newWriteReply = await handleRecordsWrite(newNotesMessageDataFromBob.message, messageStore, bobDidResolverStub);
        expect(newWriteReply.status.code).to.equal(400);
        expect(newWriteReply.status.detail).to.contain('recipient is an immutable property');
      });

      it('should block unauthorized write with recipient rule', async () => {
        // scenario: fake VC issuer attempts write into Alice's DWN a credential response
        // upon learning the ID of Alice's credential application to actual issuer

        const protocol = 'https://identity.foundation/decentralized-web-node/protocols/credential-issuance';
        const protocolDefinition = credentialIssuanceProtocolDefinition;
        const credentialApplicationSchema = protocolDefinition.labels.credentialApplication.schema;
        const credentialResponseSchema = protocolDefinition.labels.credentialResponse.schema;

        const alice = await TestDataGenerator.generatePersona();

        const protocolsConfigureMessageData = await TestDataGenerator.generateProtocolsConfigureMessage({
          requester: alice,
          target: alice,
          protocol,
          protocolDefinition
        });

        // setting up a stub did resolver
        const aliceDidResolverStub = TestStubGenerator.createDidResolverStub(alice);

        const protocolWriteReply = await handleProtocolsConfigure(protocolsConfigureMessageData.message, messageStore, aliceDidResolverStub);
        expect(protocolWriteReply.status.code).to.equal(202);

        // write a credential application to Alice's DWN to simulate that she has sent a credential application to a VC issuer
        const vcIssuer = await TestDataGenerator.generatePersona();
        const encodedCredentialApplication = new TextEncoder().encode('credential application data');
        const credentialApplicationMessageData = await TestDataGenerator.generateRecordsWriteMessage({
          requester: alice,
          target: alice,
          recipientDid: vcIssuer.did,
          protocol,
          schema: credentialApplicationSchema,
          data: encodedCredentialApplication
        });
        const credentialApplicationContextId = await credentialApplicationMessageData.collectionsWrite.getEntryId();

        const credentialApplicationReply = await handleRecordsWrite(credentialApplicationMessageData.message, messageStore, aliceDidResolverStub);
        expect(credentialApplicationReply.status.code).to.equal(202);

        // generate a credential application response message from a fake VC issuer
        const fakeVcIssuer = await TestDataGenerator.generatePersona();
        const encodedCredentialResponse = new TextEncoder().encode('credential response data');
        const credentialResponseMessageData = await TestDataGenerator.generateRecordsWriteMessage(
          {
            requester: fakeVcIssuer,
            target: alice,
            recipientDid: alice.did,
            protocol,
            contextId: credentialApplicationContextId,
            parentId: credentialApplicationContextId,
            schema: credentialResponseSchema,
            data: encodedCredentialResponse
          }
        );

        const vcIssuerDidResolverStub = TestStubGenerator.createDidResolverStub(fakeVcIssuer);

        const credentialResponseReply = await handleRecordsWrite(credentialResponseMessageData.message, messageStore, vcIssuerDidResolverStub);
        expect(credentialResponseReply.status.code).to.equal(401);
        expect(credentialResponseReply.status.detail).to.contain('unexpected inbound message author');
      });

      it('should fail authorization if protocol cannot be found for a protocol-based RecordsWrite', async () => {
        const alice = await DidKeyResolver.generate();
        const protocol = 'nonExistentProtocol';
        const data = Encoder.stringToBytes('any data');
        const credentialApplicationMessageData = await TestDataGenerator.generateRecordsWriteMessage({
          requester: alice,
          target: alice,
          recipientDid: alice.did,
          protocol,
          data
        });

        const reply = await handleRecordsWrite(credentialApplicationMessageData.message, messageStore, didResolver);
        expect(reply.status.code).to.equal(401);
        expect(reply.status.detail).to.contain('unable to find protocol definition');
      });

      it('should fail authorization if record schema is not an allowed type for protocol-based RecordsWrite', async () => {
        const alice = await DidKeyResolver.generate();

        const protocol = 'https://identity.foundation/decentralized-web-node/protocols/credential-issuance';
        const protocolConfigureMessageData = await TestDataGenerator.generateProtocolsConfigureMessage({
          target: alice,
          requester: alice,
          protocol,
          protocolDefinition: credentialIssuanceProtocolDefinition
        });

        const protocolConfigureReply = await handleProtocolsConfigure(protocolConfigureMessageData.message, messageStore, didResolver);
        expect(protocolConfigureReply.status.code).to.equal(202);

        const data = Encoder.stringToBytes('any data');
        const credentialApplicationMessageData = await TestDataGenerator.generateRecordsWriteMessage({
          requester: alice,
          target: alice,
          recipientDid: alice.did,
          protocol,
          schema: 'unexpectedSchema',
          data
        });

        const reply = await handleRecordsWrite(credentialApplicationMessageData.message, messageStore, didResolver);
        expect(reply.status.code).to.equal(401);
        expect(reply.status.detail).to.equal('record with schema \'unexpectedSchema\' not allowed in protocol');
      });

      it('should fail authorization if record schema is not allowed at the hierarchical level attempted for the RecordsWrite', async () => {
        const alice = await DidKeyResolver.generate();

        const protocol = 'https://identity.foundation/decentralized-web-node/protocols/credential-issuance';
        const protocolDefinition = credentialIssuanceProtocolDefinition;
        const protocolConfigureMessageData = await TestDataGenerator.generateProtocolsConfigureMessage({
          target: alice,
          requester: alice,
          protocol,
          protocolDefinition
        });
        const credentialResponseSchema = protocolDefinition.labels.credentialResponse.schema;

        const protocolConfigureReply = await handleProtocolsConfigure(protocolConfigureMessageData.message, messageStore, didResolver);
        expect(protocolConfigureReply.status.code).to.equal(202);

        const data = Encoder.stringToBytes('any data');
        const credentialApplicationMessageData = await TestDataGenerator.generateRecordsWriteMessage({
          requester: alice,
          target: alice,
          recipientDid: alice.did,
          protocol,
          schema: credentialResponseSchema, // this is an known schema type, but not allowed for a protocol root record
          data
        });

        const reply = await handleRecordsWrite(credentialApplicationMessageData.message, messageStore, didResolver);
        expect(reply.status.code).to.equal(401);
        expect(reply.status.detail).to.contain('not allowed in structure level');
      });

      it('should only allow DWN owner to write if record does not have an allow rule defined', async () => {
        const alice = await DidKeyResolver.generate();

        // write a protocol definition without an explicit allow rule
        const protocol = 'private-protocol';
        const protocolDefinition: ProtocolDefinition = {
          labels: {
            privateNote: {
              schema: 'private-note'
            }
          },
          records: {
            privateNote: {}
          }
        };
        const protocolConfigureMessageData = await TestDataGenerator.generateProtocolsConfigureMessage({
          target: alice,
          requester: alice,
          protocol,
          protocolDefinition
        });

        const protocolConfigureReply = await handleProtocolsConfigure(protocolConfigureMessageData.message, messageStore, didResolver);
        expect(protocolConfigureReply.status.code).to.equal(202);

        // test that Alice is allowed to write to her own DWN
        const data = Encoder.stringToBytes('any data');
        const aliceWriteMessageData = await TestDataGenerator.generateRecordsWriteMessage({
          requester: alice,
          target: alice,
          recipientDid: alice.did,
          protocol,
          schema: 'private-note',
          data
        });

        let reply = await handleRecordsWrite(aliceWriteMessageData.message, messageStore, didResolver);
        expect(reply.status.code).to.equal(202);

        // test that Bob is not allowed to write to Alice's DWN
        const bob = await DidKeyResolver.generate();
        const bobWriteMessageData = await TestDataGenerator.generateRecordsWriteMessage({
          requester: bob,
          target: alice,
          recipientDid: alice.did,
          protocol,
          schema: 'private-note',
          data
        });

        reply = await handleRecordsWrite(bobWriteMessageData.message, messageStore, didResolver);
        expect(reply.status.code).to.equal(401);
        expect(reply.status.detail).to.contain('no allow rule defined for requester');
      });

      it('should fail authorization if path to expected recipient in definition is longer than actual length of ancestor message chain', async () => {
        const alice = await DidKeyResolver.generate();
        const issuer = await DidKeyResolver.generate();

        // create an invalid ancestor path that is longer than possible
        const invalidProtocolDefinition = { ...credentialIssuanceProtocolDefinition };
        invalidProtocolDefinition.records.credentialApplication.records.credentialResponse.allow.recipient.of
          = 'credentialApplication/credentialResponse'; // this is invalid as the ancestor can only be just `credentialApplication`

        // write the VC issuance protocol
        const protocol = 'https://identity.foundation/decentralized-web-node/protocols/credential-issuance';
        const protocolConfigureMessageData = await TestDataGenerator.generateProtocolsConfigureMessage({
          target: alice,
          requester: alice,
          protocol,
          protocolDefinition: invalidProtocolDefinition
        });

        const protocolConfigureReply = await handleProtocolsConfigure(protocolConfigureMessageData.message, messageStore, didResolver);
        expect(protocolConfigureReply.status.code).to.equal(202);

        // simulate Alice's VC applications with both issuer
        const data = Encoder.stringToBytes('irrelevant');
        const messageDataWithIssuerA = await TestDataGenerator.generateRecordsWriteMessage({
          requester: alice,
          target: alice,
          recipientDid: issuer.did,
          schema: credentialIssuanceProtocolDefinition.labels.credentialApplication.schema,
          protocol,
          data
        });
        const contextId = await messageDataWithIssuerA.collectionsWrite.getEntryId();

        let reply = await handleRecordsWrite(messageDataWithIssuerA.message, messageStore, didResolver);
        expect(reply.status.code).to.equal(202);

        // simulate issuer attempting to respond to Alice's VC application
        const invalidResponseDataByIssuerA = await TestDataGenerator.generateRecordsWriteMessage({
          requester: issuer,
          target: alice,
          recipientDid: alice.did,
          schema: credentialIssuanceProtocolDefinition.labels.credentialResponse.schema,
          contextId,
          parentId: messageDataWithIssuerA.message.recordId,
          protocol,
          data
        });

        reply = await handleRecordsWrite(invalidResponseDataByIssuerA.message, messageStore, didResolver);
        expect(reply.status.code).to.equal(401);
        expect(reply.status.detail).to.contain('path to expected recipient is longer than actual length of ancestor message chain');
      });

      it('should fail authorization if path to expected recipient in definition has incorrect label', async () => {
        const alice = await DidKeyResolver.generate();
        const issuer = await DidKeyResolver.generate();

        // create an invalid ancestor path that is longer than possible
        const invalidProtocolDefinition = { ...credentialIssuanceProtocolDefinition };
        invalidProtocolDefinition.records.credentialApplication.records.credentialResponse.allow.recipient.of
          = 'credentialResponse'; // this is invalid as the root ancestor can only be `credentialApplication` based on record structure

        // write the VC issuance protocol
        const protocol = 'https://identity.foundation/decentralized-web-node/protocols/credential-issuance';
        const protocolConfigureMessageData = await TestDataGenerator.generateProtocolsConfigureMessage({
          target: alice,
          requester: alice,
          protocol,
          protocolDefinition: invalidProtocolDefinition
        });

        const protocolConfigureReply = await handleProtocolsConfigure(protocolConfigureMessageData.message, messageStore, didResolver);
        expect(protocolConfigureReply.status.code).to.equal(202);

        // simulate Alice's VC application to an issuer
        const data = Encoder.stringToBytes('irrelevant');
        const messageDataWithIssuerA = await TestDataGenerator.generateRecordsWriteMessage({
          requester: alice,
          target: alice,
          recipientDid: issuer.did,
          schema: credentialIssuanceProtocolDefinition.labels.credentialApplication.schema,
          protocol,
          data
        });
        const contextId = await messageDataWithIssuerA.collectionsWrite.getEntryId();

        let reply = await handleRecordsWrite(messageDataWithIssuerA.message, messageStore, didResolver);
        expect(reply.status.code).to.equal(202);

        // simulate issuer attempting to respond to Alice's VC application
        const invalidResponseDataByIssuerA = await TestDataGenerator.generateRecordsWriteMessage({
          requester: issuer,
          target: alice,
          recipientDid: alice.did,
          schema: credentialIssuanceProtocolDefinition.labels.credentialResponse.schema,
          contextId,
          parentId: messageDataWithIssuerA.message.recordId,
          protocol,
          data
        });

        reply = await handleRecordsWrite(invalidResponseDataByIssuerA.message, messageStore, didResolver);
        expect(reply.status.code).to.equal(401);
        expect(reply.status.detail).to.contain('mismatching record schema');
      });

      it('should look up recipient path with ancestor depth of 2+ (excluding self) in allow rule correctly', async () => {
        // simulate a DEX protocol with at least 3 layers of message exchange: ask -> offer -> fulfillment
        // make sure recipient of offer can send fulfillment

        const alice = await DidKeyResolver.generate();
        const pfi = await DidKeyResolver.generate();

        // write a DEX protocol definition
        const protocol = 'dex-protocol';
        const protocolDefinition: ProtocolDefinition = dexProtocolDefinition;

        // write the DEX protocol in the PFI
        const protocolConfigureMessageData = await TestDataGenerator.generateProtocolsConfigureMessage({
          target: pfi,
          requester: pfi,
          protocol,
          protocolDefinition: protocolDefinition
        });

        const protocolConfigureReply = await handleProtocolsConfigure(protocolConfigureMessageData.message, messageStore, didResolver);
        expect(protocolConfigureReply.status.code).to.equal(202);

        // simulate Alice's ask and PFI's offer already occurred
        const data = Encoder.stringToBytes('irrelevant');
        const askMessageData = await TestDataGenerator.generateRecordsWriteMessage({
          requester: alice,
          target: pfi,
          recipientDid: pfi.did,
          schema: 'ask',
          protocol,
          data
        });
        const contextId = await askMessageData.collectionsWrite.getEntryId();

        let reply = await handleRecordsWrite(askMessageData.message, messageStore, didResolver);
        expect(reply.status.code).to.equal(202);

        const offerMessageData = await TestDataGenerator.generateRecordsWriteMessage({
          requester: pfi,
          target: pfi,
          recipientDid: alice.did,
          schema: 'offer',
          contextId,
          parentId: askMessageData.message.recordId,
          protocol,
          data
        });

        reply = await handleRecordsWrite(offerMessageData.message, messageStore, didResolver);
        expect(reply.status.code).to.equal(202);

        // the actual test: making sure fulfillment message is accepted
        const fulfillmentMessageData = await TestDataGenerator.generateRecordsWriteMessage({
          requester: alice,
          target: pfi,
          recipientDid: pfi.did,
          schema: 'fulfillment',
          contextId,
          parentId: offerMessageData.message.recordId,
          protocol,
          data
        });
        reply = await handleRecordsWrite(fulfillmentMessageData.message, messageStore, didResolver);
        expect(reply.status.code).to.equal(202);

        // verify the fulfillment message is stored
        const collectionsQueryMessageData = await TestDataGenerator.generateCollectionsQueryMessage({
          requester: pfi,
          target: pfi,
          filter: { recordId: fulfillmentMessageData.message.recordId }
        });

        // verify the data is written
        const collectionsQueryReply = await handleCollectionsQuery(collectionsQueryMessageData.message, messageStore, didResolver);
        expect(collectionsQueryReply.status.code).to.equal(200);
        expect(collectionsQueryReply.entries?.length).to.equal(1);
        expect((collectionsQueryReply.entries![0] as RecordsWriteMessage).descriptor.dataCid)
          .to.equal(fulfillmentMessageData.message.descriptor.dataCid);
      });

      it('should fail authorization if incoming message contains `parentId` that leads to no record', async () => {
        // 1. DEX protocol with at least 3 layers of message exchange: ask -> offer -> fulfillment
        // 2. Alice sends an ask to a PFI
        // 3. Alice sends a fulfillment to an non-existent offer to the PFI

        const alice = await DidKeyResolver.generate();
        const pfi = await DidKeyResolver.generate();

        // write a DEX protocol definition
        const protocol = 'dex-protocol';
        const protocolDefinition: ProtocolDefinition = dexProtocolDefinition;

        // write the DEX protocol in the PFI
        const protocolConfigureMessageData = await TestDataGenerator.generateProtocolsConfigureMessage({
          target: pfi,
          requester: pfi,
          protocol,
          protocolDefinition: protocolDefinition
        });

        const protocolConfigureReply = await handleProtocolsConfigure(protocolConfigureMessageData.message, messageStore, didResolver);
        expect(protocolConfigureReply.status.code).to.equal(202);

        // simulate Alice's ask
        const data = Encoder.stringToBytes('irrelevant');
        const askMessageData = await TestDataGenerator.generateRecordsWriteMessage({
          requester: alice,
          target: pfi,
          recipientDid: pfi.did,
          schema: 'ask',
          protocol,
          data
        });
        const contextId = await askMessageData.collectionsWrite.getEntryId();

        let reply = await handleRecordsWrite(askMessageData.message, messageStore, didResolver);
        expect(reply.status.code).to.equal(202);

        // the actual test: making sure fulfillment message fails
        const fulfillmentMessageData = await TestDataGenerator.generateRecordsWriteMessage({
          requester: alice,
          target: pfi,
          recipientDid: pfi.did,
          schema: 'fulfillment',
          contextId,
          parentId: 'non-existent-id',
          protocol,
          data
        });
        reply = await handleRecordsWrite(fulfillmentMessageData.message, messageStore, didResolver);
        expect(reply.status.code).to.equal(401);
        expect(reply.status.detail).to.contain('no parent found');
      });
    });
  });

  it('should return 400 if `recordId` in `authorization` payload mismatches with `recordId` in the message', async () => {
    const { requester, message, collectionsWrite } = await TestDataGenerator.generateRecordsWriteMessage();

    // replace `authorization` with mismatching `record`, even though signature is still valid
    const authorizationPayload = { ...collectionsWrite.authorizationPayload };
    authorizationPayload.recordId = await TestDataGenerator.randomCborSha256Cid(); // make recordId mismatch in authorization payload
    const authorizationPayloadBytes = Encoder.objectToBytes(authorizationPayload);
    const signatureInput = TestDataGenerator.createSignatureInputFromPersona(requester);
    const signer = await GeneralJwsSigner.create(authorizationPayloadBytes, [signatureInput]);
    message.authorization = signer.getJws();

    const didResolverStub = TestStubGenerator.createDidResolverStub(requester);
    const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);
    const reply = await handleRecordsWrite(message, messageStoreStub, didResolverStub);

    expect(reply.status.code).to.equal(400);
    expect(reply.status.detail).to.contain('does not match recordId in authorization');
  });

  it('should return 400 if `contextId` in `authorization` payload mismatches with `contextId` in the message', async () => {
    // generate a message with protocol so that computed contextId is also computed and included in message
    const { requester, message, collectionsWrite } = await TestDataGenerator.generateRecordsWriteMessage({ protocol: 'anyValue' });

    // replace `authorization` with mismatching `contextId`, even though signature is still valid
    const authorizationPayload = { ...collectionsWrite.authorizationPayload };
    authorizationPayload.contextId = await TestDataGenerator.randomCborSha256Cid(); // make contextId mismatch in authorization payload
    const authorizationPayloadBytes = Encoder.objectToBytes(authorizationPayload);
    const signatureInput = TestDataGenerator.createSignatureInputFromPersona(requester);
    const signer = await GeneralJwsSigner.create(authorizationPayloadBytes, [signatureInput]);
    message.authorization = signer.getJws();

    const didResolverStub = sinon.createStubInstance(DidResolver);
    const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);
    const reply = await handleRecordsWrite(message, messageStoreStub, didResolverStub);

    expect(reply.status.code).to.equal(400);
    expect(reply.status.detail).to.contain('does not match contextId in authorization');
  });

  it('should return 400 if actual CID of `data` mismatches with `dataCid` in descriptor', async () => {
    const messageData = await TestDataGenerator.generateRecordsWriteMessage();
    messageData.message.encodedData = base64url.baseEncode(TestDataGenerator.randomBytes(50));

    const didResolverStub = sinon.createStubInstance(DidResolver);
    const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);

    const reply = await handleRecordsWrite(messageData.message, messageStoreStub, didResolverStub);

    expect(reply.status.code).to.equal(400);
    expect(reply.status.detail).to.equal('actual CID of data and `dataCid` in descriptor mismatch');
  });

  it('should return 401 if signature check fails', async () => {
    const { requester, message } = await TestDataGenerator.generateRecordsWriteMessage();

    // setting up a stub did resolver & message store
    // intentionally not supplying the public key so a different public key is generated to simulate invalid signature
    const mismatchingPersona = await TestDataGenerator.generatePersona({ did: requester.did, keyId: requester.keyId });
    const didResolverStub = TestStubGenerator.createDidResolverStub(mismatchingPersona);

    const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);

    const reply = await handleRecordsWrite(message, messageStoreStub, didResolverStub);

    expect(reply.status.code).to.equal(401);
  });

  it('should return 401 if an authorized requester is attempting write', async () => {
    const requester = await TestDataGenerator.generatePersona();
    const target = await TestDataGenerator.generatePersona();
    const { message } = await TestDataGenerator.generateRecordsWriteMessage({ requester, target });

    // setting up a stub did resolver & message store
    const didResolverStub = TestStubGenerator.createDidResolverStub(requester);
    const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);

    const reply = await handleRecordsWrite(message, messageStoreStub, didResolverStub);

    expect(reply.status.code).to.equal(401);
  });
});

