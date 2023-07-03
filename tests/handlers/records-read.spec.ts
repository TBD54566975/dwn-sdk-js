import type { DerivedPrivateJwk } from '../../src/utils/hd-key.js';
import type { EncryptionInput } from '../../src/interfaces/records-write.js';
import type { DataStore, EventLog, MessageStore } from '../../src/index.js';

import chaiAsPromised from 'chai-as-promised';
import emailProtocolDefinition from '../vectors/protocol-definitions/email.json' assert { type: 'json' };
import sinon from 'sinon';
import socialMediaProtocolDefinition from '../vectors/protocol-definitions/social-media.json' assert { type: 'json' };
import chai, { expect } from 'chai';

import { ArrayUtility } from '../../src/utils/array.js';
import { DidKeyResolver } from '../../src/did/did-key-resolver.js';
import { DwnErrorCode } from '../../src/core/dwn-error.js';
import { Encryption } from '../../src/utils/encryption.js';
import { HdKey } from '../../src/utils/hd-key.js';
import { KeyDerivationScheme } from '../../src/utils/hd-key.js';
import { RecordsReadHandler } from '../../src/handlers/records-read.js';
import { stubInterface } from 'ts-sinon';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestStoreInitializer } from '../test-store-initializer.js';
import { TestStubGenerator } from '../utils/test-stub-generator.js';

import { DataStream, DidResolver, Dwn, Encoder, Jws, Records, RecordsDelete, RecordsRead } from '../../src/index.js';

chai.use(chaiAsPromised);

describe('RecordsReadHandler.handle()', () => {
  let didResolver: DidResolver;
  let messageStore: MessageStore;
  let dataStore: DataStore;
  let eventLog: EventLog;
  let dwn: Dwn;

  describe('functional tests', () => {

    // important to follow the `before` and `after` pattern to initialize and clean the stores in tests
    // so that different test suites can reuse the same backend store for testing
    before(async () => {
      didResolver = new DidResolver([new DidKeyResolver()]);

      const stores = TestStoreInitializer.initializeStores();
      messageStore = stores.messageStore;
      dataStore = stores.dataStore;
      eventLog = stores.eventLog;

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

    it('should allow tenant to RecordsRead their own record', async () => {
      const alice = await DidKeyResolver.generate();

      // insert data
      const { message, dataStream, dataBytes } = await TestDataGenerator.generateRecordsWrite({ author: alice });
      const writeReply = await dwn.processMessage(alice.did, message, dataStream);
      expect(writeReply.status.code).to.equal(202);

      // testing RecordsRead
      const recordsRead = await RecordsRead.create({
        recordId                    : message.recordId,
        authorizationSignatureInput : Jws.createSignatureInput(alice)
      });

      const readReply = await dwn.handleRecordsRead(alice.did, recordsRead.message);
      expect(readReply.status.code).to.equal(200);
      expect(readReply.record).to.exist;
      expect(readReply.record?.descriptor).to.exist;

      const dataFetched = await DataStream.toBytes(readReply.record!.data!);
      expect(ArrayUtility.byteArraysEqual(dataFetched, dataBytes!)).to.be.true;
    });

    it('should not allow non-tenant to RecordsRead their a record data', async () => {
      const alice = await DidKeyResolver.generate();

      // insert data
      const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ author: alice });
      const writeReply = await dwn.processMessage(alice.did, message, dataStream);
      expect(writeReply.status.code).to.equal(202);

      // testing RecordsRead
      const bob = await DidKeyResolver.generate();

      const recordsRead = await RecordsRead.create({
        recordId                    : message.recordId,
        authorizationSignatureInput : Jws.createSignatureInput(bob)
      });

      const readReply = await dwn.processMessage(alice.did, recordsRead.message);
      expect(readReply.status.code).to.equal(401);
    });

    it('should allow reading of data that is published without `authorization`', async () => {
      const alice = await DidKeyResolver.generate();

      // insert public data
      const { message, dataStream, dataBytes } = await TestDataGenerator.generateRecordsWrite({ author: alice, published: true });
      const writeReply = await dwn.processMessage(alice.did, message, dataStream);
      expect(writeReply.status.code).to.equal(202);

      // testing public RecordsRead
      const recordsRead = await RecordsRead.create({
        recordId: message.recordId
      });
      expect(recordsRead.author).to.be.undefined; // making sure no author/authorization is created

      const readReply = await dwn.handleRecordsRead(alice.did, recordsRead.message);
      expect(readReply.status.code).to.equal(200);

      const dataFetched = await DataStream.toBytes(readReply.record!.data!);
      expect(ArrayUtility.byteArraysEqual(dataFetched, dataBytes!)).to.be.true;
    });

    it('should allow an authenticated user to RecordRead data that is published', async () => {
      const alice = await DidKeyResolver.generate();

      // insert public data
      const { message, dataStream, dataBytes } = await TestDataGenerator.generateRecordsWrite({ author: alice, published: true });
      const writeReply = await dwn.processMessage(alice.did, message, dataStream);
      expect(writeReply.status.code).to.equal(202);

      // testing public RecordsRead
      const bob = await DidKeyResolver.generate();

      const recordsRead = await RecordsRead.create({
        recordId                    : message.recordId,
        authorizationSignatureInput : Jws.createSignatureInput(bob)
      });

      const readReply = await dwn.handleRecordsRead(alice.did, recordsRead.message);
      expect(readReply.status.code).to.equal(200);

      const dataFetched = await DataStream.toBytes(readReply.record!.data!);
      expect(ArrayUtility.byteArraysEqual(dataFetched, dataBytes!)).to.be.true;
    });

    it('should allow a non-tenant to read RecordsRead data they have received', async () => {
      const alice = await DidKeyResolver.generate();
      const bob = await DidKeyResolver.generate();

      // Alice inserts data with Bob as recipient
      const { message, dataStream, dataBytes } = await TestDataGenerator.generateRecordsWrite({
        author    : alice,
        recipient : bob.did,
      });
      const writeReply = await dwn.processMessage(alice.did, message, dataStream);
      expect(writeReply.status.code).to.equal(202);

      // Bob reads the data that Alice sent him
      const recordsRead = await RecordsRead.create({
        recordId                    : message.recordId,
        authorizationSignatureInput : Jws.createSignatureInput(bob)
      });

      const readReply = await dwn.handleRecordsRead(alice.did, recordsRead.message);
      expect(readReply.status.code).to.equal(200);
      expect(readReply.record).to.exist;
      expect(readReply.record?.descriptor).to.exist;

      const dataFetched = await DataStream.toBytes(readReply.record!.data!);
      expect(ArrayUtility.byteArraysEqual(dataFetched, dataBytes!)).to.be.true;
    });

    describe('protocol based reads', () => {
      it('should allow read with allow-anyone rule', async () => {
        // scenario: Alice writes an image to her DWN, then Bob reads the image because he is "anyone".

        const alice = await DidKeyResolver.generate();
        const bob = await DidKeyResolver.generate();

        const protocolDefinition = socialMediaProtocolDefinition;

        // Install social-media protocol on Alice's DWN
        const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
          author: alice,
          protocolDefinition
        });
        const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message, protocolsConfig.dataStream);
        expect(protocolWriteReply.status.code).to.equal(202);

        // Alice writes image to her DWN
        const encodedImage = new TextEncoder().encode('cafe-aesthetic.jpg');
        const imageRecordsWrite = await TestDataGenerator.generateRecordsWrite({
          author       : alice,
          protocol     : protocolDefinition.protocol,
          protocolPath : 'image', // this comes from `types` in protocol definition
          schema       : protocolDefinition.types.image.schema,
          dataFormat   : 'image/jpeg',
          data         : encodedImage,
          recipient    : alice.did
        });
        const imageReply = await dwn.processMessage(alice.did, imageRecordsWrite.message, imageRecordsWrite.dataStream);
        expect(imageReply.status.code).to.equal(202);

        // Bob (anyone) reads the image that Alice wrote
        const imageRecordsRead = await RecordsRead.create({
          recordId                    : imageRecordsWrite.message.recordId,
          authorizationSignatureInput : Jws.createSignatureInput(bob)
        });
        const imageReadReply = await dwn.processMessage(alice.did, imageRecordsRead.message);
        expect(imageReadReply.status.code).to.equal(200);
      });

      it('should allow read with recipient rule', async () => {
        // scenario: Alice sends an email to Bob, then Bob reads the email.
        //           ImposterBob tries and fails to read the email.

        const alice = await DidKeyResolver.generate();
        const bob = await DidKeyResolver.generate();
        const imposterBob = await DidKeyResolver.generate();

        const protocolDefinition = emailProtocolDefinition;

        // Install email protocol on Alice's DWN
        const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
          author: alice,
          protocolDefinition
        });
        const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message, protocolsConfig.dataStream);
        expect(protocolWriteReply.status.code).to.equal(202);

        // Alice writes an email with Bob as recipient
        const encodedEmail = new TextEncoder().encode('Dear Bob, hello!');
        const emailRecordsWrite = await TestDataGenerator.generateRecordsWrite({
          author       : alice,
          protocol     : protocolDefinition.protocol,
          protocolPath : 'email', // this comes from `types` in protocol definition
          schema       : protocolDefinition.types.email.schema,
          dataFormat   : protocolDefinition.types.email.dataFormats[0],
          data         : encodedEmail,
          recipient    : bob.did
        });
        const imageReply = await dwn.processMessage(alice.did, emailRecordsWrite.message, emailRecordsWrite.dataStream);
        expect(imageReply.status.code).to.equal(202);

        // Bob reads Alice's email
        const bobRecordsRead = await RecordsRead.create({
          recordId                    : emailRecordsWrite.message.recordId,
          authorizationSignatureInput : Jws.createSignatureInput(bob)
        });
        const bobReadReply = await dwn.processMessage(alice.did, bobRecordsRead.message);
        expect(bobReadReply.status.code).to.equal(200);

        // ImposterBob is not able to read Alice's email
        const imposterRecordsRead = await RecordsRead.create({
          recordId                    : emailRecordsWrite.message.recordId,
          authorizationSignatureInput : Jws.createSignatureInput(imposterBob)
        });
        const imposterReadReply = await dwn.processMessage(alice.did, imposterRecordsRead.message);
        expect(imposterReadReply.status.code).to.equal(401);
        expect(imposterReadReply.status.detail).to.include(DwnErrorCode.ProtocolAuthorizationActionNotAllowed);
      });

      it('should allow read with author rule', async () => {
        // scenario: Bob sends an email to Alice, then Bob reads the email.
        //           ImposterBob tries and fails to read the email.
        const alice = await DidKeyResolver.generate();
        const bob = await DidKeyResolver.generate();
        const imposterBob = await DidKeyResolver.generate();

        const protocolDefinition = emailProtocolDefinition;

        // Install email protocol on Alice's DWN
        const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
          author: alice,
          protocolDefinition
        });
        const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message, protocolsConfig.dataStream);
        expect(protocolWriteReply.status.code).to.equal(202);

        // Alice writes an email with Bob as recipient
        const encodedEmail = new TextEncoder().encode('Dear Alice, hello!');
        const emailRecordsWrite = await TestDataGenerator.generateRecordsWrite({
          author       : bob,
          protocol     : protocolDefinition.protocol,
          protocolPath : 'email', // this comes from `types` in protocol definition
          schema       : protocolDefinition.types.email.schema,
          dataFormat   : protocolDefinition.types.email.dataFormats[0],
          data         : encodedEmail,
          recipient    : alice.did
        });
        const imageReply = await dwn.processMessage(alice.did, emailRecordsWrite.message, emailRecordsWrite.dataStream);
        expect(imageReply.status.code).to.equal(202);

        // Bob reads the email he just sent
        const bobRecordsRead = await RecordsRead.create({
          recordId                    : emailRecordsWrite.message.recordId,
          authorizationSignatureInput : Jws.createSignatureInput(bob)
        });
        const bobReadReply = await dwn.processMessage(alice.did, bobRecordsRead.message);
        expect(bobReadReply.status.code).to.equal(200);

        // ImposterBob is not able to read the email
        const imposterRecordsRead = await RecordsRead.create({
          recordId                    : emailRecordsWrite.message.recordId,
          authorizationSignatureInput : Jws.createSignatureInput(imposterBob)
        });
        const imposterReadReply = await dwn.processMessage(alice.did, imposterRecordsRead.message);
        expect(imposterReadReply.status.code).to.equal(401);
        expect(imposterReadReply.status.detail).to.include(DwnErrorCode.ProtocolAuthorizationActionNotAllowed);
      });
    });

    it('should return 404 RecordRead if data does not exist', async () => {
      const alice = await DidKeyResolver.generate();

      const recordsRead = await RecordsRead.create({
        recordId                    : `non-existent-record-id`,
        authorizationSignatureInput : Jws.createSignatureInput(alice)
      });

      const readReply = await dwn.processMessage(alice.did, recordsRead.message);
      expect(readReply.status.code).to.equal(404);
    });

    it('should return 404 RecordRead if data has been deleted', async () => {
      const alice = await DidKeyResolver.generate();

      // insert public data
      const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ author: alice, published: true });
      const writeReply = await dwn.processMessage(alice.did, message, dataStream);
      expect(writeReply.status.code).to.equal(202);

      // ensure data is inserted
      const queryData = await TestDataGenerator.generateRecordsQuery({
        author : alice,
        filter : { recordId: message.recordId }
      });

      const reply = await dwn.processMessage(alice.did, queryData.message);
      expect(reply.status.code).to.equal(200);
      expect(reply.entries?.length).to.equal(1);

      // RecordsDelete
      const recordsDelete = await RecordsDelete.create({
        recordId                    : message.recordId,
        authorizationSignatureInput : Jws.createSignatureInput(alice)
      });

      const deleteReply = await dwn.processMessage(alice.did, recordsDelete.message);
      expect(deleteReply.status.code).to.equal(202);

      // RecordsRead
      const recordsRead = await RecordsRead.create({
        recordId                    : message.recordId,
        authorizationSignatureInput : Jws.createSignatureInput(alice)
      });

      const readReply = await dwn.processMessage(alice.did, recordsRead.message);
      expect(readReply.status.code).to.equal(404);
    });

    it('should return 404 underlying data store cannot locate the data', async () => {
      const alice = await DidKeyResolver.generate();

      sinon.stub(dataStore, 'get').resolves(undefined);

      // insert data
      const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ author: alice });
      const writeReply = await dwn.processMessage(alice.did, message, dataStream);
      expect(writeReply.status.code).to.equal(202);

      // testing RecordsRead
      const recordsRead = await RecordsRead.create({
        recordId                    : message.recordId,
        authorizationSignatureInput : Jws.createSignatureInput(alice)
      });

      const readReply = await dwn.processMessage(alice.did, recordsRead.message);
      expect(readReply.status.code).to.equal(404);
    });

    describe('encryption scenarios', () => {
      it('should only be able to decrypt record with a correct derived private key - `dataFormats` derivation scheme', async () => {
        // scenario: Alice writes into her own DWN an encrypted record using a `dataFormats` derived key and she is able to decrypt it

        const alice = await TestDataGenerator.generatePersona();
        TestStubGenerator.stubDidResolver(didResolver, [alice]);

        // encrypt Alice's record
        const originalData = TestDataGenerator.randomBytes(1000);
        const originalDataStream = DataStream.fromBytes(originalData);
        const dataEncryptionInitializationVector = TestDataGenerator.randomBytes(16);
        const dataEncryptionKey = TestDataGenerator.randomBytes(32);
        const encryptedDataStream = await Encryption.aes256CtrEncrypt(dataEncryptionKey, dataEncryptionInitializationVector, originalDataStream);
        const encryptedDataBytes = await DataStream.toBytes(encryptedDataStream);

        const encryptionInput: EncryptionInput = {
          initializationVector : dataEncryptionInitializationVector,
          key                  : dataEncryptionKey,
          keyEncryptionInputs  : [{
            publicKeyId      : alice.keyId, // reusing signing key for encryption purely as a convenience
            publicKey        : alice.keyPair.publicJwk,
            derivationScheme : KeyDerivationScheme.DataFormats
          }]
        };

        const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({
          author : alice,
          data   : encryptedDataBytes,
          encryptionInput
        });

        const writeReply = await dwn.processMessage(alice.did, message, dataStream);
        expect(writeReply.status.code).to.equal(202);

        const recordsRead = await RecordsRead.create({
          recordId                    : message.recordId,
          authorizationSignatureInput : Jws.createSignatureInput(alice)
        });
        const readReply = await dwn.handleRecordsRead(alice.did, recordsRead.message);
        expect(readReply.status.code).to.equal(200);

        const unsignedRecordsWrite = readReply.record!;
        const cipherStream = readReply.record!.data;


        // test able to decrypt the message using the root key
        const rootPrivateKey: DerivedPrivateJwk = {
          rootKeyId         : alice.keyId,
          derivationScheme  : KeyDerivationScheme.DataFormats,
          derivedPrivateKey : alice.keyPair.privateJwk
        };

        const plaintextDataStream = await Records.decrypt(unsignedRecordsWrite, rootPrivateKey, cipherStream);
        const plaintextBytes = await DataStream.toBytes(plaintextDataStream);
        expect(ArrayUtility.byteArraysEqual(plaintextBytes, originalData)).to.be.true;


        // test able to decrypt the message using a derived key
        const readReply2 = await dwn.handleRecordsRead(alice.did, recordsRead.message); // process the same read message to get a new cipher stream
        expect(readReply.status.code).to.equal(200);
        const cipherStream2 = readReply2.record!.data;

        const derivationPath = [KeyDerivationScheme.DataFormats, message.descriptor.dataFormat];
        const derivedPrivateKey: DerivedPrivateJwk = await HdKey.derivePrivateKey(rootPrivateKey, derivationPath);

        const plaintextDataStream2 = await Records.decrypt(unsignedRecordsWrite, derivedPrivateKey, cipherStream2);
        const plaintextBytes2 = await DataStream.toBytes(plaintextDataStream2);
        expect(ArrayUtility.byteArraysEqual(plaintextBytes2, originalData)).to.be.true;


        // test unable to decrypt the message if derived key has an unexpected path
        const readReply3 = await dwn.handleRecordsRead(alice.did, recordsRead.message); // process the same read message to get a new cipher stream
        expect(readReply.status.code).to.equal(200);
        const cipherStream3 = readReply3.record!.data;

        const invalidDerivationPath = [KeyDerivationScheme.DataFormats, 'invalidDataFormat'];
        const inValidDescendantPrivateKey: DerivedPrivateJwk = await HdKey.derivePrivateKey(rootPrivateKey, invalidDerivationPath);
        await expect(Records.decrypt(unsignedRecordsWrite, inValidDescendantPrivateKey, cipherStream3)).to.be.rejectedWith(
          DwnErrorCode.RecordsInvalidAncestorKeyDerivationSegment
        );
      });

      it('should only be able to decrypt record with a correct derived private key  - `protocols` derivation scheme', async () => {
        // scenario, Bob writes into Alice's DWN an encrypted "email", alice is able to decrypt it

        // creating Alice and Bob persona and setting up a stub DID resolver
        const alice = await TestDataGenerator.generatePersona();
        const bob = await TestDataGenerator.generatePersona();
        TestStubGenerator.stubDidResolver(didResolver, [alice, bob]);

        // configure protocol
        const protocolDefinition = emailProtocolDefinition;
        const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
          author: alice,
          protocolDefinition
        });

        const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message, protocolsConfig.dataStream);
        expect(protocolsConfigureReply.status.code).to.equal(202);

        // encrypt bob's message
        const bobMessageBytes = Encoder.stringToBytes('message from bob');
        const bobMessageStream = DataStream.fromBytes(bobMessageBytes);
        const dataEncryptionInitializationVector = TestDataGenerator.randomBytes(16);
        const dataEncryptionKey = TestDataGenerator.randomBytes(32);
        const bobMessageEncryptedStream = await Encryption.aes256CtrEncrypt(dataEncryptionKey, dataEncryptionInitializationVector, bobMessageStream);
        const bobMessageEncryptedBytes = await DataStream.toBytes(bobMessageEncryptedStream);

        // generate a `RecordsWrite` message from bob allowed by anyone
        const encryptionInput: EncryptionInput = {
          initializationVector : dataEncryptionInitializationVector,
          key                  : dataEncryptionKey,
          keyEncryptionInputs  : [{
            publicKeyId      : alice.keyId, // reusing signing key for encryption purely as a convenience
            publicKey        : alice.keyPair.publicJwk,
            derivationScheme : KeyDerivationScheme.Protocols
          }]
        };

        const { message, dataStream } = await TestDataGenerator.generateRecordsWrite(
          {
            author       : bob,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'email', // this comes from `types` in protocol definition
            schema       : protocolDefinition.types.email.schema,
            dataFormat   : protocolDefinition.types.email.dataFormats[0],
            data         : bobMessageEncryptedBytes,
            encryptionInput
          }
        );

        const bobWriteReply = await dwn.processMessage(alice.did, message, dataStream);
        expect(bobWriteReply.status.code).to.equal(202);

        const recordsRead = await RecordsRead.create({
          recordId                    : message.recordId, // assume alice can do a query to get the new email and its `recordId`
          authorizationSignatureInput : Jws.createSignatureInput(alice)
        });
        const readReply = await dwn.handleRecordsRead(alice.did, recordsRead.message);
        expect(readReply.status.code).to.equal(200);

        // test able to decrypt the message using a derived key
        const rootPrivateKey: DerivedPrivateJwk = {
          rootKeyId         : alice.keyId,
          derivationScheme  : KeyDerivationScheme.Protocols,
          derivedPrivateKey : alice.keyPair.privateJwk
        };
        const relativeDescendantDerivationPath = Records.constructKeyDerivationPath(
          KeyDerivationScheme.Protocols,
          message.recordId,
          message.contextId,
          message.descriptor
        );
        const descendantPrivateKey: DerivedPrivateJwk = await HdKey.derivePrivateKey(rootPrivateKey, relativeDescendantDerivationPath);

        const unsignedRecordsWrite = readReply.record!;
        const cipherStream = readReply.record!.data;

        const plaintextDataStream = await Records.decrypt(unsignedRecordsWrite, descendantPrivateKey, cipherStream);
        const plaintextBytes = await DataStream.toBytes(plaintextDataStream);
        expect(ArrayUtility.byteArraysEqual(plaintextBytes, bobMessageBytes)).to.be.true;

        // test unable to decrypt the message if derived key has an unexpected path
        const invalidDerivationPath = [KeyDerivationScheme.Protocols, protocolDefinition.protocol, 'invalidContextId'];
        const inValidDescendantPrivateKey: DerivedPrivateJwk = await HdKey.derivePrivateKey(rootPrivateKey, invalidDerivationPath);
        await expect(Records.decrypt(unsignedRecordsWrite, inValidDescendantPrivateKey, cipherStream)).to.be.rejectedWith(
          DwnErrorCode.RecordsInvalidAncestorKeyDerivationSegment
        );

        // test unable to decrypt the message if no derivation scheme used by the message matches the scheme used by the given private key
        const privateKeyWithMismatchingDerivationScheme: DerivedPrivateJwk = {
          rootKeyId         : alice.keyId,
          derivationScheme  : 'scheme-that-is-not-protocol-context' as any,
          derivedPrivateKey : alice.keyPair.privateJwk
        };
        await expect(Records.decrypt(unsignedRecordsWrite, privateKeyWithMismatchingDerivationScheme, cipherStream)).to.be.rejectedWith(
          DwnErrorCode.RecordsDecryptNoMatchingKeyEncryptedFound
        );

        // test unable to decrypt the message if public key ID does not match the derived private key
        const privateKeyWithMismatchingKeyId: DerivedPrivateJwk = {
          rootKeyId         : 'mismatchingKeyId',
          derivationScheme  : KeyDerivationScheme.Protocols,
          derivedPrivateKey : alice.keyPair.privateJwk
        };
        await expect(Records.decrypt(unsignedRecordsWrite, privateKeyWithMismatchingKeyId, cipherStream)).to.be.rejectedWith(
          DwnErrorCode.RecordsDecryptNoMatchingKeyEncryptedFound
        );
      });
    });
  });

  it('should return 401 if signature check fails', async () => {
    const alice = await DidKeyResolver.generate();
    const recordsRead = await RecordsRead.create({
      recordId                    : 'any-id',
      authorizationSignatureInput : Jws.createSignatureInput(alice)
    });

    // setting up a stub did resolver & message store
    // intentionally not supplying the public key so a different public key is generated to simulate invalid signature
    const mismatchingPersona = await TestDataGenerator.generatePersona({ did: alice.did, keyId: alice.keyId });
    const didResolver = TestStubGenerator.createDidResolverStub(mismatchingPersona);
    const messageStore = stubInterface<MessageStore>();
    const dataStore = stubInterface<DataStore>();

    const recordsReadHandler = new RecordsReadHandler(didResolver, messageStore, dataStore);
    const reply = await recordsReadHandler.handle({ tenant: alice.did, message: recordsRead.message });
    expect(reply.status.code).to.equal(401);
  });

  it('should return 400 if fail parsing the message', async () => {
    const alice = await DidKeyResolver.generate();
    const recordsRead = await RecordsRead.create({
      recordId                    : 'any-id',
      authorizationSignatureInput : Jws.createSignatureInput(alice)
    });

    // setting up a stub method resolver & message store
    const messageStore = stubInterface<MessageStore>();
    const dataStore = stubInterface<DataStore>();

    const recordsReadHandler = new RecordsReadHandler(didResolver, messageStore, dataStore);

    // stub the `parse()` function to throw an error
    sinon.stub(RecordsRead, 'parse').throws('anyError');
    const reply = await recordsReadHandler.handle({ tenant: alice.did, message: recordsRead.message });

    expect(reply.status.code).to.equal(400);
  });
});
