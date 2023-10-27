import type { MessageStore } from '../../src/types/message-store.js';
import type { RecordsWriteMessage } from '../../src/types/records-types.js';
import type { Signer } from '../../src/index.js';
import type { EncryptionInput, RecordsWriteOptions } from '../../src/interfaces/records-write.js';

import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

import { DwnErrorCode } from '../../src/core/dwn-error.js';
import { getCurrentTimeInHighPrecision } from '../../src/utils/time.js';
import { RecordsWrite } from '../../src/interfaces/records-write.js';
import { stubInterface } from 'ts-sinon';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { DidKeyResolver, Encoder, Jws, KeyDerivationScheme } from '../../src/index.js';


chai.use(chaiAsPromised);

describe('RecordsWrite', () => {
  describe('create()', () => {
    it('should be able to create and authorize a valid RecordsWrite message', async () => {
      // testing `create()` first
      const alice = await TestDataGenerator.generatePersona();

      const options: RecordsWriteOptions = {
        data        : TestDataGenerator.randomBytes(10),
        dataFormat  : 'application/json',
        dateCreated : '2022-10-14T10:20:30.405060Z',
        recordId    : await TestDataGenerator.randomCborSha256Cid(),
        signer      : Jws.createSigner(alice)
      };
      const recordsWrite = await RecordsWrite.create(options);

      const message = recordsWrite.message as RecordsWriteMessage;

      expect(message.authorization).to.exist;
      expect(message.descriptor.dataFormat).to.equal(options.dataFormat);
      expect(message.descriptor.dateCreated).to.equal(options.dateCreated);
      expect(message.recordId).to.equal(options.recordId);

      const messageStoreStub = stubInterface<MessageStore>();

      await recordsWrite.authorize(alice.did, messageStoreStub);
    });

    it('should be able to auto-fill `datePublished` when `published` set to `true` but `datePublished` not given', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const options: RecordsWriteOptions = {
        data       : TestDataGenerator.randomBytes(10),
        dataFormat : 'application/json',
        recordId   : await TestDataGenerator.randomCborSha256Cid(),
        published  : true,
        signer     : Jws.createSigner(alice)
      };
      const recordsWrite = await RecordsWrite.create(options);

      const message = recordsWrite.message as RecordsWriteMessage;

      expect(message.descriptor.datePublished).to.exist;
    });

    it('should not allow `data` and `dataCid` to be both defined or undefined', async () => {
      const alice = await TestDataGenerator.generatePersona();

      // testing `data` and `dataCid` both defined
      const options1 = {
        recipient           : alice.did,
        data                : TestDataGenerator.randomBytes(10),
        dataCid             : await TestDataGenerator.randomCborSha256Cid(),
        dataFormat          : 'application/json',
        recordId            : await TestDataGenerator.randomCborSha256Cid(),
        published           : true,
        authorizationSigner : Jws.createSigner(alice)
      };
      const createPromise1 = RecordsWrite.create(options1);

      await expect(createPromise1).to.be.rejectedWith('one and only one parameter between `data` and `dataCid` is allowed');

      // testing `data` and `dataCid` both undefined
      const options2 = {
        recipient           : alice.did,
        // intentionally showing both `data` and `dataCid` are undefined
        // data                        : TestDataGenerator.randomBytes(10),
        // dataCid                     : await TestDataGenerator.randomCborSha256Cid(),
        dataFormat          : 'application/json',
        recordId            : await TestDataGenerator.randomCborSha256Cid(),
        published           : true,
        authorizationSigner : Jws.createSigner(alice)
      };
      const createPromise2 = RecordsWrite.create(options2);

      await expect(createPromise2).to.be.rejectedWith('one and only one parameter between `data` and `dataCid` is allowed');
    });

    it('should required `dataCid` and `dataSize` to be both defined or undefined at the same time', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const options1 = {
        recipient           : alice.did,
        dataCid             : await TestDataGenerator.randomCborSha256Cid(),
        // dataSize                  : 123, // intentionally missing
        dataFormat          : 'application/json',
        recordId            : await TestDataGenerator.randomCborSha256Cid(),
        published           : true,
        authorizationSigner : Jws.createSigner(alice)
      };
      const createPromise1 = RecordsWrite.create(options1);

      await expect(createPromise1).to.be.rejectedWith('`dataCid` and `dataSize` must both be defined or undefined at the same time');

      const options2 = {
        recipient           : alice.did,
        data                : TestDataGenerator.randomBytes(10),
        // dataCid                   : await TestDataGenerator.randomCborSha256Cid(), // intentionally missing
        dataSize            : 123,
        dataFormat          : 'application/json',
        recordId            : await TestDataGenerator.randomCborSha256Cid(),
        published           : true,
        authorizationSigner : Jws.createSigner(alice)
      };
      const createPromise2 = RecordsWrite.create(options2);

      await expect(createPromise2).to.be.rejectedWith('`dataCid` and `dataSize` must both be defined or undefined at the same time');
    });

    it('should auto-normalize protocol URL', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const options: RecordsWriteOptions = {
        recipient    : alice.did,
        data         : TestDataGenerator.randomBytes(10),
        dataFormat   : 'application/json',
        signer       : Jws.createSigner(alice),
        protocol     : 'example.com/',
        protocolPath : 'example',
        schema       : 'http://foo.bar/schema'
      };
      const recordsWrite = await RecordsWrite.create(options);

      const message = recordsWrite.message as RecordsWriteMessage;

      expect(message.descriptor.protocol).to.eq('http://example.com');
    });

    it('should required `protocol` and `protocolPath` to be both defined or undefined at the same time', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const options1 = {
        recipient           : alice.did,
        protocol            : 'http://example.com',
        // protocolPath                : 'foo/bar', // intentionally missing
        dataCid             : await TestDataGenerator.randomCborSha256Cid(),
        dataSize            : 123,
        dataFormat          : 'application/json',
        recordId            : await TestDataGenerator.randomCborSha256Cid(),
        authorizationSigner : Jws.createSigner(alice)
      };
      const createPromise1 = RecordsWrite.create(options1);

      await expect(createPromise1).to.be.rejectedWith('`protocol` and `protocolPath` must both be defined or undefined at the same time');

      const options2 = {
        recipient           : alice.did,
        // protocol                    : 'http://example.com', // intentionally missing
        protocolPath        : 'foo/bar',
        data                : TestDataGenerator.randomBytes(10),
        dataCid             : await TestDataGenerator.randomCborSha256Cid(),
        dataSize            : 123,
        dataFormat          : 'application/json',
        recordId            : await TestDataGenerator.randomCborSha256Cid(),
        authorizationSigner : Jws.createSigner(alice)
      };
      const createPromise2 = RecordsWrite.create(options2);

      await expect(createPromise2).to.be.rejectedWith('`protocol` and `protocolPath` must both be defined or undefined at the same time');
    });

    it('#434 - should required `contextId` when `parent` is specified', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const options: RecordsWriteOptions = {
        schema       : 'http://any-schema.com',
        protocol     : 'http://example.com',
        protocolPath : 'foo/bar',
        parentId     : await TestDataGenerator.randomCborSha256Cid(),
        dataCid      : await TestDataGenerator.randomCborSha256Cid(),
        dataSize     : 123,
        dataFormat   : 'application/json',
        recordId     : await TestDataGenerator.randomCborSha256Cid(),
        signer       : Jws.createSigner(alice)
      };

      const createPromise = RecordsWrite.create(options);

      await expect(createPromise).to.be.rejectedWith('`contextId` must also be given when `parentId` is specified');
    });

    it('should be able to create a RecordsWrite successfully using a custom signer', async () => {
      // create a custom signer
      const hardCodedSignature = Encoder.stringToBytes('some_hard_coded_signature');
      class CustomSigner implements Signer {
        public keyId = 'did:example:alice#key1';
        public algorithm = 'unused';
        public async sign (_content: Uint8Array): Promise<Uint8Array> {
          return hardCodedSignature;
        }
      }

      const signer = new CustomSigner();

      const options: RecordsWriteOptions = {
        schema       : 'http://any-schema.com',
        protocol     : 'http://example.com',
        protocolPath : 'foo/bar',
        dataCid      : await TestDataGenerator.randomCborSha256Cid(),
        dataSize     : 123,
        dataFormat   : 'application/json',
        recordId     : await TestDataGenerator.randomCborSha256Cid(),
        signer
      };

      const recordsWrite = await RecordsWrite.create(options);

      expect(recordsWrite.message.authorization!.authorSignature.signatures[0].signature).to.equal(Encoder.bytesToBase64Url(hardCodedSignature));
    });

    it('should throw if attempting to use `protocols` key derivation encryption scheme on non-protocol-based record', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const dataEncryptionInitializationVector = TestDataGenerator.randomBytes(16);
      const dataEncryptionKey = TestDataGenerator.randomBytes(32);
      const encryptionInput: EncryptionInput = {
        initializationVector : dataEncryptionInitializationVector,
        key                  : dataEncryptionKey,
        keyEncryptionInputs  : [{
          publicKeyId      : alice.keyId, // reusing signing key for encryption purely as a convenience
          publicKey        : alice.keyPair.publicJwk,
          derivationScheme : KeyDerivationScheme.ProtocolPath
        }]
      };

      // intentionally generating a record that is not protocol-based
      const createPromise = RecordsWrite.create({
        signer     : Jws.createSigner(alice),
        dataFormat : 'application/json',
        data       : TestDataGenerator.randomBytes(10),
        encryptionInput
      });

      await expect(createPromise).to.be.rejectedWith(DwnErrorCode.RecordsWriteMissingProtocol);
    });

    it('should throw if attempting to use `schemas` key derivation encryption scheme on a record without `schema`', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const dataEncryptionInitializationVector = TestDataGenerator.randomBytes(16);
      const dataEncryptionKey = TestDataGenerator.randomBytes(32);
      const encryptionInput: EncryptionInput = {
        initializationVector : dataEncryptionInitializationVector,
        key                  : dataEncryptionKey,
        keyEncryptionInputs  : [{
          publicKeyId      : alice.keyId, // reusing signing key for encryption purely as a convenience
          publicKey        : alice.keyPair.publicJwk,
          derivationScheme : KeyDerivationScheme.Schemas
        }]
      };

      // intentionally generating a record that is without `schema`
      const createPromise = RecordsWrite.create({
        signer     : Jws.createSigner(alice),
        dataFormat : 'application/octet-stream',
        data       : TestDataGenerator.randomBytes(10),
        encryptionInput
      });

      await expect(createPromise).to.be.rejectedWith(DwnErrorCode.RecordsWriteMissingSchema);
    });
  });

  describe('createFrom()', () => {
    it('should create a RecordsWrite with `published` set to `true` with just `publishedDate` given', async () => {
      const { author, recordsWrite } = await TestDataGenerator.generateRecordsWrite({
        published: false
      });

      const write = await RecordsWrite.createFrom({
        recordsWriteMessage : recordsWrite.message,
        datePublished       : getCurrentTimeInHighPrecision(),
        signer              : Jws.createSigner(author)
      });

      expect(write.message.descriptor.published).to.be.true;
    });
  });

  describe('isInitialWrite()', () => {
    it('should return false if given message is not a RecordsWrite', async () => {
      const { message }= await TestDataGenerator.generateRecordsQuery();
      const isInitialWrite = await RecordsWrite.isInitialWrite(message);
      expect(isInitialWrite).to.be.false;
    });
  });

  describe('getEntryId()', () => {
    it('should throw if the given author is undefined', async () => {
      const { message }= await TestDataGenerator.generateRecordsWrite();
      const author = undefined;
      expect(RecordsWrite.getEntryId(author, message.descriptor)).to.be.rejectedWith(DwnErrorCode.RecordsWriteGetEntryIdUndefinedAuthor);
    });
  });

  describe('signAsOwner()', () => {
    it('should throw if the RecordsWrite is not signed by an author yet', async () => {
      const options = {
        data        : TestDataGenerator.randomBytes(10),
        dataFormat  : 'application/json',
        dateCreated : '2023-07-27T10:20:30.405060Z',
        recordId    : await TestDataGenerator.randomCborSha256Cid(),
      };
      const recordsWrite = await RecordsWrite.create(options);

      expect(recordsWrite.author).to.not.exist;
      expect(recordsWrite.authorSignaturePayload).to.not.exist;

      const alice = await DidKeyResolver.generate();
      await expect(recordsWrite.signAsOwner(Jws.createSigner(alice))).to.rejectedWith(DwnErrorCode.RecordsWriteSignAsOwnerUnknownAuthor);

      expect(recordsWrite.owner).to.be.undefined;
      expect(recordsWrite.ownerSignaturePayload).to.be.undefined;
    });
  });

  describe('message', () => {
    it('should throw if attempting to access the message of a RecordsWrite that is not given authorization signature input', async () => {
      const options = {
        data        : TestDataGenerator.randomBytes(10),
        dataFormat  : 'application/json',
        dateCreated : '2023-07-27T10:20:30.405060Z',
        recordId    : await TestDataGenerator.randomCborSha256Cid(),
      };
      const recordsWrite = await RecordsWrite.create(options);

      expect(recordsWrite.author).to.not.exist;
      expect(recordsWrite.authorSignaturePayload).to.not.exist;

      expect(() => recordsWrite.message).to.throw(DwnErrorCode.RecordsWriteMissingAuthorizationSigner);
    });
  });
});
