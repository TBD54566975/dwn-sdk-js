import chaiAsPromised from 'chai-as-promised';
import credentialIssuanceProtocolDefinition from '../../../vectors/protocol-definitions/credential-issuance.json' assert { type: 'json' };
import dexProtocolDefinition from '../../../vectors/protocol-definitions/dex.json' assert { type: 'json' };
import emailProtocolDefinition from '../../../vectors/protocol-definitions/email.json' assert { type: 'json' };
import socialMediaProtocolDefinition from '../../../vectors/protocol-definitions/social-media.json' assert { type: 'json' };

import sinon from 'sinon';
import chai, { expect } from 'chai';

import type { GenerateFromRecordsWriteOut } from '../../../utils/test-data-generator.js';
import type { QueryResultEntry } from '../../../../src/core/types.js';
import type { RecordsWriteMessage } from '../../../../src/interfaces/records/types.js';
import type { EncryptionInput, ProtocolDefinition } from '../../../../src/index.js';

import { asyncGeneratorToArray } from '../../../../src/utils/array.js';
import { base64url } from 'multiformats/bases/base64';
import { DataStoreLevel } from '../../../../src/store/data-store-level.js';
import { DataStream } from '../../../../src/utils/data-stream.js';
import { DidKeyResolver } from '../../../../src/did/did-key-resolver.js';
import { DidResolver } from '../../../../src/did/did-resolver.js';
import { DwnErrorCode } from '../../../../src/core/dwn-error.js';
import { Encoder } from '../../../../src/utils/encoder.js';
import { EventLogLevel } from '../../../../src/event-log/event-log-level.js';
import { GeneralJwsSigner } from '../../../../src/jose/jws/general/signer.js';
import { getCurrentTimeInHighPrecision } from '../../../../src/utils/time.js';
import { KeyDerivationScheme } from '../../../../src/index.js';
import { Message } from '../../../../src/core/message.js';
import { MessageStoreLevel } from '../../../../src/store/message-store-level.js';
import { RecordsWriteHandler } from '../../../../src/interfaces/records/handlers/records-write.js';
import { StorageController } from '../../../../src/store/storage-controller.js';
import { TestDataGenerator } from '../../../utils/test-data-generator.js';
import { TestStubGenerator } from '../../../utils/test-stub-generator.js';

import { Cid, computeCid } from '../../../../src/utils/cid.js';
import { Dwn, Jws, RecordsWrite } from '../../../../src/index.js';
import { Encryption, EncryptionAlgorithm } from '../../../../src/utils/encryption.js';

chai.use(chaiAsPromised);

describe('RecordsWriteHandler.handle()', () => {
  let didResolver: DidResolver;
  let messageStore: MessageStoreLevel;
  let dataStore: DataStoreLevel;
  let eventLog: EventLogLevel;
  let dwn: Dwn;

  describe('functional tests', () => {
    before(async () => {
      didResolver = new DidResolver([new DidKeyResolver()]);

      // important to follow this pattern to initialize and clean the message and data store in tests
      // so that different suites can reuse the same block store and index location for testing
      messageStore = new MessageStoreLevel({
        blockstoreLocation : 'TEST-MESSAGESTORE',
        indexLocation      : 'TEST-INDEX'
      });

      dataStore = new DataStoreLevel({
        blockstoreLocation: 'TEST-DATASTORE'
      });

      eventLog = new EventLogLevel({
        location: 'TEST-EVENTLOG'
      });

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

    it('should only be able to overwrite existing record if new record has a later `dateModified` value', async () => {
      // write a message into DB
      const requester = await DidKeyResolver.generate();
      const data1 = new TextEncoder().encode('data1');
      const recordsWriteMessageData = await TestDataGenerator.generateRecordsWrite({ requester, data: data1 });

      const tenant = requester.did;
      const recordsWriteReply = await dwn.processMessage(tenant, recordsWriteMessageData.message, recordsWriteMessageData.dataStream);
      expect(recordsWriteReply.status.code).to.equal(202);

      const recordId = recordsWriteMessageData.message.recordId;
      const recordsQueryMessageData = await TestDataGenerator.generateRecordsQuery({
        requester,
        filter: { recordId }
      });

      // verify the message written can be queried
      const recordsQueryReply = await dwn.processMessage(tenant, recordsQueryMessageData.message);
      expect(recordsQueryReply.status.code).to.equal(200);
      expect(recordsQueryReply.entries?.length).to.equal(1);
      expect(recordsQueryReply.entries![0].encodedData).to.equal(base64url.baseEncode(data1));

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
      expect(newDataEncoded).to.not.equal(Encoder.bytesToBase64Url(recordsWriteMessageData.dataBytes!));

      const newRecordsWriteReply = await dwn.processMessage(tenant, newRecordsWrite.message, newRecordsWrite.dataStream);
      expect(newRecordsWriteReply.status.code).to.equal(202);

      // verify new record has overwritten the existing record
      const newRecordsQueryReply = await dwn.processMessage(tenant, recordsQueryMessageData.message);

      expect(newRecordsQueryReply.status.code).to.equal(200);
      expect(newRecordsQueryReply.entries?.length).to.equal(1);
      expect(newRecordsQueryReply.entries![0].encodedData).to.equal(newDataEncoded);

      // try to write the older message to store again and verify that it is not accepted
      const thirdRecordsWriteReply = await dwn.processMessage(tenant, recordsWriteMessageData.message, recordsWriteMessageData.dataStream);
      expect(thirdRecordsWriteReply.status.code).to.equal(409); // expecting to fail

      // expecting unchanged
      const thirdRecordsQueryReply = await dwn.processMessage(tenant, recordsQueryMessageData.message);
      expect(thirdRecordsQueryReply.status.code).to.equal(200);
      expect(thirdRecordsQueryReply.entries?.length).to.equal(1);
      expect(thirdRecordsQueryReply.entries![0].encodedData).to.equal(newDataEncoded);
    });

    it('should only be able to overwrite existing record if new message CID is larger when `dateModified` value is the same', async () => {
      // start by writing an originating message
      const requester = await TestDataGenerator.generatePersona();
      const tenant = requester.did;
      const originatingMessageData = await TestDataGenerator.generateRecordsWrite({
        requester,
        data: Encoder.stringToBytes('unused')
      });

      // setting up a stub DID resolver
      TestStubGenerator.stubDidResolver(didResolver, [requester]);

      const originatingMessageWriteReply = await dwn.processMessage(tenant, originatingMessageData.message, originatingMessageData.dataStream);
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
      const recordsWriteReply = await dwn.processMessage(tenant, olderWrite.message, olderWrite.dataStream);
      expect(recordsWriteReply.status.code).to.equal(202);

      // query to fetch the record
      const recordsQueryMessageData = await TestDataGenerator.generateRecordsQuery({
        requester,
        filter: { recordId: originatingMessageData.message.recordId }
      });

      // verify the data is written
      const recordsQueryReply = await dwn.processMessage(tenant, recordsQueryMessageData.message);
      expect(recordsQueryReply.status.code).to.equal(200);
      expect(recordsQueryReply.entries?.length).to.equal(1);
      expect((recordsQueryReply.entries![0] as RecordsWriteMessage).descriptor.dataCid)
        .to.equal(olderWrite.message.descriptor.dataCid);

      // attempt to write the message with larger lexicographical message CID
      const newRecordsWriteReply = await dwn.processMessage(tenant, newerWrite.message, newerWrite.dataStream);
      expect(newRecordsWriteReply.status.code).to.equal(202);

      // verify new record has overwritten the existing record
      const newRecordsQueryReply = await dwn.processMessage(tenant, recordsQueryMessageData.message);
      expect(newRecordsQueryReply.status.code).to.equal(200);
      expect(newRecordsQueryReply.entries?.length).to.equal(1);
      expect((newRecordsQueryReply.entries![0] as RecordsWriteMessage).descriptor.dataCid)
        .to.equal(newerWrite.message.descriptor.dataCid);

      // try to write the message with smaller lexicographical message CID again
      const thirdRecordsWriteReply = await dwn.processMessage(
        tenant,
        olderWrite.message,
        DataStream.fromBytes(olderWrite.dataBytes) // need to create data stream again since it's already used above
      );
      expect(thirdRecordsWriteReply.status.code).to.equal(409); // expecting to fail

      // verify the message in store is still the one with larger lexicographical message CID
      const thirdRecordsQueryReply = await dwn.processMessage(tenant, recordsQueryMessageData.message);
      expect(thirdRecordsQueryReply.status.code).to.equal(200);
      expect(thirdRecordsQueryReply.entries?.length).to.equal(1);
      expect((thirdRecordsQueryReply.entries![0] as RecordsWriteMessage).descriptor.dataCid)
        .to.equal(newerWrite.message.descriptor.dataCid); // expecting unchanged
    });

    it('should not allow changes to immutable properties', async () => {
      const initialWriteData = await TestDataGenerator.generateRecordsWrite();
      const tenant = initialWriteData.requester.did;

      TestStubGenerator.stubDidResolver(didResolver, [initialWriteData.requester]);

      const initialWriteReply = await dwn.processMessage(tenant, initialWriteData.message, initialWriteData.dataStream);
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

      let reply = await dwn.processMessage(tenant, childMessageData.message, childMessageData.dataStream);

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

      reply = await dwn.processMessage(tenant, childMessageData.message, childMessageData.dataStream);

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

      reply = await dwn.processMessage(tenant, childMessageData.message, childMessageData.dataStream);

      expect(reply.status.code).to.equal(400);
      expect(reply.status.detail).to.contain('dataFormat is an immutable property');
    });

    it('should return 400 if actual data size mismatches with `dataSize` in descriptor', async () => {
      const alice = await DidKeyResolver.generate();
      const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ requester: alice });

      // replace the dataSize to simulate mismatch, will need to generate `recordId` and `authorization` property again
      message.descriptor.dataSize = 1;
      const descriptorCid = await computeCid(message.descriptor);
      const recordId = await RecordsWrite.getEntryId(alice.did, message.descriptor);
      const authorizationSignatureInput = Jws.createSignatureInput(alice);
      const authorization = await RecordsWrite['createAuthorization'](recordId, message.contextId, descriptorCid, message.attestation, message.encryption, authorizationSignatureInput);
      message.recordId = recordId;
      message.authorization = authorization;

      const reply = await dwn.processMessage(alice.did, message, dataStream);
      expect(reply.status.code).to.equal(400);
      expect(reply.status.detail).to.contain('does not match dataSize in descriptor');
    });

    it('should return 400 if actual data CID of mismatches with `dataCid` in descriptor', async () => {
      const alice = await DidKeyResolver.generate();
      const { message } = await TestDataGenerator.generateRecordsWrite({ requester: alice });
      const dataStream = DataStream.fromBytes(TestDataGenerator.randomBytes(32)); // mismatch data stream

      const reply = await dwn.processMessage(alice.did, message, dataStream);
      expect(reply.status.code).to.equal(400);
      expect(reply.status.detail).to.contain('does not match dataCid in descriptor');
    });

    it('should return 400 if attempting to write a record without data stream and the data does not already exist in DWN', async () => {
      const alice = await DidKeyResolver.generate();

      const { message } = await TestDataGenerator.generateRecordsWrite({
        requester: alice,
      });

      const reply = await dwn.processMessage(alice.did, message);

      expect(reply.status.code).to.equal(400);
      expect(reply.status.detail).to.contain(DwnErrorCode.MessageStoreDataNotFound);
    });

    describe('initial write & subsequent write tests', () => {
      describe('createFrom()', () => {
        it('should accept a published RecordsWrite using createFrom() without specifying `data` or `datePublished`', async () => {
          const dataForCid = await dataStore.blockstore.partition('data');

          const data = Encoder.stringToBytes('test');
          const dataCid = await Cid.computeDagPbCidFromBytes(data);
          const encodedData = Encoder.bytesToBase64Url(data);

          const { message, requester, recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite({
            published: false,
            data,
          });
          const tenant = requester.did;

          // setting up a stub DID resolver
          TestStubGenerator.stubDidResolver(didResolver, [requester]);

          const reply = await dwn.processMessage(tenant, message, dataStream);
          expect(reply.status.code).to.equal(202);

          expect(asyncGeneratorToArray(dataForCid.db.keys())).to.eventually.eql([ dataCid ]);

          const newWrite = await RecordsWrite.createFrom({
            unsignedRecordsWriteMessage : recordsWrite.message,
            published                   : true,
            authorizationSignatureInput : Jws.createSignatureInput(requester)
          });

          const newWriteReply = await dwn.processMessage(tenant, newWrite.message);
          expect(newWriteReply.status.code).to.equal(202);

          expect(asyncGeneratorToArray(dataForCid.db.keys())).to.eventually.eql([ dataCid ]);

          // verify the new record state can be queried
          const recordsQueryMessageData = await TestDataGenerator.generateRecordsQuery({
            requester,
            filter: { recordId: message.recordId }
          });

          const recordsQueryReply = await dwn.processMessage(tenant, recordsQueryMessageData.message);
          expect(recordsQueryReply.status.code).to.equal(200);
          expect(recordsQueryReply.entries?.length).to.equal(1);
          expect((recordsQueryReply.entries![0] as RecordsWriteMessage).descriptor.published).to.equal(true);

          // very importantly verify the original data is still returned
          expect(recordsQueryReply.entries![0].encodedData).to.equal(encodedData);

          expect(asyncGeneratorToArray(dataForCid.db.keys())).to.eventually.eql([ dataCid ]);
        });

        it('should inherit parent published state when using createFrom() to create RecordsWrite', async () => {
          const { message, requester, recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite({
            published: true
          });
          const tenant = requester.did;

          // setting up a stub DID resolver
          TestStubGenerator.stubDidResolver(didResolver, [requester]);
          const reply = await dwn.processMessage(tenant, message, dataStream);

          expect(reply.status.code).to.equal(202);

          const newData = Encoder.stringToBytes('new data');
          const newWrite = await RecordsWrite.createFrom({
            unsignedRecordsWriteMessage : recordsWrite.message,
            data                        : newData,
            authorizationSignatureInput : Jws.createSignatureInput(requester)
          });

          const newWriteReply = await dwn.processMessage(tenant, newWrite.message, DataStream.fromBytes(newData));

          expect(newWriteReply.status.code).to.equal(202);

          // verify the new record state can be queried
          const recordsQueryMessageData = await TestDataGenerator.generateRecordsQuery({
            requester,
            filter: { recordId: message.recordId }
          });

          const recordsQueryReply = await dwn.processMessage(tenant, recordsQueryMessageData.message);
          expect(recordsQueryReply.status.code).to.equal(200);
          expect(recordsQueryReply.entries?.length).to.equal(1);

          const recordsWriteReturned = recordsQueryReply.entries![0] as RecordsWriteMessage;
          expect((recordsWriteReturned as QueryResultEntry).encodedData).to.equal(Encoder.bytesToBase64Url(newData));
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

        TestStubGenerator.stubDidResolver(didResolver, [requester]);
        const reply = await dwn.processMessage(tenant, message, dataStream);

        expect(reply.status.code).to.equal(400);
        expect(reply.status.detail).to.contain('initial write is not found');
      });

      it('should return 400 if `dateCreated` and `dateModified` are not the same in an initial write', async () => {
        const { requester, message, dataStream } = await TestDataGenerator.generateRecordsWrite({
          dateCreated  : '2023-01-10T10:20:30.405060',
          dateModified : getCurrentTimeInHighPrecision() // this always generate a different timestamp
        });
        const tenant = requester.did;

        TestStubGenerator.stubDidResolver(didResolver, [requester]);

        const reply = await dwn.processMessage(tenant, message, dataStream);

        expect(reply.status.code).to.equal(400);
        expect(reply.status.detail).to.contain('must match dateCreated');
      });

      it('should return 400 if `contextId` in an initial protocol-base write mismatches with the expected deterministic `contextId`', async () => {
        // generate a message with protocol so that computed contextId is also computed and included in message
        const { message, dataStream, requester } = await TestDataGenerator.generateRecordsWrite({ protocol: 'anyValue' });

        message.contextId = await TestDataGenerator.randomCborSha256Cid(); // make contextId mismatch from computed value

        TestStubGenerator.stubDidResolver(didResolver, [requester]);

        const reply = await dwn.processMessage('unused-tenant-DID', message, dataStream);
        expect(reply.status.code).to.equal(400);
        expect(reply.status.detail).to.contain('does not match deterministic contextId');
      });

      describe('event log', () => {
        it('should add an event to the eventlog on initial write', async () => {
          const { message, requester, dataStream } = await TestDataGenerator.generateRecordsWrite();
          TestStubGenerator.stubDidResolver(didResolver, [requester]);

          const reply = await dwn.processMessage(requester.did, message, dataStream);
          expect(reply.status.code).to.equal(202);

          const events = await eventLog.getEvents(requester.did);
          expect(events.length).to.equal(1);

          const messageCid = await Message.getCid(message);
          expect(events[0].messageCid).to.equal(messageCid);
        });

        it('should only keep first write and latest write when subsequent writes happen', async () => {
          const { message, requester, dataStream, recordsWrite } = await TestDataGenerator.generateRecordsWrite();
          TestStubGenerator.stubDidResolver(didResolver, [requester]);

          const reply = await dwn.processMessage(requester.did, message, dataStream);
          expect(reply.status.code).to.equal(202);

          const newWrite = await RecordsWrite.createFrom({
            unsignedRecordsWriteMessage : recordsWrite.message,
            published                   : true,
            authorizationSignatureInput : Jws.createSignatureInput(requester)
          });

          const newWriteReply = await dwn.processMessage(requester.did, newWrite.message);
          expect(newWriteReply.status.code).to.equal(202);

          const newestWrite = await RecordsWrite.createFrom({
            unsignedRecordsWriteMessage : recordsWrite.message,
            published                   : true,
            authorizationSignatureInput : Jws.createSignatureInput(requester)
          });

          const newestWriteReply = await dwn.processMessage(requester.did, newestWrite.message);
          expect(newestWriteReply.status.code).to.equal(202);

          const events = await eventLog.getEvents(requester.did);
          expect(events.length).to.equal(2);

          const deletedMessageCid = await Message.getCid(newWrite.message);

          for (const { messageCid } of events) {
            if (messageCid === deletedMessageCid ) {
              expect.fail(`${messageCid} should not exist`);
            }
          }
        });
      });
    });

    describe('protocol based writes', () => {
      it('should allow write with allow-anyone rule', async () => {
        // scenario, Bob writes into Alice's DWN given Alice's "email" protocol allow-anyone rule

        // write a protocol definition with an allow-anyone rule
        const protocol = 'email-protocol';
        const protocolDefinition: ProtocolDefinition = emailProtocolDefinition;
        const alice = await TestDataGenerator.generatePersona();
        const bob = await TestDataGenerator.generatePersona();

        const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
          requester: alice,
          protocol,
          protocolDefinition
        });

        // setting up a stub DID resolver
        TestStubGenerator.stubDidResolver(didResolver, [alice, bob]);

        const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message, protocolsConfig.dataStream);
        expect(protocolsConfigureReply.status.code).to.equal(202);

        // generate a `RecordsWrite` message from bob
        const bobData = Encoder.stringToBytes('data from bob');
        const emailFromBob = await TestDataGenerator.generateRecordsWrite(
          {
            requester : bob,
            protocol,
            schema    : 'email',
            data      : bobData
          }
        );

        const bobWriteReply = await dwn.processMessage(alice.did, emailFromBob.message, emailFromBob.dataStream);
        expect(bobWriteReply.status.code).to.equal(202);

        // verify bob's message got written to the DB
        const messageDataForQueryingBobsWrite = await TestDataGenerator.generateRecordsQuery({
          requester : alice,
          filter    : { recordId: emailFromBob.message.recordId }
        });
        const bobRecordQueryReply = await dwn.processMessage(alice.did, messageDataForQueryingBobsWrite.message);
        expect(bobRecordQueryReply.status.code).to.equal(200);
        expect(bobRecordQueryReply.entries?.length).to.equal(1);
        expect(bobRecordQueryReply.entries![0].encodedData).to.equal(Encoder.bytesToBase64Url(bobData));
      });

      it('should allow write with recipient rule', async () => {
        // scenario: VC issuer writes into Alice's DWN an asynchronous credential response upon receiving Alice's credential application

        const protocol = 'https://identity.foundation/decentralized-web-node/protocols/credential-issuance';
        const protocolDefinition: ProtocolDefinition = credentialIssuanceProtocolDefinition;
        const credentialApplicationSchema = protocolDefinition.labels.credentialApplication.schema;
        const credentialResponseSchema = protocolDefinition.labels.credentialResponse.schema;

        const alice = await TestDataGenerator.generatePersona();
        const vcIssuer = await TestDataGenerator.generatePersona();

        const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
          requester: alice,
          protocol,
          protocolDefinition
        });

        // setting up a stub DID resolver
        TestStubGenerator.stubDidResolver(didResolver, [alice, vcIssuer]);

        const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message, protocolsConfig.dataStream);
        expect(protocolWriteReply.status.code).to.equal(202);

        // write a credential application to Alice's DWN to simulate that she has sent a credential application to a VC issuer
        const encodedCredentialApplication = new TextEncoder().encode('credential application data');
        const credentialApplication = await TestDataGenerator.generateRecordsWrite({
          requester    : alice,
          recipientDid : vcIssuer.did,
          protocol,
          schema       : credentialApplicationSchema,
          data         : encodedCredentialApplication
        });
        const credentialApplicationContextId = await credentialApplication.recordsWrite.getEntryId();

        const credentialApplicationReply = await dwn.processMessage(alice.did, credentialApplication.message, credentialApplication.dataStream);
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

        const credentialResponseReply = await dwn.processMessage(alice.did, credentialResponse.message, credentialResponse.dataStream);
        expect(credentialResponseReply.status.code).to.equal(202);

        // verify VC issuer's message got written to the DB
        const messageDataForQueryingCredentialResponse = await TestDataGenerator.generateRecordsQuery({
          requester : alice,
          filter    : { recordId: credentialResponse.message.recordId }
        });
        const applicationResponseQueryReply = await dwn.processMessage(alice.did, messageDataForQueryingCredentialResponse.message);
        expect(applicationResponseQueryReply.status.code).to.equal(200);
        expect(applicationResponseQueryReply.entries?.length).to.equal(1);
        expect(applicationResponseQueryReply.entries![0].encodedData)
          .to.equal(base64url.baseEncode(encodedCredentialResponse));
      });

      it('should allow author to write with author rule and block non-authors', async () => {
        // scenario: Alice posts an image on the social media protocol to Bob's, then she adds a caption
        //           AliceImposter attempts to post add a caption to Alice's image, but is blocked
        const protocol = 'https://tbd.website/decentralized-web-node/protocols/social-media';
        const protocolDefinition: ProtocolDefinition = socialMediaProtocolDefinition;

        const alice = await TestDataGenerator.generatePersona();
        const aliceImposter = await TestDataGenerator.generatePersona();
        const bob = await TestDataGenerator.generatePersona();

        // setting up a stub DID resolver
        TestStubGenerator.stubDidResolver(didResolver, [alice, aliceImposter, bob]);

        // Install social-media protocol
        const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
          requester: bob,
          protocol,
          protocolDefinition
        });
        const protocolWriteReply = await dwn.processMessage(bob.did, protocolsConfig.message, protocolsConfig.dataStream);
        expect(protocolWriteReply.status.code).to.equal(202);

        // Alice writes image to bob's DWN
        const encodedImage = new TextEncoder().encode('cafe-aesthetic.jpg');
        const imageRecordsWrite = await TestDataGenerator.generateRecordsWrite({
          requester : alice,
          protocol,
          schema    : socialMediaProtocolDefinition.labels.image.schema,
          data      : encodedImage
        });
        const imageReply = await dwn.processMessage(bob.did, imageRecordsWrite.message, imageRecordsWrite.dataStream);
        expect(imageReply.status.code).to.equal(202);

        const imageContextId = await imageRecordsWrite.recordsWrite.getEntryId();

        // AliceImposter attempts and fails to caption Alice's image
        const encodedCaptionImposter = new TextEncoder().encode('bad vibes! >:(');
        const captionImposter = await TestDataGenerator.generateRecordsWrite({
          requester : aliceImposter,
          protocol,
          schema    : socialMediaProtocolDefinition.labels.caption.schema,
          contextId : imageContextId,
          parentId  : imageContextId,
          data      : encodedCaptionImposter
        });
        const captionReply = await dwn.processMessage(bob.did, captionImposter.message, captionImposter.dataStream);
        expect(captionReply.status.code).to.equal(401);
        expect(captionReply.status.detail).to.contain('inbound message action \'write\' not in list of allowed actions ');

        // Alice is able to add a caption to her image
        const encodedCaption = new TextEncoder().encode('coffee and work vibes!');
        const captionRecordsWrite = await TestDataGenerator.generateRecordsWrite({
          requester : alice,
          protocol,
          schema    : socialMediaProtocolDefinition.labels.caption.schema,
          contextId : imageContextId,
          parentId  : imageContextId,
          data      : encodedCaption
        });
        const captionResponse = await dwn.processMessage(bob.did, captionRecordsWrite.message, captionRecordsWrite.dataStream);
        expect(captionResponse.status.code).to.equal(202);

        // Verify Alice's caption got written to the DB
        const messageDataForQueryingCaptionResponse = await TestDataGenerator.generateRecordsQuery({
          requester : alice,
          filter    : { recordId: captionRecordsWrite.message.recordId }
        });
        const applicationResponseQueryReply = await dwn.processMessage(bob.did, messageDataForQueryingCaptionResponse.message);
        expect(applicationResponseQueryReply.status.code).to.equal(200);
        expect(applicationResponseQueryReply.entries?.length).to.equal(1);
        expect(applicationResponseQueryReply.entries![0].encodedData)
          .to.equal(base64url.baseEncode(encodedCaption));
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
        const bob = await TestDataGenerator.generatePersona();

        const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
          requester: alice,
          protocol,
          protocolDefinition
        });

        // setting up a stub DID resolver
        TestStubGenerator.stubDidResolver(didResolver, [alice, bob]);

        const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message, protocolsConfig.dataStream);
        expect(protocolWriteReply.status.code).to.equal(202);

        // generate a `RecordsWrite` message from bob
        const bobData = new TextEncoder().encode('data from bob');
        const notesFromBob = await TestDataGenerator.generateRecordsWrite(
          {
            requester : bob,
            protocol,
            schema    : 'notes',
            data      : bobData
          }
        );

        const bobWriteReply = await dwn.processMessage(alice.did, notesFromBob.message, notesFromBob.dataStream);
        expect(bobWriteReply.status.code).to.equal(202);

        // verify bob's message got written to the DB
        const messageDataForQueryingBobsWrite = await TestDataGenerator.generateRecordsQuery({
          requester : alice,
          filter    : { recordId: notesFromBob.message.recordId }
        });
        const bobRecordQueryReply = await dwn.processMessage(alice.did, messageDataForQueryingBobsWrite.message);
        expect(bobRecordQueryReply.status.code).to.equal(200);
        expect(bobRecordQueryReply.entries?.length).to.equal(1);
        expect(bobRecordQueryReply.entries![0].encodedData).to.equal(base64url.baseEncode(bobData));

        // generate a new message from bob updating the existing notes
        const newNotesBytes = Encoder.stringToBytes('new data from bob');
        const newNotesFromBob = await TestDataGenerator.generateFromRecordsWrite({
          requester     : bob,
          existingWrite : notesFromBob.recordsWrite,
          data          : newNotesBytes
        });

        const newWriteReply = await dwn.processMessage(alice.did, newNotesFromBob.message, newNotesFromBob.dataStream);
        expect(newWriteReply.status.code).to.equal(202);

        // verify bob's message got written to the DB
        const newRecordQueryReply = await dwn.processMessage(alice.did, messageDataForQueryingBobsWrite.message);
        expect(newRecordQueryReply.status.code).to.equal(200);
        expect(newRecordQueryReply.entries?.length).to.equal(1);
        expect(newRecordQueryReply.entries![0].encodedData).to.equal(Encoder.bytesToBase64Url(newNotesBytes));
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
        const bob = await TestDataGenerator.generatePersona();
        const carol = await TestDataGenerator.generatePersona();

        const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
          requester: alice,
          protocol,
          protocolDefinition
        });

        // setting up a stub DID resolver
        TestStubGenerator.stubDidResolver(didResolver, [alice, bob, carol]);

        const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message, protocolsConfig.dataStream);
        expect(protocolWriteReply.status.code).to.equal(202);

        // generate a `RecordsWrite` message from bob
        const bobData = new TextEncoder().encode('data from bob');
        const notesFromBob = await TestDataGenerator.generateRecordsWrite(
          {
            requester : bob,
            protocol,
            schema    : 'notes',
            data      : bobData
          }
        );

        const bobWriteReply = await dwn.processMessage(alice.did, notesFromBob.message, notesFromBob.dataStream);
        expect(bobWriteReply.status.code).to.equal(202);

        // verify bob's message got written to the DB
        const messageDataForQueryingBobsWrite = await TestDataGenerator.generateRecordsQuery({
          requester : alice,
          filter    : { recordId: notesFromBob.message.recordId }
        });
        const bobRecordQueryReply = await dwn.processMessage(alice.did, messageDataForQueryingBobsWrite.message);
        expect(bobRecordQueryReply.status.code).to.equal(200);
        expect(bobRecordQueryReply.entries?.length).to.equal(1);
        expect(bobRecordQueryReply.entries![0].encodedData).to.equal(base64url.baseEncode(bobData));

        // generate a new message from carol updating the existing notes, which should not be allowed/accepted
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

        const carolWriteReply = await dwn.processMessage(alice.did, newNotesFromBob.message, newNotesFromBob.dataStream);
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
        const bob = await TestDataGenerator.generatePersona();

        const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
          requester: alice,
          protocol,
          protocolDefinition
        });

        // setting up a stub DID resolver
        TestStubGenerator.stubDidResolver(didResolver, [alice, bob]);

        const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message, protocolsConfig.dataStream);
        expect(protocolWriteReply.status.code).to.equal(202);

        // generate a `RecordsWrite` message from bob
        const bobData = new TextEncoder().encode('data from bob');
        const notesFromBob = await TestDataGenerator.generateRecordsWrite(
          {
            requester : bob,
            protocol,
            schema    : 'notes',
            data      : bobData
          }
        );

        const bobWriteReply = await dwn.processMessage(alice.did, notesFromBob.message, notesFromBob.dataStream);
        expect(bobWriteReply.status.code).to.equal(202);

        // verify bob's message got written to the DB
        const messageDataForQueryingBobsWrite = await TestDataGenerator.generateRecordsQuery({
          requester : alice,
          filter    : { recordId: notesFromBob.message.recordId }
        });
        const bobRecordQueryReply = await dwn.processMessage(alice.did, messageDataForQueryingBobsWrite.message);
        expect(bobRecordQueryReply.status.code).to.equal(200);
        expect(bobRecordQueryReply.entries?.length).to.equal(1);
        expect(bobRecordQueryReply.entries![0].encodedData).to.equal(base64url.baseEncode(bobData));

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

        const newWriteReply = await dwn.processMessage(alice.did, newNotesFromBob.message, newNotesFromBob.dataStream);
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
        const fakeVcIssuer = await TestDataGenerator.generatePersona();

        const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
          requester: alice,
          protocol,
          protocolDefinition
        });

        // setting up a stub DID resolver
        TestStubGenerator.stubDidResolver(didResolver, [alice, fakeVcIssuer]);

        const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message, protocolsConfig.dataStream);
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

        const credentialApplicationReply = await dwn.processMessage(alice.did, credentialApplication.message, credentialApplication.dataStream);
        expect(credentialApplicationReply.status.code).to.equal(202);

        // generate a credential application response message from a fake VC issuer
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

        const credentialResponseReply = await dwn.processMessage(alice.did, credentialResponse.message, credentialResponse.dataStream);
        expect(credentialResponseReply.status.code).to.equal(401);
        expect(credentialResponseReply.status.detail).to.contain('inbound message action \'write\' not in list of allowed actions ');
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

        const reply = await dwn.processMessage(alice.did, credentialApplication.message, credentialApplication.dataStream);
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

        const protocolConfigureReply = await dwn.processMessage(alice.did, protocolConfig.message, protocolConfig.dataStream);
        expect(protocolConfigureReply.status.code).to.equal(202);

        const data = Encoder.stringToBytes('any data');
        const credentialApplication = await TestDataGenerator.generateRecordsWrite({
          requester    : alice,
          recipientDid : alice.did,
          protocol,
          schema       : 'unexpectedSchema',
          data
        });

        const reply = await dwn.processMessage(alice.did, credentialApplication.message, credentialApplication.dataStream);
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

        const protocolConfigureReply = await dwn.processMessage(alice.did, protocolConfig.message, protocolConfig.dataStream);
        expect(protocolConfigureReply.status.code).to.equal(202);

        const data = Encoder.stringToBytes('any data');
        const credentialApplication = await TestDataGenerator.generateRecordsWrite({
          requester    : alice,
          recipientDid : alice.did,
          protocol,
          schema       : credentialResponseSchema, // this is an known schema type, but not allowed for a protocol root record
          data
        });

        const reply = await dwn.processMessage(alice.did, credentialApplication.message, credentialApplication.dataStream);
        expect(reply.status.code).to.equal(401);
        expect(reply.status.detail).to.contain('not allowed in structure level');
      });

      it('should fail authorization if record schema is not allowed at the hierarchical level attempted for the RecordsWrite', async () => {
        const alice = await DidKeyResolver.generate();

        const protocol = 'chatProtocol';
        const protocolDefinition = {
          labels: {
            email: {
              schema: 'emailSchema'
            },
            sms: {
              schema: 'smsSchema'
            }
          },
          records: {
            email : {},
            sms   : {}
          }
        };
        const protocolConfig = await TestDataGenerator.generateProtocolsConfigure({
          requester: alice,
          protocol,
          protocolDefinition
        });

        const protocolConfigureReply = await dwn.processMessage(alice.did, protocolConfig.message, protocolConfig.dataStream);
        expect(protocolConfigureReply.status.code).to.equal(202);

        const emailRecordsWrite = await TestDataGenerator.generateRecordsWrite({
          requester    : alice,
          recipientDid : alice.did,
          protocol,
          schema       : protocolDefinition.labels.email.schema,
          data         : Encoder.stringToBytes('any data'),
        });
        await dwn.processMessage(alice.did, emailRecordsWrite.message, emailRecordsWrite.dataStream);

        const smsSchemaResponse = await TestDataGenerator.generateRecordsWrite({
          requester    : alice,
          recipientDid : alice.did,
          protocol,
          schema       : protocolDefinition.labels.sms.schema, // SMS are allowed, but not as a child record of emails
          data         : Encoder.stringToBytes('any other data'),
          parentId     : emailRecordsWrite.message.recordId,
          contextId    : await emailRecordsWrite.recordsWrite.getEntryId()
        });
        const reply = await dwn.processMessage(alice.did, smsSchemaResponse.message, smsSchemaResponse.dataStream);

        expect(reply.status.code).to.equal(401);
        expect(reply.status.detail).to.contain('record with schema: \'smsSchema\' not allowed in structure level 1');
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

        const protocolConfigureReply = await dwn.processMessage(alice.did, protocolConfig.message, protocolConfig.dataStream);
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

        let reply = await dwn.processMessage(alice.did, aliceWriteMessageData.message, aliceWriteMessageData.dataStream);
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

        reply = await dwn.processMessage(alice.did, bobWriteMessageData.message, bobWriteMessageData.dataStream);
        expect(reply.status.code).to.equal(401);
        expect(reply.status.detail).to.contain(`no allow rule defined for Write`);
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

        const protocolConfigureReply = await dwn.processMessage(alice.did, protocolConfig.message, protocolConfig.dataStream);
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

        let reply = await dwn.processMessage(alice.did, messageDataWithIssuerA.message, messageDataWithIssuerA.dataStream);
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

        reply = await dwn.processMessage(alice.did, invalidResponseByIssuerA.message, invalidResponseByIssuerA.dataStream);
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

        const protocolConfigureReply = await dwn.processMessage(alice.did, protocolConfig.message, protocolConfig.dataStream);
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

        let reply = await dwn.processMessage(alice.did, messageDataWithIssuerA.message, messageDataWithIssuerA.dataStream);
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

        reply = await dwn.processMessage(alice.did, invalidResponseByIssuerA.message, invalidResponseByIssuerA.dataStream);
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

        const protocolConfigureReply = await dwn.processMessage(pfi.did, protocolConfig.message, protocolConfig.dataStream);
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

        let reply = await dwn.processMessage(pfi.did, askMessageData.message, askMessageData.dataStream);
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

        reply = await dwn.processMessage(pfi.did, offerMessageData.message, offerMessageData.dataStream);
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
        reply = await dwn.processMessage(pfi.did, fulfillmentMessageData.message, fulfillmentMessageData.dataStream);
        expect(reply.status.code).to.equal(202);

        // verify the fulfillment message is stored
        const recordsQueryMessageData = await TestDataGenerator.generateRecordsQuery({
          requester : pfi,
          filter    : { recordId: fulfillmentMessageData.message.recordId }
        });

        // verify the data is written
        const recordsQueryReply = await dwn.processMessage(
          pfi.did, recordsQueryMessageData.message);
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

        const protocolConfigureReply = await dwn.processMessage(pfi.did, protocolConfig.message, protocolConfig.dataStream);
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

        let reply = await dwn.processMessage(pfi.did, askMessageData.message, askMessageData.dataStream);
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
        reply = await dwn.processMessage(pfi.did, fulfillmentMessageData.message, fulfillmentMessageData.dataStream);
        expect(reply.status.code).to.equal(401);
        expect(reply.status.detail).to.contain('no parent found');
      });

      it('should 400 if expected CID of `encryption` mismatches the `encryptionCid` in `authorization`', async () => {
        const alice = await TestDataGenerator.generatePersona();
        TestStubGenerator.stubDidResolver(didResolver, [alice]);

        // configure protocol
        const protocol = 'email-protocol';
        const protocolDefinition: ProtocolDefinition = emailProtocolDefinition;
        const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
          requester: alice,
          protocol,
          protocolDefinition
        });

        const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message, protocolsConfig.dataStream);
        expect(protocolsConfigureReply.status.code).to.equal(202);

        const bobMessageBytes = Encoder.stringToBytes('message from bob');
        const bobMessageStream = DataStream.fromBytes(bobMessageBytes);
        const dataEncryptionInitializationVector = TestDataGenerator.randomBytes(16);
        const dataEncryptionKey = TestDataGenerator.randomBytes(32);
        const bobMessageEncryptedStream = await Encryption.aes256CtrEncrypt(dataEncryptionKey, dataEncryptionInitializationVector, bobMessageStream);
        const bobMessageEncryptedBytes = await DataStream.toBytes(bobMessageEncryptedStream);

        const encryptionInput: EncryptionInput = {
          algorithm            : EncryptionAlgorithm.Aes256Ctr,
          initializationVector : dataEncryptionInitializationVector,
          key                  : dataEncryptionKey,
          keyEncryptionInputs  : [{
            algorithm : EncryptionAlgorithm.EciesSecp256k1,
            publicKey : {
              derivationScheme : KeyDerivationScheme.ProtocolContext,
              derivationPath   : [],
              derivedPublicKey : alice.keyPair.publicJwk // reusing signing key for encryption purely as a convenience
            }
          }]
        };
        const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({
          requester : alice,
          protocol,
          schema    : 'email',
          data      : bobMessageEncryptedBytes,
          encryptionInput
        });

        // replace valid `encryption` property with a mismatching one
        message.encryption!.initializationVector = Encoder.stringToBase64Url('any value which will result in a different CID');

        const recordsWriteHandler = new RecordsWriteHandler(didResolver, messageStore, dataStore, eventLog);
        const writeReply = await recordsWriteHandler.handle({ tenant: alice.did, message, dataStream: dataStream! });

        expect(writeReply.status.code).to.equal(400);
        expect(writeReply.status.detail).to.contain(DwnErrorCode.RecordsWriteValidateIntegrityEncryptionCidMismatch);
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
      const dataStore = sinon.createStubInstance(DataStoreLevel);

      const recordsWriteHandler = new RecordsWriteHandler(didResolver, messageStore, dataStore, eventLog);
      const reply = await recordsWriteHandler.handle({ tenant, message, dataStream: dataStream! });

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
      const dataStore = sinon.createStubInstance(DataStoreLevel);

      const recordsWriteHandler = new RecordsWriteHandler(didResolver, messageStore, dataStore, eventLog);
      const reply = await recordsWriteHandler.handle({ tenant, message, dataStream: dataStream! });

      expect(reply.status.code).to.equal(400);
      expect(reply.status.detail).to.contain('does not match contextId in authorization');
    });

    it('should return 401 if `authorization` signature check fails', async () => {
      const { requester, message, dataStream } = await TestDataGenerator.generateRecordsWrite();
      const tenant = requester.did;

      // setting up a stub DID resolver & message store
      // intentionally not supplying the public key so a different public key is generated to simulate invalid signature
      const mismatchingPersona = await TestDataGenerator.generatePersona({ did: requester.did, keyId: requester.keyId });
      const didResolver = TestStubGenerator.createDidResolverStub(mismatchingPersona);
      const messageStore = sinon.createStubInstance(MessageStoreLevel);
      const dataStore = sinon.createStubInstance(DataStoreLevel);

      const recordsWriteHandler = new RecordsWriteHandler(didResolver, messageStore, dataStore, eventLog);
      const reply = await recordsWriteHandler.handle({ tenant, message, dataStream: dataStream! });

      expect(reply.status.code).to.equal(401);
    });

    it('should return 401 if an unauthorized requester is attempting write', async () => {
      const requester = await TestDataGenerator.generatePersona();
      const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ requester });

      // setting up a stub DID resolver & message store
      const didResolver = TestStubGenerator.createDidResolverStub(requester);
      const messageStore = sinon.createStubInstance(MessageStoreLevel);
      const dataStore = sinon.createStubInstance(DataStoreLevel);

      const recordsWriteHandler = new RecordsWriteHandler(didResolver, messageStore, dataStore, eventLog);

      const tenant = await (await TestDataGenerator.generatePersona()).did; // unauthorized tenant
      const reply = await recordsWriteHandler.handle({ tenant, message, dataStream: dataStream! });

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
      const dataStore = sinon.createStubInstance(DataStoreLevel);

      const recordsWriteHandler = new RecordsWriteHandler(didResolver, messageStore, dataStore, eventLog);
      const reply = await recordsWriteHandler.handle({ tenant, message, dataStream: dataStream! });

      expect(reply.status.code).to.equal(400);
      expect(reply.status.detail).to.contain(`Only 'descriptorCid' is allowed in attestation payload`);
    });

    it('should fail validation with 400 if more than 1 attester is given ', async () => {
      const alice = await DidKeyResolver.generate();
      const bob = await DidKeyResolver.generate();
      const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ requester: alice, attesters: [alice, bob] });

      const recordsWriteHandler = new RecordsWriteHandler(didResolver, messageStore, dataStore, eventLog);
      const writeReply = await recordsWriteHandler.handle({ tenant: alice.did, message, dataStream: dataStream! });

      expect(writeReply.status.code).to.equal(400);
      expect(writeReply.status.detail).to.contain('implementation only supports 1 attester');
    });

    it('should fail validation with 400 if the `attestation` does not include the correct `descriptorCid`', async () => {
      const alice = await DidKeyResolver.generate();
      const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ requester: alice, attesters: [alice] });

      // create another write and use its `attestation` value instead, that `attestation` will point to an entirely different `descriptorCid`
      const anotherWrite = await TestDataGenerator.generateRecordsWrite({ attesters: [alice] });
      message.attestation = anotherWrite.message.attestation;

      const recordsWriteHandler = new RecordsWriteHandler(didResolver, messageStore, dataStore, eventLog);
      const writeReply = await recordsWriteHandler.handle({ tenant: alice.did, message, dataStream: dataStream! });

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

      const recordsWriteHandler = new RecordsWriteHandler(didResolver, messageStore, dataStore, eventLog);
      const writeReply = await recordsWriteHandler.handle({ tenant: alice.did, message, dataStream: dataStream! });

      expect(writeReply.status.code).to.equal(400);
      expect(writeReply.status.detail).to.contain('does not match attestationCid');
    });
  });

  it('should throw if `storageController.put()` throws unknown error', async () => {
    const { requester, message, dataStream } = await TestDataGenerator.generateRecordsWrite();
    const tenant = requester.did;

    const didResolverStub = TestStubGenerator.createDidResolverStub(requester);

    const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);
    messageStoreStub.query.resolves([]);

    // simulate throwing unexpected error
    sinon.stub(StorageController, 'put').throws(new Error('an unknown error in messageStore.put()'));

    const dataStoreStub = sinon.createStubInstance(DataStoreLevel);

    const recordsWriteHandler = new RecordsWriteHandler(didResolverStub, messageStoreStub, dataStoreStub, eventLog);

    const handlerPromise = recordsWriteHandler.handle({ tenant, message, dataStream: dataStream! });
    await expect(handlerPromise).to.be.rejectedWith('an unknown error in messageStore.put()');
  });
});
