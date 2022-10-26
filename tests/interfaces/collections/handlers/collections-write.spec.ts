import * as encoder from '../../../../src/utils/encoder';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import credentialIssuanceProtocolDefinition from '../../../vectors/protocol-definition-credential-issuance.json' assert { type: 'json' };
import sinon from 'sinon';
import { base64url } from 'multiformats/bases/base64';
import { CollectionsWriteMessage } from '../../../../src/interfaces/collections/types';
import { DidKeyResolver } from '../../../../src/did/did-key-resolver';
import { DidResolver } from '../../../../src/did/did-resolver';
import { GenerateCollectionsWriteMessageOutput, TestDataGenerator } from '../../../utils/test-data-generator';
import { handleCollectionsQuery } from '../../../../src/interfaces/collections/handlers/collections-query';
import { handleCollectionsWrite } from '../../../../src/interfaces/collections/handlers/collections-write';
import { handleProtocolsConfigure } from '../../../../src/interfaces/protocols/handlers/protocols-configure';
import { Message } from '../../../../src/core';
import { MessageStoreLevel } from '../../../../src/store/message-store-level';
import { ProtocolDefinition } from '../../../../src';
import { TestStubGenerator } from '../../../utils/test-stub-generator';
import { v4 as uuidv4 } from 'uuid';

chai.use(chaiAsPromised);

describe('handleCollectionsWrite()', () => {
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

    it('should only be able to overwrite existing record if new record has a later `dateCreated` value', async () => {
      // write a message into DB
      const requester = await TestDataGenerator.generatePersona();
      const target = requester;
      const recordId = uuidv4();
      const data1 = new TextEncoder().encode('data1');
      const collectionsWriteMessageData = await TestDataGenerator.generateCollectionsWriteMessage({ requester, target, recordId, data: data1 });

      // setting up a stub did resolver
      const didResolverStub = TestStubGenerator.createDidResolverStub(requester);

      const collectionsWriteReply = await handleCollectionsWrite(collectionsWriteMessageData.message, messageStore, didResolverStub);
      expect(collectionsWriteReply.status.code).to.equal(202);

      const collectionsQueryMessageData = await TestDataGenerator.generateCollectionsQueryMessage({
        requester,
        target,
        filter: { recordId }
      });

      // verify the message written can be queried
      const collectionsQueryReply = await handleCollectionsQuery(collectionsQueryMessageData.message, messageStore, didResolverStub);
      expect(collectionsQueryReply.status.code).to.equal(200);
      expect(collectionsQueryReply.entries?.length).to.equal(1);
      expect((collectionsQueryReply.entries![0] as CollectionsWriteMessage).encodedData).to.equal(base64url.baseEncode(data1));

      // generate and write a new CollectionsWrite to overwrite the existing record
      // a new CollectionsWrite by default will have a later `dateCreate` due to the default Date.now() call
      const data2 = new TextEncoder().encode('data2');
      const newCollectionsWriteMessageData = await TestDataGenerator.generateCollectionsWriteMessage({
        requester,
        target,
        recordId,
        data: data2 // new data value
      });
      const newCollectionsWriteReply = await handleCollectionsWrite(newCollectionsWriteMessageData.message, messageStore, didResolverStub);
      expect(newCollectionsWriteReply.status.code).to.equal(202);

      // verify new record has overwritten the existing record
      const newCollectionsQueryReply = await handleCollectionsQuery(collectionsQueryMessageData.message, messageStore, didResolverStub);

      expect(newCollectionsQueryReply.status.code).to.equal(200);
      expect(newCollectionsQueryReply.entries?.length).to.equal(1);
      expect((newCollectionsQueryReply.entries![0] as CollectionsWriteMessage).encodedData).to.equal(base64url.baseEncode(data2));

      // try to write the older message to store again and verify that it is not accepted
      const thirdCollectionsWriteReply = await handleCollectionsWrite(collectionsWriteMessageData.message, messageStore, didResolverStub);
      expect(thirdCollectionsWriteReply.status.code).to.equal(409); // expecting to fail

      // expecting unchanged
      const thirdCollectionsQueryReply = await handleCollectionsQuery(collectionsQueryMessageData.message, messageStore, didResolverStub);
      expect(thirdCollectionsQueryReply.status.code).to.equal(200);
      expect(thirdCollectionsQueryReply.entries?.length).to.equal(1);
      expect((thirdCollectionsQueryReply.entries![0] as CollectionsWriteMessage).encodedData).to.equal(base64url.baseEncode(data2));
    });

    it('should only be able to overwrite existing record if new message CID is larger when `dateCreated` value is the same', async () => {
      // generate two messages with the same `dateCreated` value
      const requester = await TestDataGenerator.generatePersona();
      const target = requester;
      const recordId = uuidv4();
      const dateCreated = Date.now();
      const collectionsWriteMessageData1 = await TestDataGenerator.generateCollectionsWriteMessage({
        requester,
        target,
        recordId,
        dateCreated,
        data: new TextEncoder().encode('data1')
      });

      const collectionsWriteMessageData2 = await TestDataGenerator.generateCollectionsWriteMessage({
        requester,
        target,
        recordId,
        dateCreated, // simulate the exact same dateCreated as message 1 above
        data: new TextEncoder().encode('data2') // a different CID value
      });

      // determine the lexicographical order of the two messages
      const message1Cid = await Message.getCid(collectionsWriteMessageData1.message);
      const message2Cid = await Message.getCid(collectionsWriteMessageData2.message);
      let largerCollectionWriteMessageData: GenerateCollectionsWriteMessageOutput;
      let smallerCollectionWriteMessageData: GenerateCollectionsWriteMessageOutput;
      if (message1Cid > message2Cid) {
        largerCollectionWriteMessageData = collectionsWriteMessageData1;
        smallerCollectionWriteMessageData = collectionsWriteMessageData2;
      } else {
        largerCollectionWriteMessageData = collectionsWriteMessageData2;
        smallerCollectionWriteMessageData = collectionsWriteMessageData1;
      }

      // setting up a stub did resolver
      const didResolverStub = TestStubGenerator.createDidResolverStub(requester);

      // write the message with the smaller lexicographical message CID first
      const collectionsWriteReply = await handleCollectionsWrite(smallerCollectionWriteMessageData.message, messageStore, didResolverStub);
      expect(collectionsWriteReply.status.code).to.equal(202);

      // query to fetch the record
      const collectionsQueryMessageData = await TestDataGenerator.generateCollectionsQueryMessage({
        requester,
        target,
        filter: { recordId }
      });

      // verify the data is written
      const collectionsQueryReply = await handleCollectionsQuery(collectionsQueryMessageData.message, messageStore, didResolverStub);
      expect(collectionsQueryReply.status.code).to.equal(200);
      expect(collectionsQueryReply.entries?.length).to.equal(1);
      expect((collectionsQueryReply.entries![0] as CollectionsWriteMessage).descriptor.dataCid)
        .to.equal(smallerCollectionWriteMessageData.message.descriptor.dataCid);

      // attempt to write the message with larger lexicographical message CID
      const newCollectionsWriteReply = await handleCollectionsWrite(largerCollectionWriteMessageData.message, messageStore, didResolverStub);
      expect(newCollectionsWriteReply.status.code).to.equal(202);

      // verify new record has overwritten the existing record
      const newCollectionsQueryReply = await handleCollectionsQuery(collectionsQueryMessageData.message, messageStore, didResolverStub);
      expect(newCollectionsQueryReply.status.code).to.equal(200);
      expect(newCollectionsQueryReply.entries?.length).to.equal(1);
      expect((newCollectionsQueryReply.entries![0] as CollectionsWriteMessage).descriptor.dataCid)
        .to.equal(largerCollectionWriteMessageData.message.descriptor.dataCid);

      // try to write the message with smaller lexicographical message CID again
      const thirdCollectionsWriteReply = await handleCollectionsWrite(
        smallerCollectionWriteMessageData.message,
        messageStore,
        didResolverStub
      );
      expect(thirdCollectionsWriteReply.status.code).to.equal(409); // expecting to fail

      // verify the message in store is still the one with larger lexicographical message CID
      const thirdCollectionsQueryReply = await handleCollectionsQuery(collectionsQueryMessageData.message, messageStore, didResolverStub);
      expect(thirdCollectionsQueryReply.status.code).to.equal(200);
      expect(thirdCollectionsQueryReply.entries?.length).to.equal(1);
      expect((thirdCollectionsQueryReply.entries![0] as CollectionsWriteMessage).descriptor.dataCid)
        .to.equal(largerCollectionWriteMessageData.message.descriptor.dataCid); // expecting unchanged
    });

    describe('protocol authorized writes', () => {
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
          requester : alice,
          target    : alice,
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
        const emailMessageDataFromBob = await TestDataGenerator.generateCollectionsWriteMessage(
          {
            requester : bob,
            target    : alice,
            protocol,
            contextId : 'bob email X',
            schema    : 'email',
            data      : bobData
          }
        );

        const bobDidResolverStub = TestStubGenerator.createDidResolverStub(bob);

        const bobWriteReply = await handleCollectionsWrite(emailMessageDataFromBob.message, messageStore, bobDidResolverStub);
        expect(bobWriteReply.status.code).to.equal(202);

        // verify bob's message got written to the DB
        const messageDataForQueryingBobsWrite = await TestDataGenerator.generateCollectionsQueryMessage({
          requester : alice,
          target    : alice,
          filter    : { recordId: emailMessageDataFromBob.message.descriptor.recordId }
        });
        const bobRecordQueryReply = await handleCollectionsQuery(messageDataForQueryingBobsWrite.message, messageStore, aliceDidResolverStub);
        expect(bobRecordQueryReply.status.code).to.equal(200);
        expect(bobRecordQueryReply.entries?.length).to.equal(1);
        expect((bobRecordQueryReply.entries![0] as CollectionsWriteMessage).encodedData).to.equal(base64url.baseEncode(bobData));
      });
    });

    it('should allow write with recipient rule', async () => {
      // scenario: VC issuer writes into Alice's DWN an asynchronous credential response upon receiving Alice's credential application

      const protocol = 'https://identity.foundation/decentralized-web-node/protocols/credential-issuance';
      const protocolDefinition = credentialIssuanceProtocolDefinition;
      const credentialApplicationSchema = protocolDefinition.labels.credentialApplication.schema;
      const credentialResponseSchema = protocolDefinition.labels.credentialResponse.schema;

      const alice = await TestDataGenerator.generatePersona();

      const protocolsConfigureMessageData = await TestDataGenerator.generateProtocolsConfigureMessage({
        requester : alice,
        target    : alice,
        protocol,
        protocolDefinition
      });

      // setting up a stub did resolver
      const aliceDidResolverStub = TestStubGenerator.createDidResolverStub(alice);

      const protocolWriteReply = await handleProtocolsConfigure(protocolsConfigureMessageData.message, messageStore, aliceDidResolverStub);
      expect(protocolWriteReply.status.code).to.equal(202);

      // write a credential application to Alice's DWN to simulate that she has sent a credential application to a VC issuer
      const vcIssuer = await TestDataGenerator.generatePersona();
      const credentialApplicationContextId = 'alice credential application thread';
      const credentialApplicationRecordId = uuidv4();
      const encodedCredentialApplication = new TextEncoder().encode('credential application data');
      const credentialApplicationMessageData = await TestDataGenerator.generateCollectionsWriteMessage({
        requester    : alice,
        target       : alice,
        recipientDid : vcIssuer.did,
        protocol ,
        contextId    : credentialApplicationContextId,
        recordId     : credentialApplicationRecordId,
        schema       : credentialApplicationSchema,
        data         : encodedCredentialApplication
      });

      const credentialApplicationReply = await handleCollectionsWrite(credentialApplicationMessageData.message, messageStore, aliceDidResolverStub);
      expect(credentialApplicationReply.status.code).to.equal(202);

      // generate a credential application response message from VC issuer
      const encodedCredentialResponse = new TextEncoder().encode('credential response data');
      const credentialResponseMessageData = await TestDataGenerator.generateCollectionsWriteMessage(
        {
          requester    : vcIssuer,
          target       : alice,
          recipientDid : alice.did,
          protocol ,
          contextId    : credentialApplicationContextId,
          parentId     : credentialApplicationRecordId,
          schema       : credentialResponseSchema,
          data         : encodedCredentialResponse
        }
      );

      const vcIssuerDidResolverStub = TestStubGenerator.createDidResolverStub(vcIssuer);

      const credentialResponseReply = await handleCollectionsWrite(credentialResponseMessageData.message, messageStore, vcIssuerDidResolverStub);
      expect(credentialResponseReply.status.code).to.equal(202);

      // verify VC issuer's message got written to the DB
      const messageDataForQueryingCredentialResponse = await TestDataGenerator.generateCollectionsQueryMessage({
        requester : alice,
        target    : alice,
        filter    : { recordId: credentialResponseMessageData.message.descriptor.recordId }
      });
      const applicationResponseQueryReply = await handleCollectionsQuery(
        messageDataForQueryingCredentialResponse.message,
        messageStore,
        aliceDidResolverStub
      );
      expect(applicationResponseQueryReply.status.code).to.equal(200);
      expect(applicationResponseQueryReply.entries?.length).to.equal(1);
      expect((applicationResponseQueryReply.entries![0] as CollectionsWriteMessage).encodedData)
        .to.equal(base64url.baseEncode(encodedCredentialResponse));
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
        requester : alice,
        target    : alice,
        protocol,
        protocolDefinition
      });

      // setting up a stub did resolver
      const aliceDidResolverStub = TestStubGenerator.createDidResolverStub(alice);

      const protocolWriteReply = await handleProtocolsConfigure(protocolsConfigureMessageData.message, messageStore, aliceDidResolverStub);
      expect(protocolWriteReply.status.code).to.equal(202);

      // write a credential application to Alice's DWN to simulate that she has sent a credential application to a VC issuer
      const vcIssuer = await TestDataGenerator.generatePersona();
      const credentialApplicationContextId = 'alice credential application thread';
      const credentialApplicationRecordId = uuidv4();
      const encodedCredentialApplication = new TextEncoder().encode('credential application data');
      const credentialApplicationMessageData = await TestDataGenerator.generateCollectionsWriteMessage({
        requester    : alice,
        target       : alice,
        recipientDid : vcIssuer.did,
        protocol ,
        contextId    : credentialApplicationContextId,
        recordId     : credentialApplicationRecordId,
        schema       : credentialApplicationSchema,
        data         : encodedCredentialApplication
      });

      const credentialApplicationReply = await handleCollectionsWrite(credentialApplicationMessageData.message, messageStore, aliceDidResolverStub);
      expect(credentialApplicationReply.status.code).to.equal(202);

      // generate a credential application response message from a fake VC issuer
      const fakeVcIssuer = await TestDataGenerator.generatePersona();
      const encodedCredentialResponse = new TextEncoder().encode('credential response data');
      const credentialResponseMessageData = await TestDataGenerator.generateCollectionsWriteMessage(
        {
          requester    : fakeVcIssuer,
          target       : alice,
          recipientDid : alice.did,
          protocol ,
          contextId    : credentialApplicationContextId,
          parentId     : credentialApplicationRecordId,
          schema       : credentialResponseSchema,
          data         : encodedCredentialResponse
        }
      );

      const vcIssuerDidResolverStub = TestStubGenerator.createDidResolverStub(fakeVcIssuer);

      const credentialResponseReply = await handleCollectionsWrite(credentialResponseMessageData.message, messageStore, vcIssuerDidResolverStub);
      expect(credentialResponseReply.status.code).to.equal(401);
      expect(credentialResponseReply.status.detail).to.contain('unexpected inbound message author');
    });

    it('should fail authorization if protocol cannot be found for a protocol-based CollectionsWrite', async () => {
      const alice = await DidKeyResolver.generate();
      const protocol = 'nonExistentProtocol';
      const data = encoder.stringToBytes('any data');
      const credentialApplicationMessageData = await TestDataGenerator.generateCollectionsWriteMessage({
        requester    : alice,
        target       : alice,
        recipientDid : alice.did,
        protocol ,
        data
      });

      const reply = await handleCollectionsWrite(credentialApplicationMessageData.message, messageStore, didResolver);
      expect(reply.status.code).to.equal(401);
      expect(reply.status.detail).to.contain('unable to find protocol definition');
    });

    it('should fail authorization if `contextId` is undefined for a protocol-based CollectionsWrite', async () => {
      const alice = await DidKeyResolver.generate();

      const protocol = 'https://identity.foundation/decentralized-web-node/protocols/credential-issuance';
      const protocolConfigureMessageData = await TestDataGenerator.generateProtocolsConfigureMessage({
        target             : alice,
        requester          : alice,
        protocol,
        protocolDefinition : credentialIssuanceProtocolDefinition
      });

      const protocolConfigureReply = await handleProtocolsConfigure(protocolConfigureMessageData.message, messageStore, didResolver);
      expect(protocolConfigureReply.status.code).to.equal(202);

      const data = encoder.stringToBytes('any data');
      const credentialApplicationMessageData = await TestDataGenerator.generateCollectionsWriteMessage({
        requester    : alice,
        target       : alice,
        recipientDid : alice.did,
        schema       : 'irrelevantValue',
        // contextId: 'aContextId', // intentionally missing
        protocol ,
        data
      });

      const reply = await handleCollectionsWrite(credentialApplicationMessageData.message, messageStore, didResolver);
      expect(reply.status.code).to.equal(401);
      expect(reply.status.detail).to.contain('`contextId` must exist');
    });

    it('should fail authorization if record schema is not an allowed type for protocol-based CollectionsWrite', async () => {
      const alice = await DidKeyResolver.generate();

      const protocol = 'https://identity.foundation/decentralized-web-node/protocols/credential-issuance';
      const protocolConfigureMessageData = await TestDataGenerator.generateProtocolsConfigureMessage({
        target             : alice,
        requester          : alice,
        protocol,
        protocolDefinition : credentialIssuanceProtocolDefinition
      });

      const protocolConfigureReply = await handleProtocolsConfigure(protocolConfigureMessageData.message, messageStore, didResolver);
      expect(protocolConfigureReply.status.code).to.equal(202);

      const data = encoder.stringToBytes('any data');
      const credentialApplicationMessageData = await TestDataGenerator.generateCollectionsWriteMessage({
        requester    : alice,
        target       : alice,
        recipientDid : alice.did,
        protocol,
        schema       : 'unexpectedSchema',
        contextId    : 'aContextId',
        data
      });

      const reply = await handleCollectionsWrite(credentialApplicationMessageData.message, messageStore, didResolver);
      expect(reply.status.code).to.equal(401);
      expect(reply.status.detail).to.equal('record with schema \'unexpectedSchema\' not allowed in protocol');
    });

    it('should fail authorization if record schema is not allowed at the hierarchical level attempted for the CollectionsWrite', async () => {
      const alice = await DidKeyResolver.generate();

      const protocol = 'https://identity.foundation/decentralized-web-node/protocols/credential-issuance';
      const protocolDefinition = credentialIssuanceProtocolDefinition;
      const protocolConfigureMessageData = await TestDataGenerator.generateProtocolsConfigureMessage({
        target    : alice,
        requester : alice,
        protocol,
        protocolDefinition
      });
      const credentialResponseSchema = protocolDefinition.labels.credentialResponse.schema;

      const protocolConfigureReply = await handleProtocolsConfigure(protocolConfigureMessageData.message, messageStore, didResolver);
      expect(protocolConfigureReply.status.code).to.equal(202);

      const data = encoder.stringToBytes('any data');
      const credentialApplicationMessageData = await TestDataGenerator.generateCollectionsWriteMessage({
        requester    : alice,
        target       : alice,
        recipientDid : alice.did,
        protocol,
        schema       : credentialResponseSchema, // this is an allowed schema type, but not allowed as a root level record
        contextId    : 'aContextId',
        data
      });

      const reply = await handleCollectionsWrite(credentialApplicationMessageData.message, messageStore, didResolver);
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
          privateNote: { }
        }
      };
      const protocolConfigureMessageData = await TestDataGenerator.generateProtocolsConfigureMessage({
        target    : alice,
        requester : alice,
        protocol,
        protocolDefinition
      });

      const protocolConfigureReply = await handleProtocolsConfigure(protocolConfigureMessageData.message, messageStore, didResolver);
      expect(protocolConfigureReply.status.code).to.equal(202);

      // test that Alice is allowed to write to her own DWN
      const data = encoder.stringToBytes('any data');
      const aliceWriteMessageData = await TestDataGenerator.generateCollectionsWriteMessage({
        requester    : alice,
        target       : alice,
        recipientDid : alice.did,
        protocol,
        schema       : 'private-note',
        contextId    : 'anyContextId',
        data
      });

      let reply = await handleCollectionsWrite(aliceWriteMessageData.message, messageStore, didResolver);
      expect(reply.status.code).to.equal(202);

      // test that Bob is not allowed to write to Alice's DWN
      const bob = await DidKeyResolver.generate();
      const bobWriteMessageData = await TestDataGenerator.generateCollectionsWriteMessage({
        requester    : bob,
        target       : alice,
        recipientDid : alice.did,
        protocol,
        schema       : 'private-note',
        contextId    : 'anyContextId',
        data
      });

      reply = await handleCollectionsWrite(bobWriteMessageData.message, messageStore, didResolver);
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
        target             : alice,
        requester          : alice,
        protocol,
        protocolDefinition : invalidProtocolDefinition
      });

      const protocolConfigureReply = await handleProtocolsConfigure(protocolConfigureMessageData.message, messageStore, didResolver);
      expect(protocolConfigureReply.status.code).to.equal(202);

      // simulate Alice's VC applications with both issuer
      const data = encoder.stringToBytes('irrelevant');
      const messageDataWithIssuerA = await TestDataGenerator.generateCollectionsWriteMessage({
        requester    : alice,
        target       : alice,
        recipientDid : issuer.did,
        schema       : credentialIssuanceProtocolDefinition.labels.credentialApplication.schema,
        contextId    : 'issuer',
        protocol,
        data
      });

      let reply = await handleCollectionsWrite(messageDataWithIssuerA.message, messageStore, didResolver);
      expect(reply.status.code).to.equal(202);

      // simulate issuer attempting to respond to Alice's VC application
      const invalidResponseDataByIssuerA = await TestDataGenerator.generateCollectionsWriteMessage({
        requester    : issuer,
        target       : alice,
        recipientDid : alice.did,
        schema       : credentialIssuanceProtocolDefinition.labels.credentialResponse.schema,
        contextId    : 'issuer',
        parentId     : messageDataWithIssuerA.message.descriptor.recordId,
        protocol ,
        data
      });

      reply = await handleCollectionsWrite(invalidResponseDataByIssuerA.message, messageStore, didResolver);
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
        target             : alice,
        requester          : alice,
        protocol,
        protocolDefinition : invalidProtocolDefinition
      });

      const protocolConfigureReply = await handleProtocolsConfigure(protocolConfigureMessageData.message, messageStore, didResolver);
      expect(protocolConfigureReply.status.code).to.equal(202);

      // simulate Alice's VC applications with both issuer
      const data = encoder.stringToBytes('irrelevant');
      const messageDataWithIssuerA = await TestDataGenerator.generateCollectionsWriteMessage({
        requester    : alice,
        target       : alice,
        recipientDid : issuer.did,
        schema       : credentialIssuanceProtocolDefinition.labels.credentialApplication.schema,
        contextId    : 'issuer',
        protocol,
        data
      });

      let reply = await handleCollectionsWrite(messageDataWithIssuerA.message, messageStore, didResolver);
      expect(reply.status.code).to.equal(202);

      // simulate issuer attempting to respond to Alice's VC application
      const invalidResponseDataByIssuerA = await TestDataGenerator.generateCollectionsWriteMessage({
        requester    : issuer,
        target       : alice,
        recipientDid : alice.did,
        schema       : credentialIssuanceProtocolDefinition.labels.credentialResponse.schema,
        contextId    : 'issuer',
        parentId     : messageDataWithIssuerA.message.descriptor.recordId,
        protocol ,
        data
      });

      reply = await handleCollectionsWrite(invalidResponseDataByIssuerA.message, messageStore, didResolver);
      expect(reply.status.code).to.equal(401);
      expect(reply.status.detail).to.contain('mismatching record schema');
    });

    it('should look up recipient path with more than 1 ancestor in allow rule correctly', async () => {
      // simulate a DEX protocol with at least 3 layers of message exchange: ask -> offer -> fulfillment
      // make sure recipient of offer can send fulfillment

      const alice = await DidKeyResolver.generate();
      const pfi = await DidKeyResolver.generate();

      // write a DEX protocol definition
      const protocol = 'dex-protocol';
      const protocolDefinition: ProtocolDefinition = {
        labels: {
          ask: {
            schema: 'ask'
          },
          offer: {
            schema: 'offer'
          },
          fulfillment: {
            schema: 'fulfillment'
          }
        },
        records: {
          ask: {
            allow: {
              anyone: {
                to: [ 'write' ]
              }
            },
            records: {
              offer: {
                allow: {
                  recipient: {
                    of : 'ask',
                    to : [ 'write' ]
                  }
                },
                records: {
                  fulfillment: {
                    allow: {
                      recipient: {
                        of : 'ask/offer', // 2+ layers in path required by this test
                        to : [ 'write' ]
                      }
                    }
                  }
                }
              }
            }
          }
        }
      };

      // write the DEX protocol in the PFI
      const protocolConfigureMessageData = await TestDataGenerator.generateProtocolsConfigureMessage({
        target             : pfi,
        requester          : pfi,
        protocol,
        protocolDefinition : protocolDefinition
      });

      const protocolConfigureReply = await handleProtocolsConfigure(protocolConfigureMessageData.message, messageStore, didResolver);
      expect(protocolConfigureReply.status.code).to.equal(202);

      // simulate Alice's ask and PFI's offer already occurred
      const contextId = 'aliceInteraction';
      const data = encoder.stringToBytes('irrelevant');
      const askMessageData = await TestDataGenerator.generateCollectionsWriteMessage({
        requester    : alice,
        target       : pfi,
        recipientDid : pfi.did,
        schema       : 'ask',
        contextId,
        protocol,
        data
      });

      let reply = await handleCollectionsWrite(askMessageData.message, messageStore, didResolver);
      expect(reply.status.code).to.equal(202);

      const offerMessageData = await TestDataGenerator.generateCollectionsWriteMessage({
        requester    : pfi,
        target       : pfi,
        recipientDid : alice.did,
        schema       : 'offer',
        contextId,
        parentId     : askMessageData.message.descriptor.recordId,
        protocol,
        data
      });

      reply = await handleCollectionsWrite(offerMessageData.message, messageStore, didResolver);
      expect(reply.status.code).to.equal(202);

      // the actual test: making sure fulfillment message is accepted
      const fulfillmentMessageData = await TestDataGenerator.generateCollectionsWriteMessage({
        requester    : alice,
        target       : pfi,
        recipientDid : pfi.did,
        schema       : 'fulfillment',
        contextId,
        parentId     : offerMessageData.message.descriptor.recordId,
        protocol,
        data
      });
      reply = await handleCollectionsWrite(fulfillmentMessageData.message, messageStore, didResolver);
      expect(reply.status.code).to.equal(202);

      // verify the fulfillment message is stored
      const collectionsQueryMessageData = await TestDataGenerator.generateCollectionsQueryMessage({
        requester : pfi,
        target    : pfi,
        filter    : { recordId: fulfillmentMessageData.message.descriptor.recordId }
      });

      // verify the data is written
      const collectionsQueryReply = await handleCollectionsQuery(collectionsQueryMessageData.message, messageStore, didResolver);
      expect(collectionsQueryReply.status.code).to.equal(200);
      expect(collectionsQueryReply.entries?.length).to.equal(1);
      expect((collectionsQueryReply.entries![0] as CollectionsWriteMessage).descriptor.dataCid)
        .to.equal(fulfillmentMessageData.message.descriptor.dataCid);
    });

    it('should fail authorization incoming message contains `parentId` that leads to more than one record', async () => {
      const alice = await DidKeyResolver.generate();
      const issuer = await DidKeyResolver.generate();

      // write VC issuance protocol to Alice's DWN
      const protocol = 'https://identity.foundation/decentralized-web-node/protocols/credential-issuance';
      const protocolConfigureMessageData = await TestDataGenerator.generateProtocolsConfigureMessage({
        target             : alice,
        requester          : alice,
        protocol,
        protocolDefinition : credentialIssuanceProtocolDefinition
      });

      const protocolConfigureReply = await handleProtocolsConfigure(protocolConfigureMessageData.message, messageStore, didResolver);
      expect(protocolConfigureReply.status.code).to.equal(202);

      // generate two applications with the same `recordId`
      const recordId = uuidv4();
      const contextId = 'aliceInteraction';
      const application1Data = await TestDataGenerator.generateCollectionsWriteMessage({
        requester    : alice,
        target       : alice,
        recipientDid : issuer.did,
        schema       : credentialIssuanceProtocolDefinition.labels.credentialApplication.schema,
        contextId,
        protocol,
        recordId,
        data         : encoder.stringToBytes('data1')
      });

      const application2Data = await TestDataGenerator.generateCollectionsWriteMessage({
        requester    : alice,
        target       : alice,
        recipientDid : issuer.did,
        schema       : credentialIssuanceProtocolDefinition.labels.credentialApplication.schema,
        contextId,
        protocol,
        recordId,
        data         : encoder.stringToBytes('data2')
      });

      // we have to insert the two records directly into Alice's DWN because handler does not allow such condition to occur under expected operation
      await messageStore.put(application2Data.message, alice.did);
      await messageStore.put(application1Data.message, alice.did);

      // sanity verify there are two applications with the same recordId, this should not happen under normal operation
      // verify the fulfillment message is stored
      const applicationQueryMessageData = await TestDataGenerator.generateCollectionsQueryMessage({
        requester : alice,
        target    : alice,
        filter    : { recordId }
      });
      let reply = await handleCollectionsQuery(applicationQueryMessageData.message, messageStore, didResolver);
      expect(reply.status.code).to.equal(200);
      expect(reply.entries.length).to.equal(2);

      // now test that an issuer's offer message will fail due to ambiguous parent
      const responseMessageData = await TestDataGenerator.generateCollectionsWriteMessage({
        requester    : issuer,
        target       : alice,
        recipientDid : alice.did,
        schema       : credentialIssuanceProtocolDefinition.labels.credentialResponse.schema,
        contextId,
        parentId     : recordId,
        protocol,
        data         : encoder.stringToBytes('irrelevant')
      });

      reply = await handleCollectionsWrite(responseMessageData.message, messageStore, didResolver);
      expect(reply.status.code).to.equal(401);
      expect(reply.status.detail).to.contain('must have exactly one parent');
    });
  });

  it('should return 400 if actual CID of `data` mismatches with `dataCid` in descriptor', async () => {
    const messageData = await TestDataGenerator.generateCollectionsWriteMessage();
    messageData.message.encodedData = base64url.baseEncode(TestDataGenerator.randomBytes(50));

    const didResolverStub = sinon.createStubInstance(DidResolver);
    const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);

    const reply = await handleCollectionsWrite(messageData.message, messageStoreStub, didResolverStub);

    expect(reply.status.code).to.equal(400);
    expect(reply.status.detail).to.equal('actual CID of data and `dataCid` in descriptor mismatch');
  });

  it('should return 401 if signature check fails', async () => {
    const { requester, message } = await TestDataGenerator.generateCollectionsWriteMessage();

    // setting up a stub did resolver & message store
    // intentionally not supplying the public key so a different public key is generated to simulate invalid signature
    const mismatchingPersona = await TestDataGenerator.generatePersona({ did: requester.did, keyId: requester.keyId });
    const didResolverStub = TestStubGenerator.createDidResolverStub(mismatchingPersona);

    const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);

    const reply = await handleCollectionsWrite(message, messageStoreStub, didResolverStub);

    expect(reply.status.code).to.equal(401);
  });

  it('should return 401 if an authorized requester is attempting write', async () => {
    const requester = await TestDataGenerator.generatePersona();
    const target = await TestDataGenerator.generatePersona();
    const { message } = await TestDataGenerator.generateCollectionsWriteMessage({ requester, target });

    // setting up a stub did resolver & message store
    const didResolverStub = TestStubGenerator.createDidResolverStub(requester);
    const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);

    const reply = await handleCollectionsWrite(message, messageStoreStub, didResolverStub);

    expect(reply.status.code).to.equal(401);
  });

  it('should return 500 if encounter an internal error', async () => {
    const { requester, message } = await TestDataGenerator.generateCollectionsWriteMessage();

    // setting up a stub method resolver & message store
    const didResolverStub = TestStubGenerator.createDidResolverStub(requester);
    const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);
    messageStoreStub.put.throwsException('anyError'); // simulate a DB write error

    const reply = await handleCollectionsWrite(message, messageStoreStub, didResolverStub);

    expect(reply.status.code).to.equal(500);
  });
});

