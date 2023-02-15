import chaiAsPromised from 'chai-as-promised';
import credentialIssuanceProtocolDefinition from '../../../vectors/protocol-definitions/credential-issuance.json' assert { type: 'json' };
import dexProtocolDefinition from '../../../vectors/protocol-definitions/dex.json' assert { type: 'json' };
import sinon from 'sinon';
import chai, { expect } from 'chai';

import { base64url } from 'multiformats/bases/base64';
import { computeCid } from '../../../../src/utils/cid.js';
import { DataStream } from '../../../../src/utils/data-stream.js';
import { DidKeyResolver } from '../../../../src/did/did-key-resolver.js';
import { DidResolver } from '../../../../src/did/did-resolver.js';
import { DwnErrorCode } from '../../../../src/core/dwn-error.js';
import { Encoder } from '../../../../src/utils/encoder.js';
import { GeneralJwsSigner } from '../../../../src/jose/jws/general/signer.js';
import { getCurrentTimeInHighPrecision } from '../../../../src/utils/time.js';
import { handleProtocolsConfigure } from '../../../../src/interfaces/protocols/handlers/protocols-configure.js';
import { handleRecordsQuery } from '../../../../src/interfaces/records/handlers/records-query.js';
import { handleRecordsWrite } from '../../../../src/interfaces/records/handlers/records-write.js';
import { Message } from '../../../../src/core/message.js';
import { MessageStoreLevel } from '../../../../src/store/message-store-level.js';
import { RecordsWriteMessage } from '../../../../src/interfaces/records/types.js';
import { TestStubGenerator } from '../../../utils/test-stub-generator.js';

import { GenerateFromRecordsWriteOut, TestDataGenerator } from '../../../utils/test-data-generator.js';
import { Jws, ProtocolDefinition, RecordsWrite } from '../../../../src/index.js';

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

    it('should only be able to overwrite existing record if new record has a later `dateModified` value', async () => {
      // write a message into DB
      const requester = await DidKeyResolver.generate();
      const data1 = new TextEncoder().encode('data1');
      const recordsWriteMessageData = await TestDataGenerator.generateRecordsWrite({ requester, data: data1 });

      const didResolver = new DidResolver();

      const tenant = requester.did;
      const recordsWriteReply = await handleRecordsWrite({
        tenant, message: recordsWriteMessageData.message, messageStore, didResolver, dataStream: recordsWriteMessageData.dataStream
      });
      expect(recordsWriteReply.status.code).to.equal(202);

      const recordId = recordsWriteMessageData.message.recordId;
      const recordsQueryMessageData = await TestDataGenerator.generateRecordsQuery({
        requester,
        filter: { recordId }
      });

      // verify the message written can be queried
      const recordsQueryReply = await handleRecordsQuery({ tenant, message: recordsQueryMessageData.message, messageStore, didResolver });
      expect(recordsQueryReply.status.code).to.equal(200);
      expect(recordsQueryReply.entries?.length).to.equal(1);
      expect((recordsQueryReply.entries![0] as any).encodedData).to.equal(base64url.baseEncode(data1));

      // generate and write a new RecordsWrite to overwrite the existing record
      // a new RecordsWrite by default will have a later `dateModified`
      const newDataBytes = Encoder.stringToBytes('new data');
      const newDataEncoded = Encoder.bytesToBase64Url(newDataBytes);
      const newRecordsWrite = await TestDataGenerator.generateFromRecordsWrite({
        requester,
        existingWrite : recordsWriteMessageData.recordsWrite,
        data          : newDataBytes
      });

      // sanity check that old data and new data are different
      expect(newDataEncoded).to.not.equal(Encoder.bytesToBase64Url(recordsWriteMessageData.dataBytes));

      const newRecordsWriteReply = await handleRecordsWrite({
        tenant, message: newRecordsWrite.message, messageStore, didResolver, dataStream: newRecordsWrite.dataStream
      });
      expect(newRecordsWriteReply.status.code).to.equal(202);

      // verify new record has overwritten the existing record
      const newRecordsQueryReply = await handleRecordsQuery({ tenant, message: recordsQueryMessageData.message, messageStore, didResolver });

      expect(newRecordsQueryReply.status.code).to.equal(200);
      expect(newRecordsQueryReply.entries?.length).to.equal(1);
      expect((newRecordsQueryReply.entries![0] as any).encodedData).to.equal(newDataEncoded);

      // try to write the older message to store again and verify that it is not accepted
      const thirdRecordsWriteReply = await handleRecordsWrite({
        tenant, message: recordsWriteMessageData.message, messageStore, didResolver, dataStream: recordsWriteMessageData.dataStream
      });
      expect(thirdRecordsWriteReply.status.code).to.equal(409); // expecting to fail

      // expecting unchanged
      const thirdRecordsQueryReply = await handleRecordsQuery({ tenant, message: recordsQueryMessageData.message, messageStore, didResolver });
      expect(thirdRecordsQueryReply.status.code).to.equal(200);
      expect(thirdRecordsQueryReply.entries?.length).to.equal(1);
      expect((thirdRecordsQueryReply.entries![0] as any).encodedData).to.equal(newDataEncoded);
    });

    it('should only be able to overwrite existing record if new message CID is larger when `dateModified` value is the same', async () => {
      // start by writing an originating message
      const requester = await TestDataGenerator.generatePersona();
      const tenant = requester.did;
      const originatingMessageData = await TestDataGenerator.generateRecordsWrite({
        requester,
        data: Encoder.stringToBytes('unused')
      });

      // setting up a stub did resolver
      const didResolver = TestStubGenerator.createDidResolverStub(requester);

      const originatingMessageWriteReply = await handleRecordsWrite({
        tenant, message: originatingMessageData.message, messageStore, didResolver, dataStream: originatingMessageData.dataStream
      });
      expect(originatingMessageWriteReply.status.code).to.equal(202);

      // generate two new RecordsWrite messages with the same `dateModified` value
      const dateModified = getCurrentTimeInHighPrecision();
      const recordsWrite1 = await TestDataGenerator.generateFromRecordsWrite({
        requester,
        existingWrite: originatingMessageData.recordsWrite,
        dateModified
      });
      const recordsWrite2 = await TestDataGenerator.generateFromRecordsWrite({
        requester,
        existingWrite: originatingMessageData.recordsWrite,
        dateModified
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
      const recordsWriteReply = await handleRecordsWrite({
        tenant, message: olderWrite.message, messageStore, didResolver, dataStream: olderWrite.dataStream
      });
      expect(recordsWriteReply.status.code).to.equal(202);

      // query to fetch the record
      const recordsQueryMessageData = await TestDataGenerator.generateRecordsQuery({
        requester,
        filter: { recordId: originatingMessageData.message.recordId }
      });

      // verify the data is written
      const recordsQueryReply = await handleRecordsQuery({ tenant, message: recordsQueryMessageData.message, messageStore, didResolver });
      expect(recordsQueryReply.status.code).to.equal(200);
      expect(recordsQueryReply.entries?.length).to.equal(1);
      expect((recordsQueryReply.entries![0] as RecordsWriteMessage).descriptor.dataCid)
        .to.equal(olderWrite.message.descriptor.dataCid);

      // attempt to write the message with larger lexicographical message CID
      const newRecordsWriteReply = await handleRecordsWrite({
        tenant, message: newerWrite.message, messageStore, didResolver, dataStream: newerWrite.dataStream
      });
      expect(newRecordsWriteReply.status.code).to.equal(202);

      // verify new record has overwritten the existing record
      const newRecordsQueryReply = await handleRecordsQuery({ tenant, message: recordsQueryMessageData.message, messageStore, didResolver });
      expect(newRecordsQueryReply.status.code).to.equal(200);
      expect(newRecordsQueryReply.entries?.length).to.equal(1);
      expect((newRecordsQueryReply.entries![0] as RecordsWriteMessage).descriptor.dataCid)
        .to.equal(newerWrite.message.descriptor.dataCid);

      // try to write the message with smaller lexicographical message CID again
      const thirdRecordsWriteReply = await handleRecordsWrite({
        tenant,
        message    : olderWrite.message,
        messageStore,
        didResolver,
        dataStream : DataStream.fromBytes(olderWrite.dataBytes) // need to create data stream again since it's already used above
      });
      expect(thirdRecordsWriteReply.status.code).to.equal(409); // expecting to fail

      // verify the message in store is still the one with larger lexicographical message CID
      const thirdRecordsQueryReply = await handleRecordsQuery({ tenant, message: recordsQueryMessageData.message, messageStore, didResolver });
      expect(thirdRecordsQueryReply.status.code).to.equal(200);
      expect(thirdRecordsQueryReply.entries?.length).to.equal(1);
      expect((thirdRecordsQueryReply.entries![0] as RecordsWriteMessage).descriptor.dataCid)
        .to.equal(newerWrite.message.descriptor.dataCid); // expecting unchanged
    });

    it('should not allow changes to immutable properties', async () => {
      const initialWriteData = await TestDataGenerator.generateRecordsWrite();
      const tenant = initialWriteData.requester.did;
      const didResolver = TestStubGenerator.createDidResolverStub(initialWriteData.requester);
      const initialWriteReply = await handleRecordsWrite({
        tenant, message: initialWriteData.message, messageStore, didResolver, dataStream: initialWriteData.dataStream
      });
      expect(initialWriteReply.status.code).to.equal(202);

      const recordId = initialWriteData.message.recordId;
      const dateCreated = initialWriteData.message.descriptor.dateCreated;
      const schema = initialWriteData.message.descriptor.schema;

      // dateCreated test
      let childMessageData = await TestDataGenerator.generateRecordsWrite({
        requester   : initialWriteData.requester,
        recordId,
        schema,
        dateCreated : getCurrentTimeInHighPrecision(), // should not be allowed to be modified
        dataFormat  : initialWriteData.message.descriptor.dataFormat
      });

      let reply = await handleRecordsWrite({
        tenant, message: childMessageData.message, messageStore, didResolver, dataStream: childMessageData.dataStream
      });

      expect(reply.status.code).to.equal(400);
      expect(reply.status.detail).to.contain('dateCreated is an immutable property');

      // schema test
      childMessageData = await TestDataGenerator.generateRecordsWrite({
        requester  : initialWriteData.requester,
        recordId,
        schema     : 'should-not-allowed-to-be-modified',
        dateCreated,
        dataFormat : initialWriteData.message.descriptor.dataFormat
      });

      reply = await handleRecordsWrite({
        tenant, message: childMessageData.message, messageStore, didResolver, dataStream: childMessageData.dataStream
      });

      expect(reply.status.code).to.equal(400);
      expect(reply.status.detail).to.contain('schema is an immutable property');

      // dataFormat test
      childMessageData = await TestDataGenerator.generateRecordsWrite({
        requester  : initialWriteData.requester,
        recordId,
        schema,
        dateCreated,
        dataFormat : 'should-not-be-allowed-to-change'
      });

      reply = await handleRecordsWrite({
        tenant, message: childMessageData.message, messageStore, didResolver, dataStream: childMessageData.dataStream
      });

      expect(reply.status.code).to.equal(400);
      expect(reply.status.detail).to.contain('dataFormat is an immutable property');
    });

    it('should return 400 if actual data CID of mismatches with `dataCid` in descriptor', async () => {
      const alice = await DidKeyResolver.generate();
      const { message } = await TestDataGenerator.generateRecordsWrite({ requester: alice });
      const dataStream = DataStream.fromBytes(Encoder.stringToBytes('mismatching data stream')); // mismatch data stream

      const reply = await handleRecordsWrite({ tenant: alice.did, message, messageStore, didResolver, dataStream });
      expect(reply.status.code).to.equal(400);
      expect(reply.status.detail).to.contain('does not match dataCid in descriptor');
    });

    it('should return 400 if attempting to write a record without data stream and the data does not already exist in DWN', async () => {
      const alice = await DidKeyResolver.generate();

      const { message } = await TestDataGenerator.generateRecordsWrite({
        requester: alice,
      });

      const reply = await handleRecordsWrite({ tenant: alice.did, message, messageStore, didResolver });

      expect(reply.status.code).to.equal(400);
      expect(reply.status.detail).to.contain(DwnErrorCode.MessageStoreDataNotFound);
    });

    describe('initial write & subsequent write tests', () => {
      describe('createFrom()', () => {
        it('should accept a published RecordsWrite using createFrom() without specifying `data` or `datePublished`', async () => {
          const { message, requester, recordsWrite, dataStream, dataBytes } = await TestDataGenerator.generateRecordsWrite({
            published: false
          });
          const tenant = requester.did;

          // setting up a stub DID resolver
          const didResolver = TestStubGenerator.createDidResolverStub(requester);
          const reply = await handleRecordsWrite({ tenant, message, messageStore, didResolver, dataStream });

          expect(reply.status.code).to.equal(202);

          const newWrite = await RecordsWrite.createFrom({
            unsignedRecordsWriteMessage : recordsWrite.message,
            published                   : true,
            authorizationSignatureInput : Jws.createSignatureInput(requester)
          });

          const newWriteReply = await handleRecordsWrite({ tenant, message: newWrite.message, messageStore, didResolver });

          expect(newWriteReply.status.code).to.equal(202);

          // verify the new record state can be queried
          const recordsQueryMessageData = await TestDataGenerator.generateRecordsQuery({
            requester,
            filter: { recordId: message.recordId }
          });

          const recordsQueryReply = await handleRecordsQuery({ tenant, message: recordsQueryMessageData.message, messageStore, didResolver });
          expect(recordsQueryReply.status.code).to.equal(200);
          expect(recordsQueryReply.entries?.length).to.equal(1);
          expect((recordsQueryReply.entries![0] as RecordsWriteMessage).descriptor.published).to.equal(true);

          // very importantly verify the original data is still returned
          expect((recordsQueryReply.entries![0] as any).encodedData).to.equal(Encoder.bytesToBase64Url(dataBytes));
        });

        it('should inherit parent published state when using createFrom() to create RecordsWrite', async () => {
          const { message, requester, recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite({
            published: true
          });
          const tenant = requester.did;

          // setting up a stub DID resolver
          const didResolver = TestStubGenerator.createDidResolverStub(requester);
          const reply = await handleRecordsWrite({ tenant, message, messageStore, didResolver, dataStream });

          expect(reply.status.code).to.equal(202);

          const newData = Encoder.stringToBytes('new data');
          const newWrite = await RecordsWrite.createFrom({
            unsignedRecordsWriteMessage : recordsWrite.message,
            data                        : newData,
            authorizationSignatureInput : Jws.createSignatureInput(requester)
          });

          const newWriteReply = await handleRecordsWrite({
            tenant, message: newWrite.message, messageStore, didResolver, dataStream: DataStream.fromBytes(newData)
          });

          expect(newWriteReply.status.code).to.equal(202);

          // verify the new record state can be queried
          const recordsQueryMessageData = await TestDataGenerator.generateRecordsQuery({
            requester,
            filter: { recordId: message.recordId }
          });

          const recordsQueryReply = await handleRecordsQuery({ tenant, message: recordsQueryMessageData.message, messageStore, didResolver });
          expect(recordsQueryReply.status.code).to.equal(200);
          expect(recordsQueryReply.entries?.length).to.equal(1);

          const recordsWriteReturned = recordsQueryReply.entries![0] as RecordsWriteMessage;
          expect((recordsWriteReturned as any).encodedData).to.equal(Encoder.bytesToBase64Url(newData));
          expect(recordsWriteReturned.descriptor.published).to.equal(true);
          expect(recordsWriteReturned.descriptor.datePublished).to.equal(message.descriptor.datePublished);
        });
      });

      it('should fail with 400 if modifying a record but its initial write cannot be found in DB', async () => {
        const recordId = await TestDataGenerator.randomCborSha256Cid();
        const { message, requester, dataStream } = await TestDataGenerator.generateRecordsWrite({
          recordId,
          data: Encoder.stringToBytes('anything') // simulating modification of a message
        });
        const tenant = requester.did;

        const didResolver = TestStubGenerator.createDidResolverStub(requester);
        const reply = await handleRecordsWrite({ tenant, message, messageStore, didResolver, dataStream });

        expect(reply.status.code).to.equal(400);
        expect(reply.status.detail).to.contain('initial write is not found');
      });

      it('should return 400 if `dateCreated` and `dateModified` are not the same in an initial write', async () => {
        const { requester, message, dataStream } = await TestDataGenerator.generateRecordsWrite({
          dateCreated  : '2023-01-10T10:20:30.405060',
          dateModified : getCurrentTimeInHighPrecision() // this always generate a different timestamp
        });
        const tenant = requester.did;

        const didResolver = TestStubGenerator.createDidResolverStub(requester);
        const reply = await handleRecordsWrite({ tenant, message, messageStore, didResolver, dataStream });

        expect(reply.status.code).to.equal(400);
        expect(reply.status.detail).to.contain('must match dateCreated');
      });

      it('should return 400 if `contextId` in an initial protocol-base write mismatches with the expected deterministic `contextId`', async () => {
        // generate a message with protocol so that computed contextId is also computed and included in message
        const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ protocol: 'anyValue' });

        message.contextId = await TestDataGenerator.randomCborSha256Cid(); // make contextId mismatch from computed value

        const didResolver = sinon.createStubInstance(DidResolver);
        const messageStore = sinon.createStubInstance(MessageStoreLevel);

        const reply = await handleRecordsWrite({ tenant: 'unused-tenant-DID', message, messageStore, didResolver, dataStream });
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

        const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
          requester: alice,
          protocol,
          protocolDefinition
        });

        // setting up a stub did resolver
        const aliceDidResolver = TestStubGenerator.createDidResolverStub(alice);

        const protocolsConfigureReply = await handleProtocolsConfigure({
          tenant: alice.did, message: protocolsConfig.message, messageStore, didResolver: aliceDidResolver, dataStream: protocolsConfig.dataStream
        });
        expect(protocolsConfigureReply.status.code).to.equal(202);

        // generate a `RecordsWrite` message from bob allowed by anyone
        const bob = await TestDataGenerator.generatePersona();
        const bobData = new TextEncoder().encode('data from bob');
        const emailFromBob = await TestDataGenerator.generateRecordsWrite(
          {
            requester : bob,
            protocol,
            schema    : 'email',
            data      : bobData
          }
        );

        const bobDidResolver = TestStubGenerator.createDidResolverStub(bob);

        const bobWriteReply = await handleRecordsWrite({
          tenant: alice.did, message: emailFromBob.message, messageStore, didResolver: bobDidResolver, dataStream: emailFromBob.dataStream
        });
        expect(bobWriteReply.status.code).to.equal(202);

        // verify bob's message got written to the DB
        const messageDataForQueryingBobsWrite = await TestDataGenerator.generateRecordsQuery({
          requester : alice,
          filter    : { recordId: emailFromBob.message.recordId }
        });
        const bobRecordQueryReply = await handleRecordsQuery({
          tenant: alice.did, message: messageDataForQueryingBobsWrite.message, messageStore, didResolver: aliceDidResolver
        });
        expect(bobRecordQueryReply.status.code).to.equal(200);
        expect(bobRecordQueryReply.entries?.length).to.equal(1);
        expect((bobRecordQueryReply.entries![0] as any).encodedData).to.equal(base64url.baseEncode(bobData));
      });

      it('should allow write with recipient rule', async () => {
        // scenario: VC issuer writes into Alice's DWN an asynchronous credential response upon receiving Alice's credential application

        const protocol = 'https://identity.foundation/decentralized-web-node/protocols/credential-issuance';
        const protocolDefinition = credentialIssuanceProtocolDefinition;
        const credentialApplicationSchema = protocolDefinition.labels.credentialApplication.schema;
        const credentialResponseSchema = protocolDefinition.labels.credentialResponse.schema;

        const alice = await TestDataGenerator.generatePersona();

        const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
          requester: alice,
          protocol,
          protocolDefinition
        });

        // setting up a stub did resolver
        const aliceDidResolver = TestStubGenerator.createDidResolverStub(alice);

        const protocolWriteReply = await handleProtocolsConfigure({
          tenant: alice.did, message: protocolsConfig.message, messageStore, didResolver: aliceDidResolver, dataStream: protocolsConfig.dataStream
        });
        expect(protocolWriteReply.status.code).to.equal(202);

        // write a credential application to Alice's DWN to simulate that she has sent a credential application to a VC issuer
        const vcIssuer = await TestDataGenerator.generatePersona();
        const encodedCredentialApplication = new TextEncoder().encode('credential application data');
        const credentialApplication = await TestDataGenerator.generateRecordsWrite({
          requester    : alice,
          recipientDid : vcIssuer.did,
          protocol,
          schema       : credentialApplicationSchema,
          data         : encodedCredentialApplication
        });
        const credentialApplicationContextId = await credentialApplication.recordsWrite.getEntryId();

        const credentialApplicationReply = await handleRecordsWrite({
          tenant      : alice.did,
          message     : credentialApplication.message,
          messageStore,
          didResolver : aliceDidResolver,
          dataStream  : credentialApplication.dataStream
        });
        expect(credentialApplicationReply.status.code).to.equal(202);

        // generate a credential application response message from VC issuer
        const encodedCredentialResponse = new TextEncoder().encode('credential response data');
        const credentialResponse = await TestDataGenerator.generateRecordsWrite(
          {
            requester    : vcIssuer,
            recipientDid : alice.did,
            protocol,
            contextId    : credentialApplicationContextId,
            parentId     : credentialApplicationContextId,
            schema       : credentialResponseSchema,
            data         : encodedCredentialResponse
          }
        );

        const vcIssuerDidResolver = TestStubGenerator.createDidResolverStub(vcIssuer);

        const credentialResponseReply = await handleRecordsWrite({
          tenant      : alice.did,
          message     : credentialResponse.message,
          messageStore,
          didResolver : vcIssuerDidResolver,
          dataStream  : credentialResponse.dataStream
        });
        expect(credentialResponseReply.status.code).to.equal(202);

        // verify VC issuer's message got written to the DB
        const messageDataForQueryingCredentialResponse = await TestDataGenerator.generateRecordsQuery({
          requester : alice,
          filter    : { recordId: credentialResponse.message.recordId }
        });
        const applicationResponseQueryReply = await handleRecordsQuery({
          tenant      : alice.did,
          message     : messageDataForQueryingCredentialResponse.message,
          messageStore,
          didResolver : aliceDidResolver
        });
        expect(applicationResponseQueryReply.status.code).to.equal(200);
        expect(applicationResponseQueryReply.entries?.length).to.equal(1);
        expect((applicationResponseQueryReply.entries![0] as any).encodedData)
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

        const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
          requester: alice,
          protocol,
          protocolDefinition
        });

        // setting up a stub did resolver
        const aliceDidResolver = TestStubGenerator.createDidResolverStub(alice);

        const protocolWriteReply = await handleProtocolsConfigure({
          tenant: alice.did, message: protocolsConfig.message, messageStore, didResolver: aliceDidResolver, dataStream: protocolsConfig.dataStream
        });
        expect(protocolWriteReply.status.code).to.equal(202);

        // generate a `RecordsWrite` message from bob
        const bob = await TestDataGenerator.generatePersona();
        const bobData = new TextEncoder().encode('data from bob');
        const notesFromBob = await TestDataGenerator.generateRecordsWrite(
          {
            requester : bob,
            protocol,
            schema    : 'notes',
            data      : bobData
          }
        );

        const bobDidResolver = TestStubGenerator.createDidResolverStub(bob);

        const bobWriteReply = await handleRecordsWrite({
          tenant: alice.did, message: notesFromBob.message, messageStore, didResolver: bobDidResolver, dataStream: notesFromBob.dataStream
        });
        expect(bobWriteReply.status.code).to.equal(202);

        // verify bob's message got written to the DB
        const messageDataForQueryingBobsWrite = await TestDataGenerator.generateRecordsQuery({
          requester : alice,
          filter    : { recordId: notesFromBob.message.recordId }
        });
        const bobRecordQueryReply = await handleRecordsQuery({
          tenant: alice.did, message: messageDataForQueryingBobsWrite.message, messageStore, didResolver: aliceDidResolver
        });
        expect(bobRecordQueryReply.status.code).to.equal(200);
        expect(bobRecordQueryReply.entries?.length).to.equal(1);
        expect((bobRecordQueryReply.entries![0] as any).encodedData).to.equal(base64url.baseEncode(bobData));

        // generate a new message from bob updating the existing notes
        const newNotesBytes = Encoder.stringToBytes('new data from bob');
        const newNotesFromBob = await TestDataGenerator.generateFromRecordsWrite({
          requester     : bob,
          existingWrite : notesFromBob.recordsWrite,
          data          : newNotesBytes
        });

        const newWriteReply = await handleRecordsWrite({
          tenant: alice.did, message: newNotesFromBob.message, messageStore, didResolver: bobDidResolver, dataStream: newNotesFromBob.dataStream
        });
        expect(newWriteReply.status.code).to.equal(202);

        // verify bob's message got written to the DB
        const newRecordQueryReply = await handleRecordsQuery({
          tenant: alice.did, message: messageDataForQueryingBobsWrite.message, messageStore, didResolver: aliceDidResolver
        });
        expect(newRecordQueryReply.status.code).to.equal(200);
        expect(newRecordQueryReply.entries?.length).to.equal(1);
        expect((newRecordQueryReply.entries![0] as any).encodedData).to.equal(Encoder.bytesToBase64Url(newNotesBytes));
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

        const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
          requester: alice,
          protocol,
          protocolDefinition
        });

        // setting up a stub did resolver
        const aliceDidResolver = TestStubGenerator.createDidResolverStub(alice);

        const protocolWriteReply = await handleProtocolsConfigure({
          tenant: alice.did, message: protocolsConfig.message, messageStore, didResolver: aliceDidResolver, dataStream: protocolsConfig.dataStream
        });
        expect(protocolWriteReply.status.code).to.equal(202);

        // generate a `RecordsWrite` message from bob
        const bob = await TestDataGenerator.generatePersona();
        const bobData = new TextEncoder().encode('data from bob');
        const notesFromBob = await TestDataGenerator.generateRecordsWrite(
          {
            requester : bob,
            protocol,
            schema    : 'notes',
            data      : bobData
          }
        );

        const bobDidResolver = TestStubGenerator.createDidResolverStub(bob);

        const bobWriteReply = await handleRecordsWrite({
          tenant: alice.did, message: notesFromBob.message, messageStore, didResolver: bobDidResolver, dataStream: notesFromBob.dataStream
        });
        expect(bobWriteReply.status.code).to.equal(202);

        // verify bob's message got written to the DB
        const messageDataForQueryingBobsWrite = await TestDataGenerator.generateRecordsQuery({
          requester : alice,
          filter    : { recordId: notesFromBob.message.recordId }
        });
        const bobRecordQueryReply = await handleRecordsQuery({
          tenant: alice.did, message: messageDataForQueryingBobsWrite.message, messageStore, didResolver: aliceDidResolver
        });
        expect(bobRecordQueryReply.status.code).to.equal(200);
        expect(bobRecordQueryReply.entries?.length).to.equal(1);
        expect((bobRecordQueryReply.entries![0] as any).encodedData).to.equal(base64url.baseEncode(bobData));

        // generate a new message from carol updating the existing notes, which should not be allowed/accepted
        const carol = await TestDataGenerator.generatePersona();
        const newNotesData = new TextEncoder().encode('different data by carol');
        const newNotesFromBob = await TestDataGenerator.generateRecordsWrite(
          {
            requester : carol,
            protocol,
            schema    : 'notes',
            data      : newNotesData,
            recordId  : notesFromBob.message.recordId,
          }
        );

        const carolDidResolver = TestStubGenerator.createDidResolverStub(carol);
        const carolWriteReply = await handleRecordsWrite({
          tenant: alice.did, message: newNotesFromBob.message, messageStore, didResolver: carolDidResolver, dataStream: newNotesFromBob.dataStream
        });
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

        const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
          requester: alice,
          protocol,
          protocolDefinition
        });

        // setting up a stub did resolver
        const aliceDidResolver = TestStubGenerator.createDidResolverStub(alice);

        const protocolWriteReply = await handleProtocolsConfigure({
          tenant: alice.did, message: protocolsConfig.message, messageStore, didResolver: aliceDidResolver, dataStream: protocolsConfig.dataStream
        });
        expect(protocolWriteReply.status.code).to.equal(202);

        // generate a `RecordsWrite` message from bob
        const bob = await TestDataGenerator.generatePersona();
        const bobData = new TextEncoder().encode('data from bob');
        const notesFromBob = await TestDataGenerator.generateRecordsWrite(
          {
            requester : bob,
            protocol,
            schema    : 'notes',
            data      : bobData
          }
        );

        const bobDidResolver = TestStubGenerator.createDidResolverStub(bob);

        const bobWriteReply = await handleRecordsWrite({
          tenant: alice.did, message: notesFromBob.message, messageStore, didResolver: bobDidResolver, dataStream: notesFromBob.dataStream
        });
        expect(bobWriteReply.status.code).to.equal(202);

        // verify bob's message got written to the DB
        const messageDataForQueryingBobsWrite = await TestDataGenerator.generateRecordsQuery({
          requester : alice,
          filter    : { recordId: notesFromBob.message.recordId }
        });
        const bobRecordQueryReply = await handleRecordsQuery({
          tenant: alice.did, message: messageDataForQueryingBobsWrite.message, messageStore, didResolver: aliceDidResolver
        });
        expect(bobRecordQueryReply.status.code).to.equal(200);
        expect(bobRecordQueryReply.entries?.length).to.equal(1);
        expect((bobRecordQueryReply.entries![0] as any).encodedData).to.equal(base64url.baseEncode(bobData));

        // generate a new message from bob changing immutable recipientDid
        const newNotesFromBob = await TestDataGenerator.generateRecordsWrite(
          {
            requester    : bob,
            dateCreated  : notesFromBob.message.descriptor.dateCreated,
            protocol,
            schema       : 'notes',
            data         : bobData,
            recordId     : notesFromBob.message.recordId,
            recipientDid : bob.did // this immutable property was Alice's DID initially
          }
        );

        const newWriteReply = await handleRecordsWrite({
          tenant: alice.did, message: newNotesFromBob.message, messageStore, didResolver: bobDidResolver, dataStream: newNotesFromBob.dataStream
        });
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

        const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
          requester: alice,
          protocol,
          protocolDefinition
        });

        // setting up a stub did resolver
        const aliceDidResolver = TestStubGenerator.createDidResolverStub(alice);

        const protocolWriteReply = await handleProtocolsConfigure({
          tenant: alice.did, message: protocolsConfig.message, messageStore, didResolver: aliceDidResolver, dataStream: protocolsConfig.dataStream
        });
        expect(protocolWriteReply.status.code).to.equal(202);

        // write a credential application to Alice's DWN to simulate that she has sent a credential application to a VC issuer
        const vcIssuer = await TestDataGenerator.generatePersona();
        const encodedCredentialApplication = new TextEncoder().encode('credential application data');
        const credentialApplication = await TestDataGenerator.generateRecordsWrite({
          requester    : alice,
          recipientDid : vcIssuer.did,
          protocol,
          schema       : credentialApplicationSchema,
          data         : encodedCredentialApplication
        });
        const credentialApplicationContextId = await credentialApplication.recordsWrite.getEntryId();

        const credentialApplicationReply = await handleRecordsWrite({
          tenant      : alice.did,
          message     : credentialApplication.message,
          messageStore,
          didResolver : aliceDidResolver,
          dataStream  : credentialApplication.dataStream
        });
        expect(credentialApplicationReply.status.code).to.equal(202);

        // generate a credential application response message from a fake VC issuer
        const fakeVcIssuer = await TestDataGenerator.generatePersona();
        const encodedCredentialResponse = new TextEncoder().encode('credential response data');
        const credentialResponse = await TestDataGenerator.generateRecordsWrite(
          {
            requester    : fakeVcIssuer,
            recipientDid : alice.did,
            protocol,
            contextId    : credentialApplicationContextId,
            parentId     : credentialApplicationContextId,
            schema       : credentialResponseSchema,
            data         : encodedCredentialResponse
          }
        );

        const vcIssuerDidResolver = TestStubGenerator.createDidResolverStub(fakeVcIssuer);

        const credentialResponseReply = await handleRecordsWrite({
          tenant      : alice.did,
          message     : credentialResponse.message,
          messageStore,
          didResolver : vcIssuerDidResolver,
          dataStream  : credentialResponse.dataStream
        });
        expect(credentialResponseReply.status.code).to.equal(401);
        expect(credentialResponseReply.status.detail).to.contain('unexpected inbound message author');
      });

      it('should fail authorization if protocol cannot be found for a protocol-based RecordsWrite', async () => {
        const alice = await DidKeyResolver.generate();
        const protocol = 'nonExistentProtocol';
        const data = Encoder.stringToBytes('any data');
        const credentialApplication = await TestDataGenerator.generateRecordsWrite({
          requester    : alice,
          recipientDid : alice.did,
          protocol,
          data
        });

        const reply = await handleRecordsWrite({
          tenant: alice.did, message: credentialApplication.message, messageStore, didResolver, dataStream: credentialApplication.dataStream
        });
        expect(reply.status.code).to.equal(401);
        expect(reply.status.detail).to.contain('unable to find protocol definition');
      });

      it('should fail authorization if record schema is not an allowed type for protocol-based RecordsWrite', async () => {
        const alice = await DidKeyResolver.generate();

        const protocol = 'https://identity.foundation/decentralized-web-node/protocols/credential-issuance';
        const protocolConfig = await TestDataGenerator.generateProtocolsConfigure({
          requester          : alice,
          protocol,
          protocolDefinition : credentialIssuanceProtocolDefinition
        });

        const protocolConfigureReply = await handleProtocolsConfigure({
          tenant: alice.did, message: protocolConfig.message, messageStore, didResolver, dataStream: protocolConfig.dataStream
        });
        expect(protocolConfigureReply.status.code).to.equal(202);

        const data = Encoder.stringToBytes('any data');
        const credentialApplication = await TestDataGenerator.generateRecordsWrite({
          requester    : alice,
          recipientDid : alice.did,
          protocol,
          schema       : 'unexpectedSchema',
          data
        });

        const reply = await handleRecordsWrite({
          tenant: alice.did, message: credentialApplication.message, messageStore, didResolver, dataStream: credentialApplication.dataStream
        });
        expect(reply.status.code).to.equal(401);
        expect(reply.status.detail).to.equal('record with schema \'unexpectedSchema\' not allowed in protocol');
      });

      it('should fail authorization if record schema is not allowed at the hierarchical level attempted for the RecordsWrite', async () => {
        const alice = await DidKeyResolver.generate();

        const protocol = 'https://identity.foundation/decentralized-web-node/protocols/credential-issuance';
        const protocolDefinition = credentialIssuanceProtocolDefinition;
        const protocolConfig = await TestDataGenerator.generateProtocolsConfigure({
          requester: alice,
          protocol,
          protocolDefinition
        });
        const credentialResponseSchema = protocolDefinition.labels.credentialResponse.schema;

        const protocolConfigureReply = await handleProtocolsConfigure({
          tenant: alice.did, message: protocolConfig.message, messageStore, didResolver, dataStream: protocolConfig.dataStream
        });
        expect(protocolConfigureReply.status.code).to.equal(202);

        const data = Encoder.stringToBytes('any data');
        const credentialApplication = await TestDataGenerator.generateRecordsWrite({
          requester    : alice,
          recipientDid : alice.did,
          protocol,
          schema       : credentialResponseSchema, // this is an known schema type, but not allowed for a protocol root record
          data
        });

        const reply = await handleRecordsWrite({
          tenant: alice.did, message: credentialApplication.message, messageStore, didResolver, dataStream: credentialApplication.dataStream
        });
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
        const protocolConfig = await TestDataGenerator.generateProtocolsConfigure({
          requester: alice,
          protocol,
          protocolDefinition
        });

        const protocolConfigureReply = await handleProtocolsConfigure({
          tenant: alice.did, message: protocolConfig.message, messageStore, didResolver, dataStream: protocolConfig.dataStream
        });
        expect(protocolConfigureReply.status.code).to.equal(202);

        // test that Alice is allowed to write to her own DWN
        const data = Encoder.stringToBytes('any data');
        const aliceWriteMessageData = await TestDataGenerator.generateRecordsWrite({
          requester    : alice,
          recipientDid : alice.did,
          protocol,
          schema       : 'private-note',
          data
        });

        let reply = await handleRecordsWrite({
          tenant: alice.did, message: aliceWriteMessageData.message, messageStore, didResolver, dataStream: aliceWriteMessageData.dataStream
        });
        expect(reply.status.code).to.equal(202);

        // test that Bob is not allowed to write to Alice's DWN
        const bob = await DidKeyResolver.generate();
        const bobWriteMessageData = await TestDataGenerator.generateRecordsWrite({
          requester    : bob,
          recipientDid : alice.did,
          protocol,
          schema       : 'private-note',
          data
        });

        reply = await handleRecordsWrite({
          tenant: alice.did, message: bobWriteMessageData.message, messageStore, didResolver, dataStream: bobWriteMessageData.dataStream
        });
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
        const protocolConfig = await TestDataGenerator.generateProtocolsConfigure({
          requester          : alice,
          protocol,
          protocolDefinition : invalidProtocolDefinition
        });

        const protocolConfigureReply = await handleProtocolsConfigure({
          tenant: alice.did, message: protocolConfig.message, messageStore, didResolver, dataStream: protocolConfig.dataStream
        });
        expect(protocolConfigureReply.status.code).to.equal(202);

        // simulate Alice's VC applications with both issuer
        const data = Encoder.stringToBytes('irrelevant');
        const messageDataWithIssuerA = await TestDataGenerator.generateRecordsWrite({
          requester    : alice,
          recipientDid : issuer.did,
          schema       : credentialIssuanceProtocolDefinition.labels.credentialApplication.schema,
          protocol,
          data
        });
        const contextId = await messageDataWithIssuerA.recordsWrite.getEntryId();

        let reply = await handleRecordsWrite({
          tenant: alice.did, message: messageDataWithIssuerA.message, messageStore, didResolver, dataStream: messageDataWithIssuerA.dataStream
        });
        expect(reply.status.code).to.equal(202);

        // simulate issuer attempting to respond to Alice's VC application
        const invalidResponseByIssuerA = await TestDataGenerator.generateRecordsWrite({
          requester    : issuer,
          recipientDid : alice.did,
          schema       : credentialIssuanceProtocolDefinition.labels.credentialResponse.schema,
          contextId,
          parentId     : messageDataWithIssuerA.message.recordId,
          protocol,
          data
        });

        reply = await handleRecordsWrite({
          tenant: alice.did, message: invalidResponseByIssuerA.message, messageStore, didResolver, dataStream: invalidResponseByIssuerA.dataStream
        });
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
        const protocolConfig = await TestDataGenerator.generateProtocolsConfigure({
          requester          : alice,
          protocol,
          protocolDefinition : invalidProtocolDefinition
        });

        const protocolConfigureReply = await handleProtocolsConfigure({
          tenant: alice.did, message: protocolConfig.message, messageStore, didResolver, dataStream: protocolConfig.dataStream
        });
        expect(protocolConfigureReply.status.code).to.equal(202);

        // simulate Alice's VC application to an issuer
        const data = Encoder.stringToBytes('irrelevant');
        const messageDataWithIssuerA = await TestDataGenerator.generateRecordsWrite({
          requester    : alice,
          recipientDid : issuer.did,
          schema       : credentialIssuanceProtocolDefinition.labels.credentialApplication.schema,
          protocol,
          data
        });
        const contextId = await messageDataWithIssuerA.recordsWrite.getEntryId();

        let reply = await handleRecordsWrite({
          tenant: alice.did, message: messageDataWithIssuerA.message, messageStore, didResolver, dataStream: messageDataWithIssuerA.dataStream
        });
        expect(reply.status.code).to.equal(202);

        // simulate issuer attempting to respond to Alice's VC application
        const invalidResponseByIssuerA = await TestDataGenerator.generateRecordsWrite({
          requester    : issuer,
          recipientDid : alice.did,
          schema       : credentialIssuanceProtocolDefinition.labels.credentialResponse.schema,
          contextId,
          parentId     : messageDataWithIssuerA.message.recordId,
          protocol,
          data
        });

        reply = await handleRecordsWrite({
          tenant: alice.did, message: invalidResponseByIssuerA.message, messageStore, didResolver, dataStream: invalidResponseByIssuerA.dataStream
        });
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
        const protocolConfig = await TestDataGenerator.generateProtocolsConfigure({
          requester          : pfi,
          protocol,
          protocolDefinition : protocolDefinition
        });

        const protocolConfigureReply = await handleProtocolsConfigure({
          tenant: pfi.did, message: protocolConfig.message, messageStore, didResolver, dataStream: protocolConfig.dataStream
        });
        expect(protocolConfigureReply.status.code).to.equal(202);

        // simulate Alice's ask and PFI's offer already occurred
        const data = Encoder.stringToBytes('irrelevant');
        const askMessageData = await TestDataGenerator.generateRecordsWrite({
          requester    : alice,
          recipientDid : pfi.did,
          schema       : 'ask',
          protocol,
          data
        });
        const contextId = await askMessageData.recordsWrite.getEntryId();

        let reply = await handleRecordsWrite({
          tenant: pfi.did, message: askMessageData.message, messageStore, didResolver, dataStream: askMessageData.dataStream
        });
        expect(reply.status.code).to.equal(202);

        const offerMessageData = await TestDataGenerator.generateRecordsWrite({
          requester    : pfi,
          recipientDid : alice.did,
          schema       : 'offer',
          contextId,
          parentId     : askMessageData.message.recordId,
          protocol,
          data
        });

        reply = await handleRecordsWrite({
          tenant: pfi.did, message: offerMessageData.message, messageStore, didResolver, dataStream: offerMessageData.dataStream
        });
        expect(reply.status.code).to.equal(202);

        // the actual test: making sure fulfillment message is accepted
        const fulfillmentMessageData = await TestDataGenerator.generateRecordsWrite({
          requester    : alice,
          recipientDid : pfi.did,
          schema       : 'fulfillment',
          contextId,
          parentId     : offerMessageData.message.recordId,
          protocol,
          data
        });
        reply = await handleRecordsWrite({
          tenant: pfi.did, message: fulfillmentMessageData.message, messageStore, didResolver, dataStream: fulfillmentMessageData.dataStream
        });
        expect(reply.status.code).to.equal(202);

        // verify the fulfillment message is stored
        const recordsQueryMessageData = await TestDataGenerator.generateRecordsQuery({
          requester : pfi,
          filter    : { recordId: fulfillmentMessageData.message.recordId }
        });

        // verify the data is written
        const recordsQueryReply = await handleRecordsQuery({
          tenant: pfi.did, message: recordsQueryMessageData.message, messageStore, didResolver });
        expect(recordsQueryReply.status.code).to.equal(200);
        expect(recordsQueryReply.entries?.length).to.equal(1);
        expect((recordsQueryReply.entries![0] as RecordsWriteMessage).descriptor.dataCid)
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
        const protocolConfig = await TestDataGenerator.generateProtocolsConfigure({
          requester          : pfi,
          protocol,
          protocolDefinition : protocolDefinition
        });

        const protocolConfigureReply = await handleProtocolsConfigure({
          tenant: pfi.did, message: protocolConfig.message, messageStore, didResolver, dataStream: protocolConfig.dataStream
        });
        expect(protocolConfigureReply.status.code).to.equal(202);

        // simulate Alice's ask
        const data = Encoder.stringToBytes('irrelevant');
        const askMessageData = await TestDataGenerator.generateRecordsWrite({
          requester    : alice,
          recipientDid : pfi.did,
          schema       : 'ask',
          protocol,
          data
        });
        const contextId = await askMessageData.recordsWrite.getEntryId();

        let reply = await handleRecordsWrite({
          tenant: pfi.did, message: askMessageData.message, messageStore, didResolver, dataStream: askMessageData.dataStream
        });
        expect(reply.status.code).to.equal(202);

        // the actual test: making sure fulfillment message fails
        const fulfillmentMessageData = await TestDataGenerator.generateRecordsWrite({
          requester    : alice,
          recipientDid : pfi.did,
          schema       : 'fulfillment',
          contextId,
          parentId     : 'non-existent-id',
          protocol,
          data
        });
        reply = await handleRecordsWrite({
          tenant: pfi.did, message: fulfillmentMessageData.message, messageStore, didResolver, dataStream: fulfillmentMessageData.dataStream
        });
        expect(reply.status.code).to.equal(401);
        expect(reply.status.detail).to.contain('no parent found');
      });
    });
  });

  describe('authorization validation tests', () => {
    it('should return 400 if `recordId` in `authorization` payload mismatches with `recordId` in the message', async () => {
      const { requester, message, recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite();

      // replace `authorization` with mismatching `record`, even though signature is still valid
      const authorizationPayload = { ...recordsWrite.authorizationPayload };
      authorizationPayload.recordId = await TestDataGenerator.randomCborSha256Cid(); // make recordId mismatch in authorization payload
      const authorizationPayloadBytes = Encoder.objectToBytes(authorizationPayload);
      const signatureInput = Jws.createSignatureInput(requester);
      const signer = await GeneralJwsSigner.create(authorizationPayloadBytes, [signatureInput]);
      message.authorization = signer.getJws();

      const tenant = requester.did;
      const didResolver = TestStubGenerator.createDidResolverStub(requester);
      const messageStore = sinon.createStubInstance(MessageStoreLevel);
      const reply = await handleRecordsWrite({ tenant, message, messageStore, didResolver, dataStream });

      expect(reply.status.code).to.equal(400);
      expect(reply.status.detail).to.contain('does not match recordId in authorization');
    });

    it('should return 400 if `contextId` in `authorization` payload mismatches with `contextId` in the message', async () => {
    // generate a message with protocol so that computed contextId is also computed and included in message
      const { requester, message, recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite({ protocol: 'anyValue' });

      // replace `authorization` with mismatching `contextId`, even though signature is still valid
      const authorizationPayload = { ...recordsWrite.authorizationPayload };
      authorizationPayload.contextId = await TestDataGenerator.randomCborSha256Cid(); // make contextId mismatch in authorization payload
      const authorizationPayloadBytes = Encoder.objectToBytes(authorizationPayload);
      const signatureInput = Jws.createSignatureInput(requester);
      const signer = await GeneralJwsSigner.create(authorizationPayloadBytes, [signatureInput]);
      message.authorization = signer.getJws();

      const tenant = requester.did;
      const didResolver = sinon.createStubInstance(DidResolver);
      const messageStore = sinon.createStubInstance(MessageStoreLevel);
      const reply = await handleRecordsWrite({ tenant, message, messageStore, didResolver, dataStream });

      expect(reply.status.code).to.equal(400);
      expect(reply.status.detail).to.contain('does not match contextId in authorization');
    });

    it('should return 401 if `authorization` signature check fails', async () => {
      const { requester, message, dataStream } = await TestDataGenerator.generateRecordsWrite();

      // setting up a stub did resolver & message store
      // intentionally not supplying the public key so a different public key is generated to simulate invalid signature
      const mismatchingPersona = await TestDataGenerator.generatePersona({ did: requester.did, keyId: requester.keyId });
      const didResolver = TestStubGenerator.createDidResolverStub(mismatchingPersona);

      const messageStore = sinon.createStubInstance(MessageStoreLevel);
      const tenant = requester.did;

      const reply = await handleRecordsWrite({ tenant, message, messageStore, didResolver, dataStream });

      expect(reply.status.code).to.equal(401);
    });

    it('should return 401 if an unauthorized requester is attempting write', async () => {
      const requester = await TestDataGenerator.generatePersona();
      const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ requester });

      // setting up a stub did resolver & message store
      const didResolver = TestStubGenerator.createDidResolverStub(requester);
      const messageStore = sinon.createStubInstance(MessageStoreLevel);

      const tenant = await (await TestDataGenerator.generatePersona()).did;
      const reply = await handleRecordsWrite({ tenant, message, messageStore, didResolver, dataStream });

      expect(reply.status.code).to.equal(401);
    });

  });

  describe('attestation validation tests', () => {
    it('should fail with 400 if `attestation` payload contains properties other than `descriptorCid`', async () => {
      const { requester, message, recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite();
      const tenant = requester.did;
      const signatureInput = Jws.createSignatureInput(requester);

      // replace `attestation` with one that has an additional property, but go the extra mile of making sure signature is valid
      const descriptorCid = recordsWrite.authorizationPayload.descriptorCid;
      const attestationPayload = { descriptorCid, someAdditionalProperty: 'anyValue' }; // additional property is not allowed
      const attestationPayloadBytes = Encoder.objectToBytes(attestationPayload);
      const attestationSigner = await GeneralJwsSigner.create(attestationPayloadBytes, [signatureInput]);
      message.attestation = attestationSigner.getJws();

      // recreate the `authorization` based on the new` attestationCid`
      const authorizationPayload = { ...recordsWrite.authorizationPayload };
      authorizationPayload.attestationCid = await computeCid(attestationPayload);
      const authorizationPayloadBytes = Encoder.objectToBytes(authorizationPayload);
      const authorizationSigner = await GeneralJwsSigner.create(authorizationPayloadBytes, [signatureInput]);
      message.authorization = authorizationSigner.getJws();

      const didResolver = TestStubGenerator.createDidResolverStub(requester);
      const messageStore = sinon.createStubInstance(MessageStoreLevel);
      const reply = await handleRecordsWrite({ tenant, message, messageStore, didResolver, dataStream });

      expect(reply.status.code).to.equal(400);
      expect(reply.status.detail).to.contain(`Only 'descriptorCid' is allowed in attestation payload`);
    });

    it('should fail validation with 400 if more than 1 attester is given ', async () => {
      const alice = await DidKeyResolver.generate();
      const bob = await DidKeyResolver.generate();
      const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ requester: alice, attesters: [alice, bob] });

      const writeReply = await handleRecordsWrite({ tenant: alice.did, message, messageStore, didResolver, dataStream });
      expect(writeReply.status.code).to.equal(400);
      expect(writeReply.status.detail).to.contain('implementation only supports 1 attester');
    });

    it('should fail validation with 400 if the `attestation` does not include the correct `descriptorCid`', async () => {
      const alice = await DidKeyResolver.generate();
      const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ requester: alice, attesters: [alice] });

      // create another write and use its `attestation` value instead, that `attestation` will point to an entirely different `descriptorCid`
      const anotherWrite = await TestDataGenerator.generateRecordsWrite({ attesters: [alice] });
      message.attestation = anotherWrite.message.attestation;

      const writeReply = await handleRecordsWrite({ tenant: alice.did, message, messageStore, didResolver, dataStream });
      expect(writeReply.status.code).to.equal(400);
      expect(writeReply.status.detail).to.contain('does not match expected descriptorCid');
    });

    it('should fail validation with 400 if expected CID of `attestation` mismatches the `attestationCid` in `authorization`', async () => {
      const alice = await DidKeyResolver.generate();
      const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ requester: alice, attesters: [alice] });

      // replace valid attestation (the one signed by `authorization` with another attestation to the same message (descriptorCid)
      const bob = await DidKeyResolver.generate();
      const descriptorCid = await computeCid(message.descriptor);
      const attestationNotReferencedByAuthorization = await RecordsWrite['createAttestation'](descriptorCid, Jws.createSignatureInputs([bob]));
      message.attestation = attestationNotReferencedByAuthorization;

      const writeReply = await handleRecordsWrite({ tenant: alice.did, message, messageStore, didResolver, dataStream });
      expect(writeReply.status.code).to.equal(400);
      expect(writeReply.status.detail).to.contain('does not match attestationCid');
    });
  });

  it('should throw if `messageStore.put()` throws unknown error', async () => {
    const { requester, message, dataStream } = await TestDataGenerator.generateRecordsWrite();

    const didResolverStub = TestStubGenerator.createDidResolverStub(requester);

    const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);
    messageStoreStub.query.resolves([]);
    messageStoreStub.put.throws(new Error('an unknown error in messageStore.put()'));

    const tenant = requester.did;
    const handlerPromise = handleRecordsWrite({ tenant, message, messageStore: messageStoreStub, didResolver: didResolverStub, dataStream });
    await expect(handlerPromise).to.be.rejectedWith('an unknown error in messageStore.put()');
  });
});
