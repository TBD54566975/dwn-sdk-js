import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import chai, { expect } from 'chai';

import { base64url } from 'multiformats/bases/base64';
import { MessageStoreLevel } from '../../../../src/store/message-store-level.js';
import { RecordsWrite } from '../../../../src/interfaces/records/messages/records-write.js';
import { RecordsWriteMessage } from '../../../../src/interfaces/records/types.js';
import { TestDataGenerator } from '../../../utils/test-data-generator.js';
import { getCurrentTimeInHighPrecision, sleep } from '../../../../src/utils/time.js';


chai.use(chaiAsPromised);

describe('RecordsWrite', () => {
  describe('create()', () => {
    it('should be able to create and authorize a valid RecordsWrite message', async () => {
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
      const recordsWrite = await RecordsWrite.create(options);

      const message = recordsWrite.message as RecordsWriteMessage;

      expect(message.authorization).to.exist;
      expect(message.encodedData).to.equal(base64url.baseEncode(options.data));
      expect(message.descriptor.dataFormat).to.equal(options.dataFormat);
      expect(message.descriptor.dateCreated).to.equal(options.dateCreated);
      expect(message.recordId).to.equal(options.recordId);

      const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);

      await recordsWrite.authorize(messageStoreStub);
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
      const recordsWrite = await RecordsWrite.create(options);

      const message = recordsWrite.message as RecordsWriteMessage;

      expect(message.descriptor.datePublished).to.exist;
    });
  });

  describe('createFrom()', () => {
    it('should create a RecordsWrite with `published` set to `true` with just `publishedDate` given', async () => {
      const { requester, recordsWrite } = await TestDataGenerator.generateRecordsWriteMessage({
        published: false
      });

      const write = await RecordsWrite.createFrom({
        target                      : requester.did,
        unsignedRecordsWriteMessage : recordsWrite.message,
        datePublished               : getCurrentTimeInHighPrecision(),
        signatureInput              : TestDataGenerator.createSignatureInputFromPersona(requester)
      });

      expect(write.message.descriptor.published).to.be.true;
    });
  });

  describe('compareModifiedTime', () => {
    it('should return 0 if age is same', async () => {
      const dateModified = getCurrentTimeInHighPrecision();
      const a = (await TestDataGenerator.generateRecordsWriteMessage({ dateModified })).message;
      const b = JSON.parse(JSON.stringify(a)); // create a deep copy of `a`

      const compareResult = await RecordsWrite.compareModifiedTime(a, b);
      expect(compareResult).to.equal(0);
    });
  });

  describe('getNewestMessage', () => {
    it('should return the newest message', async () => {
      const a = (await TestDataGenerator.generateRecordsWriteMessage()).message;
      await sleep(1); // need to sleep for at least one millisecond else some messages get generated with the same time
      const b = (await TestDataGenerator.generateRecordsWriteMessage()).message;
      await sleep(1);
      const c = (await TestDataGenerator.generateRecordsWriteMessage()).message; // c is the newest since its created last

      const newestMessage = await RecordsWrite.getNewestMessage([b, c, a]);
      if (newestMessage?.recordId !== c.recordId) {
        console.log(`a: ${a.descriptor.dateModified}`);
        console.log(`b: ${b.descriptor.dateModified}`);
        console.log(`c: ${c.descriptor.dateModified}`);
      }
      expect(newestMessage?.recordId).to.equal(c.recordId);
    });
  });

  describe('getCid', () => {
    it('should return the same value with or without `encodedData`', async () => {
      const messageData = await TestDataGenerator.generateRecordsWriteMessage();

      const messageWithoutEncodedData = { ...messageData.message };
      delete messageWithoutEncodedData.encodedData;

      const cidOfMessageWithEncodedData = await RecordsWrite.getCid(messageData.message);
      const cidOfMessageWithoutData = await RecordsWrite.getCid(messageWithoutEncodedData);

      expect(cidOfMessageWithEncodedData.toString()).to.equal(cidOfMessageWithoutData.toString());
    });
  });
});

