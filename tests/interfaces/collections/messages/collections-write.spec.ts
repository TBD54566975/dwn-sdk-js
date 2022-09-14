import { base64url } from 'multiformats/bases/base64';
import { CollectionsWrite } from '../../../../src/interfaces/collections/messages/collections-write';
import { CollectionsWriteSchema } from '../../../../src/interfaces/collections/types';
import { DIDResolutionResult, DIDResolver } from '../../../../src/did/did-resolver';
import { secp256k1 } from '../../../../src/jose/algorithms/signing/secp256k1';
import { sleep } from '../../../../src/utils/time';
import { TestDataGenerator } from '../../../utils/test-data-generator';
import { TestStubGenerator } from '../../../utils/test-stub-generator';
import { v4 as uuidv4 } from 'uuid';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import { MessageStoreLevel } from '../../../../src/store/message-store-level';

chai.use(chaiAsPromised);

describe('CollectionsWrite', () => {
  describe('create() & verifyAuth()', () => {
    it('should be able to create and verify a valid CollectionsWrite message', async () => {
      // testing `create()` first
      const requesterDid = 'did:example:alice';
      const keyId = `${requesterDid}#key1`;
      const { privateJwk, publicJwk } = await secp256k1.generateKeyPair();
      const signatureInput = {
        jwkPrivate      : privateJwk,
        protectedHeader : {
          alg : privateJwk.alg as string,
          kid : keyId
        }
      };

      const options = {
        target      : 'did:example:alice',
        data        : TestDataGenerator.randomBytes(10),
        dataFormat  : 'application/json',
        dateCreated : 123,
        nonce       : 'anyNonce',
        recordId    : uuidv4(),
        signatureInput
      };
      const collectionsWrite = await CollectionsWrite.create(options);

      const message = collectionsWrite.toObject() as CollectionsWriteSchema;

      expect(message.authorization).to.exist;
      expect(message.encodedData).to.equal(base64url.baseEncode(options.data));
      expect(message.descriptor.dataFormat).to.equal(options.dataFormat);
      expect(message.descriptor.dateCreated).to.equal(options.dateCreated);
      expect(message.descriptor.nonce).to.equal(options.nonce);
      expect(message.descriptor.recordId).to.equal(options.recordId);

      const resolverStub = TestStubGenerator.createDidResolverStub(requesterDid, keyId, publicJwk);
      const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);

      const { signers } = await collectionsWrite.verifyAuth(resolverStub, messageStoreStub);

      expect(signers.length).to.equal(1);
      expect(signers).to.include(requesterDid);
    });
  });

  describe('verifyAuth', () => {
    it('should throw if verification signature check fails', async () => {
      const messageData = await TestDataGenerator.generateCollectionWriteMessage();
      const { requesterDid, requesterKeyId } = messageData;

      // setting up a stub method resolver
      const differentKeyPair = await secp256k1.generateKeyPair(); // used to return a different public key to simulate invalid signature
      const didResolutionResult = TestDataGenerator.createDidResolutionResult(requesterDid, requesterKeyId, differentKeyPair.publicJwk);
      const resolveStub = sinon.stub<[string], Promise<DIDResolutionResult>>();
      resolveStub.withArgs( requesterDid).resolves(didResolutionResult);
      const didResolverStub = sinon.createStubInstance(DIDResolver, { resolve: resolveStub });
      const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);

      const collectionsWrite = new CollectionsWrite(messageData.message);
      expect(collectionsWrite.verifyAuth(didResolverStub, messageStoreStub))
        .to.be.rejectedWith('signature verification failed for did:example:alice');
    });
  });

  describe('compareCreationTime', () => {
    it('should return 0 if age is same', async () => {
      const dateCreated = Date.now();
      const a = (await TestDataGenerator.generateCollectionWriteMessage({ dateCreated })).message;
      const b = JSON.parse(JSON.stringify(a)); // create a deep copy of `a`

      const compareResult = await CollectionsWrite.compareCreationTime(a, b);
      expect(compareResult).to.equal(0);
    });
  });

  describe('getNewestMessage', () => {
    it('should return the newest message', async () => {
      const a = (await TestDataGenerator.generateCollectionWriteMessage()).message;
      await sleep(1); // need to sleep for at least one millisecond else some messages get generated with the same time
      const b = (await TestDataGenerator.generateCollectionWriteMessage()).message;
      await sleep(1);
      const c = (await TestDataGenerator.generateCollectionWriteMessage()).message; // c is the newest since its created last

      const newestMessage = await CollectionsWrite.getNewestMessage([b, c, a]);
      if (newestMessage?.descriptor.recordId !== c.descriptor.recordId) {
        console.log(`a: ${a.descriptor.dateCreated}`);
        console.log(`b: ${b.descriptor.dateCreated}`);
        console.log(`c: ${c.descriptor.dateCreated}`);
      }
      expect(newestMessage?.descriptor.recordId).to.equal(c.descriptor.recordId);
    });
  });

  describe('getCid', () => {
    it('should return the same value with or without `encodedData`', async () => {
      const dateCreated = Date.now();
      const messageData = await TestDataGenerator.generateCollectionWriteMessage({ dateCreated });

      const messageWithoutEncodedData = { ...messageData.message };
      delete messageWithoutEncodedData.encodedData;

      const cidOfMessageWithEncodedData = await CollectionsWrite.getCid(messageData.message);
      const cidOfMessageWithoutData = await CollectionsWrite.getCid(messageWithoutEncodedData);

      expect(cidOfMessageWithEncodedData.toString()).to.equal(cidOfMessageWithoutData.toString());
    });
  });
});

