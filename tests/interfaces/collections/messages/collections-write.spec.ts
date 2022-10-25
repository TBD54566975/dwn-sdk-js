import { base64url } from 'multiformats/bases/base64';
import { CollectionsWrite } from '../../../../src/interfaces/collections/messages/collections-write';
import { CollectionsWriteMessage } from '../../../../src/interfaces/collections/types';
import { MessageStoreLevel } from '../../../../src/store/message-store-level';
import { sleep } from '../../../../src/utils/time';
import { TestDataGenerator } from '../../../utils/test-data-generator';
import { TestStubGenerator } from '../../../utils/test-stub-generator';
import { v4 as uuidv4 } from 'uuid';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';

chai.use(chaiAsPromised);

describe('CollectionsWrite', () => {
  describe('create() & verifyAuth()', () => {
    it('should be able to create and verify a valid CollectionsWrite message', async () => {
      // testing `create()` first
      const alice = await TestDataGenerator.generatePersona();
      const signatureInput = {
        jwkPrivate      : alice.keyPair.privateJwk,
        protectedHeader : {
          alg : alice.keyPair.privateJwk.alg as string,
          kid : alice.keyId
        }
      };

      const options = {
        target      : alice.did,
        recipient   : alice.did,
        data        : TestDataGenerator.randomBytes(10),
        dataFormat  : 'application/json',
        dateCreated : 123,
        recordId    : uuidv4(),
        signatureInput
      };
      const collectionsWrite = await CollectionsWrite.create(options);

      const message = collectionsWrite.toObject() as CollectionsWriteMessage;

      expect(message.authorization).to.exist;
      expect(message.encodedData).to.equal(base64url.baseEncode(options.data));
      expect(message.descriptor.dataFormat).to.equal(options.dataFormat);
      expect(message.descriptor.dateCreated).to.equal(options.dateCreated);
      expect(message.descriptor.recordId).to.equal(options.recordId);

      const resolverStub = TestStubGenerator.createDidResolverStub(alice);
      const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);

      const { author } = await collectionsWrite.verifyAuth(resolverStub, messageStoreStub);

      expect(author).to.equal(alice.did);
    });
  });

  describe('verifyAuth', () => {
    it('should throw if verification signature check fails', async () => {
      const { requester, message } = await TestDataGenerator.generateCollectionsWriteMessage();

      // setting up a stub method resolver
      // intentionally not supplying the public key so a different public key is generated to simulate invalid signature
      const mismatchingPersona = await TestDataGenerator.generatePersona({ did: requester.did, keyId: requester.keyId });
      const didResolverStub = TestStubGenerator.createDidResolverStub(mismatchingPersona);

      const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);

      const collectionsWrite = new CollectionsWrite(message);
      expect(collectionsWrite.verifyAuth(didResolverStub, messageStoreStub))
        .to.be.rejectedWith('signature verification failed for did:example:alice');
    });
  });

  describe('compareCreationTime', () => {
    it('should return 0 if age is same', async () => {
      const dateCreated = Date.now();
      const a = (await TestDataGenerator.generateCollectionsWriteMessage({ dateCreated })).message;
      const b = JSON.parse(JSON.stringify(a)); // create a deep copy of `a`

      const compareResult = await CollectionsWrite.compareCreationTime(a, b);
      expect(compareResult).to.equal(0);
    });
  });

  describe('getNewestMessage', () => {
    it('should return the newest message', async () => {
      const a = (await TestDataGenerator.generateCollectionsWriteMessage()).message;
      await sleep(1); // need to sleep for at least one millisecond else some messages get generated with the same time
      const b = (await TestDataGenerator.generateCollectionsWriteMessage()).message;
      await sleep(1);
      const c = (await TestDataGenerator.generateCollectionsWriteMessage()).message; // c is the newest since its created last

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
      const messageData = await TestDataGenerator.generateCollectionsWriteMessage({ dateCreated });

      const messageWithoutEncodedData = { ...messageData.message };
      delete messageWithoutEncodedData.encodedData;

      const cidOfMessageWithEncodedData = await CollectionsWrite.getCid(messageData.message);
      const cidOfMessageWithoutData = await CollectionsWrite.getCid(messageWithoutEncodedData);

      expect(cidOfMessageWithEncodedData.toString()).to.equal(cidOfMessageWithoutData.toString());
    });
  });
});

