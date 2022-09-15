import { base64url } from 'multiformats/bases/base64';
import { CollectionsWriteSchema } from '../../../../src/interfaces/collections/types';
import { DIDResolutionResult, DIDResolver } from '../../../../src/did/did-resolver';
import { GenerateCollectionWriteMessageOutput, TestDataGenerator } from '../../../utils/test-data-generator';
import { handleCollectionsQuery } from '../../../../src/interfaces/collections/handlers/collections-query';
import { handleCollectionsWrite } from '../../../../src/interfaces/collections/handlers/collections-write';
import { MessageStoreLevel } from '../../../../src/store/message-store-level';
import { secp256k1 } from '../../../../src/jose/algorithms/signing/secp256k1';
import { TestStubGenerator } from '../../../utils/test-stub-generator';
import { v4 as uuidv4 } from 'uuid';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';

chai.use(chaiAsPromised);

describe('handleCollectionsWrite()', () => {
  let messageStore: MessageStoreLevel;

  describe('functional tests', () => {
    before(async () => {
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
      const targetDid = 'did:example:alice';
      const requesterDid = targetDid;
      const recordId = uuidv4();
      const data1 = new TextEncoder().encode('data1');
      const collectionsWriteMessageData = await TestDataGenerator.generateCollectionWriteMessage({ targetDid, requesterDid, recordId, data: data1 });
      const { requesterKeyId, requesterKeyPair } = collectionsWriteMessageData;

      // setting up a stub did resolver
      const didResolverStub = TestStubGenerator.createDidResolverStub(requesterDid, requesterKeyId, requesterKeyPair.publicJwk);

      const collectionsWriteReply = await handleCollectionsWrite(collectionsWriteMessageData.message, messageStore, didResolverStub);
      expect(collectionsWriteReply.status.code).to.equal(202);

      const collectionsQueryMessageData = await TestDataGenerator.generateCollectionQueryMessage({
        targetDid,
        requesterDid,
        requesterKeyId,
        requesterKeyPair,
        filter: { recordId }
      });

      // verify the message written can be queried
      const collectionsQueryReply = await handleCollectionsQuery(collectionsQueryMessageData.message, messageStore, didResolverStub);
      expect(collectionsQueryReply.status.code).to.equal(200);
      expect(collectionsQueryReply.entries?.length).to.equal(1);
      expect((collectionsQueryReply.entries![0] as CollectionsWriteSchema).encodedData).to.equal(base64url.baseEncode(data1));

      // generate and write a new CollectionsWrite to overwrite the existing record
      // a new CollectionsWrite by default will have a later `dateCreate` due to the default Date.now() call
      const data2 = new TextEncoder().encode('data2');
      const newCollectionsWriteMessageData = await TestDataGenerator.generateCollectionWriteMessage({
        targetDid,
        requesterDid,
        requesterKeyId,
        requesterKeyPair,
        recordId,
        data: data2 // new data value
      });
      const newCollectionsWriteReply = await handleCollectionsWrite(newCollectionsWriteMessageData.message, messageStore, didResolverStub);
      expect(newCollectionsWriteReply.status.code).to.equal(202);

      // verify new record has overwritten the existing record
      const newCollectionsQueryReply = await handleCollectionsQuery(collectionsQueryMessageData.message, messageStore, didResolverStub);

      expect(newCollectionsQueryReply.status.code).to.equal(200);
      expect(newCollectionsQueryReply.entries?.length).to.equal(1);
      expect((newCollectionsQueryReply.entries![0] as CollectionsWriteSchema).encodedData).to.equal(base64url.baseEncode(data2));

      // try to write the older message to store again and verify that it is not accepted
      const thirdCollectionsWriteReply = await handleCollectionsWrite(collectionsWriteMessageData.message, messageStore, didResolverStub);
      expect(thirdCollectionsWriteReply.status.code).to.equal(409); // expecting to fail

      // expecting unchanged
      const thirdCollectionsQueryReply = await handleCollectionsQuery(collectionsQueryMessageData.message, messageStore, didResolverStub);
      expect(thirdCollectionsQueryReply.status.code).to.equal(200);
      expect(thirdCollectionsQueryReply.entries?.length).to.equal(1);
      expect((thirdCollectionsQueryReply.entries![0] as CollectionsWriteSchema).encodedData).to.equal(base64url.baseEncode(data2));
    });

    it('should only be able to overwrite existing record if new message CID is larger when `dateCreated` value is the same', async () => {
      // generate two messages with the same `dateCreated` value
      const targetDid = 'did:example:alice';
      const requesterDid = targetDid;
      const recordId = uuidv4();
      const dateCreated = Date.now();
      const collectionsWriteMessageData1 = await TestDataGenerator.generateCollectionWriteMessage({
        targetDid,
        requesterDid,
        recordId,
        dateCreated,
        data: new TextEncoder().encode('data1')
      });
      const { requesterKeyId, requesterKeyPair } = collectionsWriteMessageData1;

      const collectionsWriteMessageData2 = await TestDataGenerator.generateCollectionWriteMessage({
        targetDid,
        requesterDid,
        requesterKeyId,
        requesterKeyPair,
        recordId,
        dateCreated, // simulate the exact same dateCreated as message 1 above
        data: new TextEncoder().encode('data2') // a different CID value
      });

      // determine the lexicographical order of the two messages
      let largerCollectionWriteMessageData: GenerateCollectionWriteMessageOutput;
      let smallerCollectionWriteMessageData: GenerateCollectionWriteMessageOutput;
      if (collectionsWriteMessageData1.messageCid > collectionsWriteMessageData2.messageCid) {
        largerCollectionWriteMessageData = collectionsWriteMessageData1;
        smallerCollectionWriteMessageData = collectionsWriteMessageData2;
      } else {
        largerCollectionWriteMessageData = collectionsWriteMessageData2;
        smallerCollectionWriteMessageData = collectionsWriteMessageData1;
      }

      // setting up a stub did resolver
      const didResolverStub = TestStubGenerator.createDidResolverStub(requesterDid, requesterKeyId, requesterKeyPair.publicJwk);

      // write the message with the smaller lexicographical message CID first
      const collectionsWriteReply = await handleCollectionsWrite(smallerCollectionWriteMessageData.message, messageStore, didResolverStub);
      expect(collectionsWriteReply.status.code).to.equal(202);

      // query to fetch the record
      const collectionsQueryMessageData = await TestDataGenerator.generateCollectionQueryMessage({
        targetDid,
        requesterDid,
        requesterKeyId,
        requesterKeyPair,
        filter: { recordId }
      });

      // verify the data is written
      const collectionsQueryReply = await handleCollectionsQuery(collectionsQueryMessageData.message, messageStore, didResolverStub);
      expect(collectionsQueryReply.status.code).to.equal(200);
      expect(collectionsQueryReply.entries?.length).to.equal(1);
      expect((collectionsQueryReply.entries![0] as CollectionsWriteSchema).descriptor.dataCid)
        .to.equal(smallerCollectionWriteMessageData.message.descriptor.dataCid);

      // attempt to write the message with larger lexicographical message CID
      const newCollectionsWriteReply = await handleCollectionsWrite(largerCollectionWriteMessageData.message, messageStore, didResolverStub);
      expect(newCollectionsWriteReply.status.code).to.equal(202);

      // verify new record has overwritten the existing record
      const newCollectionsQueryReply = await handleCollectionsQuery(collectionsQueryMessageData.message, messageStore, didResolverStub);
      expect(newCollectionsQueryReply.status.code).to.equal(200);
      expect(newCollectionsQueryReply.entries?.length).to.equal(1);
      expect((newCollectionsQueryReply.entries![0] as CollectionsWriteSchema).descriptor.dataCid)
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
      expect((thirdCollectionsQueryReply.entries![0] as CollectionsWriteSchema).descriptor.dataCid)
        .to.equal(largerCollectionWriteMessageData.message.descriptor.dataCid); // expecting unchanged
    });

    describe('protocol-based authorization', () => {
      it('should allow write with allow-anyone rule', async () => {
        // scenario, Bob writes into Alice's DWN given Alice's "email" protocol allow-anyone rule

        // write a protocol definition with an allow-anyone rule
        const protocolDefinition = {
          recordTypes: {
            email: {
              schema: 'email'
            }
          },
          structures: {
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
        const aliceDid = 'did:example:alice';
        const emailProtocolId = uuidv4();
        const encodedProtocolDefinition = new TextEncoder().encode(JSON.stringify(protocolDefinition));
        const protocolWriteMessageData = await TestDataGenerator.generateCollectionWriteMessage({
          targetDid    : aliceDid,
          requesterDid : aliceDid,
          recordId     : emailProtocolId,
          schema       : 'dwn-protocol',
          data         : encodedProtocolDefinition
        });
        const aliceKeyId = protocolWriteMessageData.requesterKeyId;
        const aliceKeyPair = protocolWriteMessageData.requesterKeyPair;

        // setting up a stub did resolver
        const aliceDidResolverStub = TestStubGenerator.createDidResolverStub(aliceDid, aliceKeyId, aliceKeyPair.publicJwk);

        const protocolWriteReply = await handleCollectionsWrite(protocolWriteMessageData.message, messageStore, aliceDidResolverStub);
        expect(protocolWriteReply.status.code).to.equal(202);

        // verify the protocol got written to the DB
        const collectionsQueryMessageData = await TestDataGenerator.generateCollectionQueryMessage({
          targetDid        : aliceDid,
          requesterDid     : aliceDid,
          requesterKeyId   : aliceKeyId,
          requesterKeyPair : aliceKeyPair,
          filter           : { recordId: emailProtocolId }
        });
        const collectionsQueryReply = await handleCollectionsQuery(collectionsQueryMessageData.message, messageStore, aliceDidResolverStub);
        expect(collectionsQueryReply.status.code).to.equal(200);
        expect(collectionsQueryReply.entries?.length).to.equal(1);
        expect((collectionsQueryReply.entries![0] as CollectionsWriteSchema).encodedData).to.equal(base64url.baseEncode(encodedProtocolDefinition));

        // generate a collections write message from bob allowed by anyone
        const bobDid = 'did:example:bob';
        const bobData = new TextEncoder().encode('data from bob');
        const emailMessageDataFromBob = await TestDataGenerator.generateCollectionWriteMessage(
          {
            targetDid    : aliceDid,
            requesterDid : bobDid,
            protocol     : emailProtocolId,
            schema       : 'email',
            data         : bobData
          }
        );
        const bobKeyId = emailMessageDataFromBob.requesterKeyId;
        const bobKeyPair = emailMessageDataFromBob.requesterKeyPair;

        const bobDidResolverStub = TestStubGenerator.createDidResolverStub(bobDid, bobKeyId, bobKeyPair.publicJwk);

        const bobWriteReply = await handleCollectionsWrite(emailMessageDataFromBob.message, messageStore, bobDidResolverStub);
        expect(bobWriteReply.status.code).to.equal(202);

        // verify bob's message got written to the DB
        const messageDataForQueryingBobsWrite = await TestDataGenerator.generateCollectionQueryMessage({
          targetDid        : aliceDid,
          requesterDid     : aliceDid,
          requesterKeyId   : aliceKeyId,
          requesterKeyPair : aliceKeyPair,
          filter           : { recordId: emailMessageDataFromBob.message.descriptor.recordId }
        });
        const bobRecordQueryReply = await handleCollectionsQuery(messageDataForQueryingBobsWrite.message, messageStore, aliceDidResolverStub);
        expect(bobRecordQueryReply.status.code).to.equal(200);
        expect(bobRecordQueryReply.entries?.length).to.equal(1);
        expect((bobRecordQueryReply.entries![0] as CollectionsWriteSchema).encodedData).to.equal(base64url.baseEncode(bobData));
      });
    });

    it('should allow write with recipient rule', async () => {
      // scenario: FPI writes into Alice's DWN an asynchronous credential response upon receiving Alice's credential application

      // write a protocol definition with an allow-anyone rule
      const protocolDefinition = {
        recordTypes: {
          credentialApplication: {
            schema: 'https://identity.foundation/schemas/credential-application'
          },
          credentialResponse: {
            schema: 'https://identity.foundation/schemas/credential-response'
          }
        },
        structures: {
          credentialApplication: {
            records: {
              credentialResponse: {
                allow: {
                  recipient: {
                    of : 'credentialApplication',
                    to : [
                      'write'
                    ]
                  }
                }
              }
            }
          }
        }
      };
      const aliceDid = 'did:example:alice';
      const protocolId = uuidv4();
      const encodedProtocolDefinition = new TextEncoder().encode(JSON.stringify(protocolDefinition));
      const protocolWriteMessageData = await TestDataGenerator.generateCollectionWriteMessage({
        targetDid    : aliceDid,
        requesterDid : aliceDid,
        recordId     : protocolId,
        schema       : 'dwn-protocol',
        data         : encodedProtocolDefinition
      });
      const aliceKeyId = protocolWriteMessageData.requesterKeyId;
      const aliceKeyPair = protocolWriteMessageData.requesterKeyPair;

      // setting up a stub did resolver
      const aliceDidResolverStub = TestStubGenerator.createDidResolverStub(aliceDid, aliceKeyId, aliceKeyPair.publicJwk);

      const protocolWriteReply = await handleCollectionsWrite(protocolWriteMessageData.message, messageStore, aliceDidResolverStub);
      expect(protocolWriteReply.status.code).to.equal(202);

      // write a credential application to Alice's DWN to simulate that she has sent a credential application to the PFI
      const pfiDid = 'did:example:pfi';
      const credentialApplicationContextId = 'alice credential application thread';
      const credentialApplicationRecordId = uuidv4();
      const encodedCredentialApplication = new TextEncoder().encode('credential application data');
      const credentialApplicationMessageData = await TestDataGenerator.generateCollectionWriteMessage({
        requesterDid     : aliceDid,
        requesterKeyId   : aliceKeyId,
        requesterKeyPair : aliceKeyPair,
        targetDid        : aliceDid,
        recipientDid     : pfiDid,
        protocol         : protocolId,
        contextId        : credentialApplicationContextId,
        recordId         : credentialApplicationRecordId,
        schema           : 'https://identity.foundation/schemas/credential-application',
        data             : encodedCredentialApplication
      });

      const credentialApplicationReply = await handleCollectionsWrite(credentialApplicationMessageData.message, messageStore, aliceDidResolverStub);
      expect(credentialApplicationReply.status.code).to.equal(202);

      // generate a credential application response message from PFI
      const encodedCredentialResponse = new TextEncoder().encode('credential response data');
      const credentialResponseMessageData = await TestDataGenerator.generateCollectionWriteMessage(
        {
          targetDid    : aliceDid,
          recipientDid : aliceDid,
          requesterDid : pfiDid,
          protocol     : protocolId,
          contextId    : credentialApplicationContextId,
          parentId     : credentialApplicationRecordId,
          schema       : 'https://identity.foundation/schemas/credential-response',
          data         : encodedCredentialResponse
        }
      );
      const pfiKeyId = credentialResponseMessageData.requesterKeyId;
      const pfiKeyPair = credentialResponseMessageData.requesterKeyPair;

      const pfiDidResolverStub = TestStubGenerator.createDidResolverStub(pfiDid, pfiKeyId, pfiKeyPair.publicJwk);

      const pfiCredentialResponseReply = await handleCollectionsWrite(credentialResponseMessageData.message, messageStore, pfiDidResolverStub);
      expect(pfiCredentialResponseReply.status.code).to.equal(202);

      // verify PFI's message got written to the DB
      const messageDataForQueryingCredentialResponse = await TestDataGenerator.generateCollectionQueryMessage({
        targetDid        : aliceDid,
        requesterDid     : aliceDid,
        requesterKeyId   : aliceKeyId,
        requesterKeyPair : aliceKeyPair,
        filter           : { recordId: credentialResponseMessageData.message.descriptor.recordId }
      });
      const applicationResponseQueryReply = await handleCollectionsQuery(
        messageDataForQueryingCredentialResponse.message,
        messageStore,
        aliceDidResolverStub
      );
      expect(applicationResponseQueryReply.status.code).to.equal(200);
      expect(applicationResponseQueryReply.entries?.length).to.equal(1);
      expect((applicationResponseQueryReply.entries![0] as CollectionsWriteSchema).encodedData)
        .to.equal(base64url.baseEncode(encodedCredentialResponse));
    });

    it('should block unauthorized write with recipient rule', async () => {
      // scenario: fake FPI attempts write into Alice's DWN a credential response upon learning the ID of Alice's credential application to actual PFI

      // write a protocol definition with an allow-anyone rule
      const protocolDefinition = {
        recordTypes: {
          credentialApplication: {
            schema: 'https://identity.foundation/schemas/credential-application'
          },
          credentialResponse: {
            schema: 'https://identity.foundation/schemas/credential-response'
          }
        },
        structures: {
          credentialApplication: {
            records: {
              credentialResponse: {
                allow: {
                  recipient: {
                    of : 'credentialApplication',
                    to : [
                      'write'
                    ]
                  }
                }
              }
            }
          }
        }
      };
      const aliceDid = 'did:example:alice';
      const protocolId = uuidv4();
      const encodedProtocolDefinition = new TextEncoder().encode(JSON.stringify(protocolDefinition));
      const protocolWriteMessageData = await TestDataGenerator.generateCollectionWriteMessage({
        targetDid    : aliceDid,
        requesterDid : aliceDid,
        recordId     : protocolId,
        schema       : 'dwn-protocol',
        data         : encodedProtocolDefinition
      });
      const aliceKeyId = protocolWriteMessageData.requesterKeyId;
      const aliceKeyPair = protocolWriteMessageData.requesterKeyPair;

      // setting up a stub did resolver
      const aliceDidResolverStub = TestStubGenerator.createDidResolverStub(aliceDid, aliceKeyId, aliceKeyPair.publicJwk);

      const protocolWriteReply = await handleCollectionsWrite(protocolWriteMessageData.message, messageStore, aliceDidResolverStub);
      expect(protocolWriteReply.status.code).to.equal(202);

      // write a credential application to Alice's DWN to simulate that she has sent a credential application to the PFI
      const pfiDid = 'did:example:pfi';
      const credentialApplicationContextId = 'alice credential application thread';
      const credentialApplicationRecordId = uuidv4();
      const encodedCredentialApplication = new TextEncoder().encode('credential application data');
      const credentialApplicationMessageData = await TestDataGenerator.generateCollectionWriteMessage({
        requesterDid     : aliceDid,
        requesterKeyId   : aliceKeyId,
        requesterKeyPair : aliceKeyPair,
        targetDid        : aliceDid,
        recipientDid     : pfiDid,
        protocol         : protocolId,
        contextId        : credentialApplicationContextId,
        recordId         : credentialApplicationRecordId,
        schema           : 'https://identity.foundation/schemas/credential-application',
        data             : encodedCredentialApplication
      });

      const credentialApplicationReply = await handleCollectionsWrite(credentialApplicationMessageData.message, messageStore, aliceDidResolverStub);
      expect(credentialApplicationReply.status.code).to.equal(202);

      // generate a credential application response message from a fake PFI
      const fakePfiDid = 'did:example:fake-pfi';
      const encodedCredentialResponse = new TextEncoder().encode('credential response data');
      const credentialResponseMessageData = await TestDataGenerator.generateCollectionWriteMessage(
        {
          targetDid    : aliceDid,
          recipientDid : aliceDid,
          requesterDid : fakePfiDid,
          protocol     : protocolId,
          contextId    : credentialApplicationContextId,
          parentId     : credentialApplicationRecordId,
          schema       : 'https://identity.foundation/schemas/credential-response',
          data         : encodedCredentialResponse
        }
      );
      const fakePfiKeyId = credentialResponseMessageData.requesterKeyId;
      const fakePfiKeyPair = credentialResponseMessageData.requesterKeyPair;

      const pfiDidResolverStub = TestStubGenerator.createDidResolverStub(fakePfiDid, fakePfiKeyId, fakePfiKeyPair.publicJwk);

      const pfiCredentialResponseReply = await handleCollectionsWrite(credentialResponseMessageData.message, messageStore, pfiDidResolverStub);
      expect(pfiCredentialResponseReply.status.code).to.equal(401);
      expect(pfiCredentialResponseReply.status.message).to.contain('unexpected inbound message author');
    });
  });

  it('should return 400 if actual CID of `data` mismatches with `dataCid` in descriptor', async () => {
    const messageData = await TestDataGenerator.generateCollectionWriteMessage();
    messageData.message.encodedData = base64url.baseEncode(TestDataGenerator.randomBytes(50));

    const didResolverStub = sinon.createStubInstance(DIDResolver);
    const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);

    const reply = await handleCollectionsWrite(messageData.message, messageStoreStub, didResolverStub);

    expect(reply.status.code).to.equal(400);
    expect(reply.status.message).to.equal('actual CID of data and `dataCid` in descriptor mismatch');
  });

  it('should return 401 if signature check fails', async () => {
    const messageData = await TestDataGenerator.generateCollectionWriteMessage();
    const { requesterDid, requesterKeyId } = messageData;

    // setting up a stub did resolver & message store
    const differentKeyPair = await secp256k1.generateKeyPair(); // used to return a different public key to simulate invalid signature
    const didResolverStub = TestStubGenerator.createDidResolverStub(requesterDid, requesterKeyId, differentKeyPair.publicJwk);

    const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);

    const reply = await handleCollectionsWrite(messageData.message, messageStoreStub, didResolverStub);

    expect(reply.status.code).to.equal(401);
  });

  it('should return 401 if requester is not the same as the target', async () => {
    const requesterDid = 'did:example:alice';
    const targetDid = 'did:example:bob'; // requester and target are different
    const { message, requesterKeyId, requesterKeyPair } = await TestDataGenerator.generateCollectionQueryMessage({ requesterDid, targetDid });

    // setting up a stub did resolver & message store
    const didResolverStub = TestStubGenerator.createDidResolverStub(requesterDid, requesterKeyId, requesterKeyPair.publicJwk);
    const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);

    const reply = await handleCollectionsWrite(message, messageStoreStub, didResolverStub);

    expect(reply.status.code).to.equal(401);
  });

  it('should return 500 if encounter an internal error', async () => {
    const messageData = await TestDataGenerator.generateCollectionWriteMessage();
    const { requesterDid, requesterKeyId, requesterKeyPair } = messageData;

    // setting up a stub method resolver & message store
    const didResolutionResult = TestDataGenerator.createDidResolutionResult(requesterDid, requesterKeyId, requesterKeyPair.publicJwk);
    const resolveStub = sinon.stub<[string], Promise<DIDResolutionResult>>();
    resolveStub.withArgs(requesterDid).resolves(didResolutionResult);
    const didResolverStub = sinon.createStubInstance(DIDResolver, { resolve: resolveStub });
    const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);
    messageStoreStub.put.throwsException('anyError'); // simulate a DB write error

    const reply = await handleCollectionsWrite(messageData.message, messageStoreStub, didResolverStub);

    expect(reply.status.code).to.equal(500);
  });
});

