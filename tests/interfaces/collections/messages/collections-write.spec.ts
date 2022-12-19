import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import chai, { expect } from 'chai';

import { base64url } from 'multiformats/bases/base64';
import { CollectionsWrite } from '../../../../src/interfaces/collections/messages/collections-write.js';
import { CollectionsWriteMessage } from '../../../../src/interfaces/collections/types.js';
import { MessageStoreLevel } from '../../../../src/store/message-store-level.js';
import { TestDataGenerator } from '../../../utils/test-data-generator.js';
import { getCurrentTimeInHighPrecision, sleep } from '../../../../src/utils/time.js';


chai.use(chaiAsPromised);

describe('CollectionsWrite', () => {
  describe('create()', () => {
    it('should be able to create and authorize a valid CollectionsWrite message', async () => {
      // testing `create()` first
      const alice = await TestDataGenerator.generatePersona();

      const options = {
        target         : alice.did,
        recipient      : alice.did,
        data           : TestDataGenerator.randomBytes(10),
        dataFormat     : 'application/json',
        dateCreated    : '2022-10-14T10:20:30.405060',
        recordId       : await TestDataGenerator.randomCborSha256Cid(),
        signatureInput : TestDataGenerator.createSignatureInputFromPersona(alice)
      };
      const collectionsWrite = await CollectionsWrite.create(options);

      const message = collectionsWrite.message as CollectionsWriteMessage;

      expect(message.authorization).to.exist;
      expect(message.encodedData).to.equal(base64url.baseEncode(options.data));
      expect(message.descriptor.dataFormat).to.equal(options.dataFormat);
      expect(message.descriptor.dateCreated).to.equal(options.dateCreated);
      expect(message.recordId).to.equal(options.recordId);

      const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);

      await collectionsWrite.authorize(messageStoreStub);
    });

    it('should be able to auto-fill `datePublished` when `published` set to `true` but `datePublished` not given', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const options = {
        target         : alice.did,
        recipient      : alice.did,
        data           : TestDataGenerator.randomBytes(10),
        dataFormat     : 'application/json',
        recordId       : await TestDataGenerator.randomCborSha256Cid(),
        published      : true,
        signatureInput : TestDataGenerator.createSignatureInputFromPersona(alice)
      };
      const collectionsWrite = await CollectionsWrite.create(options);

      const message = collectionsWrite.message as CollectionsWriteMessage;

      expect(message.descriptor.datePublished).to.exist;
    });

    it('should throw if given a root message but also contains `lineageParent`', async () => {
      const alice = await TestDataGenerator.generatePersona();

      // not specifying `recordId` implies a root message
      const options = {
        target         : alice.did,
        recipient      : alice.did,
        lineageParent  : await TestDataGenerator.randomCborSha256Cid(),
        data           : TestDataGenerator.randomBytes(10),
        dataFormat     : 'application/json',
        published      : true,
        signatureInput : TestDataGenerator.createSignatureInputFromPersona(alice)
      };

      await expect(CollectionsWrite.create(options)).to.be.rejectedWith('originating message must not have a lineage parent');
    });
  });

  describe('compareCreationTime', () => {
    it('should return 0 if age is same', async () => {
      const dateCreated = getCurrentTimeInHighPrecision();
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
      if (newestMessage?.recordId !== c.recordId) {
        console.log(`a: ${a.descriptor.dateCreated}`);
        console.log(`b: ${b.descriptor.dateCreated}`);
        console.log(`c: ${c.descriptor.dateCreated}`);
      }
      expect(newestMessage?.recordId).to.equal(c.recordId);
    });
  });

  describe('getCid', () => {
    it('should return the same value with or without `encodedData`', async () => {
      const dateCreated = getCurrentTimeInHighPrecision();
      const messageData = await TestDataGenerator.generateCollectionsWriteMessage({ dateCreated });

      const messageWithoutEncodedData = { ...messageData.message };
      delete messageWithoutEncodedData.encodedData;

      const cidOfMessageWithEncodedData = await CollectionsWrite.getCid(messageData.message);
      const cidOfMessageWithoutData = await CollectionsWrite.getCid(messageWithoutEncodedData);

      expect(cidOfMessageWithEncodedData.toString()).to.equal(cidOfMessageWithoutData.toString());
    });
  });
});

