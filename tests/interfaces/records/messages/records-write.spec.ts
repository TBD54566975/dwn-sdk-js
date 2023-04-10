import type { RecordsWriteMessage } from '../../../../src/interfaces/records/types.js';

import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import chai, { expect } from 'chai';

import { DwnErrorCode } from '../../../../src/core/dwn-error.js';
import { Jws } from '../../../../src/index.js';
import { MessageStoreLevel } from '../../../../src/store/message-store-level.js';
import { RecordsWrite } from '../../../../src/interfaces/records/messages/records-write.js';
import { TestDataGenerator } from '../../../utils/test-data-generator.js';
import { getCurrentTimeInHighPrecision, sleep } from '../../../../src/utils/time.js';


chai.use(chaiAsPromised);

describe('RecordsWrite', () => {
  describe('create()', () => {
    it('should be able to create and authorize a valid RecordsWrite message', async () => {
      // testing `create()` first
      const alice = await TestDataGenerator.generatePersona();

      const options = {
        recipient                   : alice.did,
        data                        : TestDataGenerator.randomBytes(10),
        dataFormat                  : 'application/json',
        dateCreated                 : '2022-10-14T10:20:30.405060',
        recordId                    : await TestDataGenerator.randomCborSha256Cid(),
        authorizationSignatureInput : Jws.createSignatureInput(alice)
      };
      const recordsWrite = await RecordsWrite.create(options);

      const message = recordsWrite.message as RecordsWriteMessage;

      expect(message.authorization).to.exist;
      expect(message.descriptor.dataFormat).to.equal(options.dataFormat);
      expect(message.descriptor.dateCreated).to.equal(options.dateCreated);
      expect(message.recordId).to.equal(options.recordId);

      const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);

      await recordsWrite.authorize(alice.did, messageStoreStub);
    });

    it('should be able to auto-fill `datePublished` when `published` set to `true` but `datePublished` not given', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const options = {
        recipient                   : alice.did,
        data                        : TestDataGenerator.randomBytes(10),
        dataFormat                  : 'application/json',
        recordId                    : await TestDataGenerator.randomCborSha256Cid(),
        published                   : true,
        authorizationSignatureInput : Jws.createSignatureInput(alice)
      };
      const recordsWrite = await RecordsWrite.create(options);

      const message = recordsWrite.message as RecordsWriteMessage;

      expect(message.descriptor.datePublished).to.exist;
    });

    it('should not allow `data` and `dataCid` to be both defined or undefined', async () => {
      const alice = await TestDataGenerator.generatePersona();

      // testing `data` and `dataCid` both defined
      const options1 = {
        recipient                   : alice.did,
        data                        : TestDataGenerator.randomBytes(10),
        dataCid                     : await TestDataGenerator.randomCborSha256Cid(),
        dataFormat                  : 'application/json',
        recordId                    : await TestDataGenerator.randomCborSha256Cid(),
        published                   : true,
        authorizationSignatureInput : Jws.createSignatureInput(alice)
      };
      const createPromise1 = RecordsWrite.create(options1);

      await expect(createPromise1).to.be.rejectedWith('one and only one parameter between `data` and `dataCid` is allowed');

      // testing `data` and `dataCid` both undefined
      const options2 = {
        recipient                   : alice.did,
        // intentionally showing both `data` and `dataCid` are undefined
        // data                        : TestDataGenerator.randomBytes(10),
        // dataCid                     : await TestDataGenerator.randomCborSha256Cid(),
        dataFormat                  : 'application/json',
        recordId                    : await TestDataGenerator.randomCborSha256Cid(),
        published                   : true,
        authorizationSignatureInput : Jws.createSignatureInput(alice)
      };
      const createPromise2 = RecordsWrite.create(options2);

      await expect(createPromise2).to.be.rejectedWith('one and only one parameter between `data` and `dataCid` is allowed');
    });

    it('should required `dataCid` and `dataSize` to be both defined or undefined at the same time', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const options1 = {
        recipient                   : alice.did,
        dataCid                     : await TestDataGenerator.randomCborSha256Cid(),
        // dataSize                  : 123, // intentionally missing
        dataFormat                  : 'application/json',
        recordId                    : await TestDataGenerator.randomCborSha256Cid(),
        published                   : true,
        authorizationSignatureInput : Jws.createSignatureInput(alice)
      };
      const createPromise1 = RecordsWrite.create(options1);

      await expect(createPromise1).to.be.rejectedWith('`dataCid` and `dataSize` must both be defined or undefined at the same time');

      const options2 = {
        recipient                   : alice.did,
        data                        : TestDataGenerator.randomBytes(10),
        // dataCid                   : await TestDataGenerator.randomCborSha256Cid(), // intentionally missing
        dataSize                    : 123,
        dataFormat                  : 'application/json',
        recordId                    : await TestDataGenerator.randomCborSha256Cid(),
        published                   : true,
        authorizationSignatureInput : Jws.createSignatureInput(alice)
      };
      const createPromise2 = RecordsWrite.create(options2);

      await expect(createPromise2).to.be.rejectedWith('`dataCid` and `dataSize` must both be defined or undefined at the same time');
    });
  });

  describe('createFrom()', () => {
    it('should create a RecordsWrite with `published` set to `true` with just `publishedDate` given', async () => {
      const { requester, recordsWrite } = await TestDataGenerator.generateRecordsWrite({
        published: false
      });

      const write = await RecordsWrite.createFrom({
        unsignedRecordsWriteMessage : recordsWrite.message,
        datePublished               : getCurrentTimeInHighPrecision(),
        authorizationSignatureInput : Jws.createSignatureInput(requester)
      });

      expect(write.message.descriptor.published).to.be.true;
    });
  });

  describe('compareModifiedTime', () => {
    it('should return 0 if age is same', async () => {
      const dateModified = getCurrentTimeInHighPrecision();
      const a = (await TestDataGenerator.generateRecordsWrite({ dateModified })).message;
      const b = JSON.parse(JSON.stringify(a)); // create a deep copy of `a`

      const compareResult = await RecordsWrite.compareModifiedTime(a, b);
      expect(compareResult).to.equal(0);
    });
  });

  describe('getNewestMessage', () => {
    it('should return the newest message', async () => {
      const a = (await TestDataGenerator.generateRecordsWrite()).message;
      await sleep(1); // need to sleep for at least one millisecond else some messages get generated with the same time
      const b = (await TestDataGenerator.generateRecordsWrite()).message;
      await sleep(1);
      const c = (await TestDataGenerator.generateRecordsWrite()).message; // c is the newest since its created last

      const newestMessage = await RecordsWrite.getNewestMessage([b, c, a]);
      expect((newestMessage as any).recordId).to.equal(c.recordId);
    });
  });

  describe('isInitialWrite', () => {
    it('should return false if given message is not a RecordsWrite', async () => {
      const { message }= await TestDataGenerator.generateRecordsQuery();
      const isInitialWrite = await RecordsWrite.isInitialWrite(message);
      expect(isInitialWrite).to.be.false;
    });
  });

  describe('getEntryId', () => {
    it('should throw if the given author is undefined', async () => {
      const { message }= await TestDataGenerator.generateRecordsWrite();
      const author = undefined;
      expect(RecordsWrite.getEntryId(author, message.descriptor)).to.be.rejectedWith(DwnErrorCode.RecordsWriteGetEntryIdUndefinedAuthor);
    });
  });
});
