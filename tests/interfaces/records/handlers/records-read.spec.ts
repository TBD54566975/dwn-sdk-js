import type { DerivedPrivateJwk } from '../../../../src/utils/hd-key.js';
import type { EncryptionInput } from '../../../../src/interfaces/records/messages/records-write.js';
import type { ProtocolDefinition } from '../../../../src/index.js';

import chaiAsPromised from 'chai-as-promised';
import emailProtocolDefinition from '../../../vectors/protocol-definitions/email.json' assert { type: 'json' };
import sinon from 'sinon';
import socialMediaProtocolDefinition from '../../../vectors/protocol-definitions/social-media.json' assert { type: 'json' };
import chai, { expect } from 'chai';

import { Comparer } from '../../../utils/comparer.js';
import { DataStoreLevel } from '../../../../src/store/data-store-level.js';
import { DidKeyResolver } from '../../../../src/did/did-key-resolver.js';
import { DwnErrorCode } from '../../../../src/core/dwn-error.js';
import { Encryption } from '../../../../src/utils/encryption.js';
import { EventLogLevel } from '../../../../src/event-log/event-log-level.js';
import { HdKey } from '../../../../src/utils/hd-key.js';
import { KeyDerivationScheme } from '../../../../src/utils/hd-key.js';
import { MessageStoreLevel } from '../../../../src/store/message-store-level.js';
import { Protocols } from '../../../../src/utils/protocols.js';
import { RecordsReadHandler } from '../../../../src/interfaces/records/handlers/records-read.js';
import { TestDataGenerator } from '../../../utils/test-data-generator.js';
import { TestStubGenerator } from '../../../utils/test-stub-generator.js';

import { DataStream, DidResolver, Dwn, Encoder, Jws, Records, RecordsDelete, RecordsRead } from '../../../../src/index.js';

chai.use(chaiAsPromised);

describe('RecordsReadHandler.handle()', () => {
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

    it('should allow tenant to RecordsRead their own record', async () => {
      const alice = await DidKeyResolver.generate();

      // insert data
      const { message, dataStream, dataBytes } = await TestDataGenerator.generateRecordsWrite({ requester: alice });
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
      expect(Comparer.byteArraysEqual(dataFetched, dataBytes!)).to.be.true;
    });

    it('should not allow non-tenant to RecordsRead their a record data', async () => {
      const alice = await DidKeyResolver.generate();

      // insert data
      const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ requester: alice });
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
      const { message, dataStream, dataBytes } = await TestDataGenerator.generateRecordsWrite({ requester: alice, published: true });
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
      expect(Comparer.byteArraysEqual(dataFetched, dataBytes!)).to.be.true;
    });

    it('should allow an authenticated user to RecordRead data that is published', async () => {
      const alice = await DidKeyResolver.generate();

      // insert public data
      const { message, dataStream, dataBytes } = await TestDataGenerator.generateRecordsWrite({ requester: alice, published: true });
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
      expect(Comparer.byteArraysEqual(dataFetched, dataBytes!)).to.be.true;
    });

    describe('protocol based reads', () => {
      it('should allow read with allow-anyone rule', async () => {
        // scenario: Alice writes an image to her DWN, then Bob reads the image because he is "anyone".

        const alice = await DidKeyResolver.generate();
        const bob = await DidKeyResolver.generate();

        const protocol = 'https://tbd.website/decentralized-web-node/protocols/social-media';
        const protocolDefinition: ProtocolDefinition = socialMediaProtocolDefinition;

        // Install social-media protocol on Alice's DWN
        const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
          requester: alice,
          protocol,
          protocolDefinition
        });
        const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message, protocolsConfig.dataStream);
        expect(protocolWriteReply.status.code).to.equal(202);

        // Alice writes image to her DWN
        const encodedImage = new TextEncoder().encode('cafe-aesthetic.jpg');
        const imageRecordsWrite = await TestDataGenerator.generateRecordsWrite({
          requester    : alice,
          protocol,
          protocolPath : 'image', // this comes from `types` in protocol definition
          schema       : Protocols.getType(protocolDefinition, 'image')!.schema,
          data         : encodedImage,
          recipientDid : alice.did
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

        const protocol = 'https://tbd.website/decentralized-web-node/protocols/email';
        const protocolDefinition: ProtocolDefinition = emailProtocolDefinition;

        // Install email protocol on Alice's DWN
        const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
          requester: alice,
          protocol,
          protocolDefinition
        });
        const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message, protocolsConfig.dataStream);
        expect(protocolWriteReply.status.code).to.equal(202);

        // Alice writes an email with Bob as recipient
        const encodedEmail = new TextEncoder().encode('Dear Bob, hello!');
        const emailRecordsWrite = await TestDataGenerator.generateRecordsWrite({
          requester    : alice,
          protocol,
          protocolPath : 'email', // this comes from `types` in protocol definition
          schema       : Protocols.getType(protocolDefinition, 'email')!.schema,
          data         : encodedEmail,
          recipientDid : bob.did
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
        expect(imposterReadReply.status.detail).to.include('inbound message action \'read\' not in list of allowed actions');
      });

      it('should allow read with author rule', async () => {
        // scenario: Bob sends an email to Alice, then Bob reads the email.
        //           ImposterBob tries and fails to read the email.
        const alice = await DidKeyResolver.generate();
        const bob = await DidKeyResolver.generate();
        const imposterBob = await DidKeyResolver.generate();

        const protocol = 'https://tbd.website/decentralized-web-node/protocols/email';
        const protocolDefinition: ProtocolDefinition = emailProtocolDefinition;

        // Install email protocol on Alice's DWN
        const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
          requester: alice,
          protocol,
          protocolDefinition
        });
        const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message, protocolsConfig.dataStream);
        expect(protocolWriteReply.status.code).to.equal(202);

        // Alice writes an email with Bob as recipient
        const encodedEmail = new TextEncoder().encode('Dear Alice, hello!');
        const emailRecordsWrite = await TestDataGenerator.generateRecordsWrite({
          requester    : bob,
          protocol,
          protocolPath : 'email', // this comes from `types` in protocol definition
          schema       : Protocols.getType(protocolDefinition, 'email')!.schema,
          data         : encodedEmail,
          recipientDid : alice.did
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
        expect(imposterReadReply.status.detail).to.include('inbound message action \'read\' not in list of allowed actions');
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
      const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ requester: alice, published: true });
      const writeReply = await dwn.processMessage(alice.did, message, dataStream);
      expect(writeReply.status.code).to.equal(202);

      // ensure data is inserted
      const queryData = await TestDataGenerator.generateRecordsQuery({
        requester : alice,
        filter    : { recordId: message.recordId }
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
      const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ requester: alice });
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
      it('should only be able to decrypt record with a correct derived private key', async () => {
        // scenario, Bob writes into Alice's DWN an encrypted "email", alice is able to decrypt it

        // creating Alice and Bob persona and setting up a stub DID resolver
        const alice = await TestDataGenerator.generatePersona();
        const bob = await TestDataGenerator.generatePersona();
        TestStubGenerator.stubDidResolver(didResolver, [alice, bob]);

        // configure protocol
        const protocol = 'https://email-protocol.com';
        const protocolDefinition: ProtocolDefinition = emailProtocolDefinition;
        const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
          requester: alice,
          protocol,
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
            derivationScheme : KeyDerivationScheme.Protocols,
            publicKey        : alice.keyPair.publicJwk // reusing signing key for encryption purely as a convenience
          }]
        };

        const { message, dataStream } = await TestDataGenerator.generateRecordsWrite(
          {
            requester    : bob,
            protocol,
            protocolPath : 'email', // this comes from `types` in protocol definition
            schema       : Protocols.getType(emailProtocolDefinition, 'email')!.schema,
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
        expect(Comparer.byteArraysEqual(plaintextBytes, bobMessageBytes)).to.be.true;

        // test unable to decrypt the message if derived key has an unexpected path
        const invalidDerivationPath = [KeyDerivationScheme.Protocols, protocol, 'invalidContextId'];
        const inValidDescendantPrivateKey: DerivedPrivateJwk = await HdKey.derivePrivateKey(rootPrivateKey, invalidDerivationPath);
        await expect(Records.decrypt(unsignedRecordsWrite, inValidDescendantPrivateKey, cipherStream)).to.be.rejectedWith(
          DwnErrorCode.RecordsInvalidAncestorKeyDerivationSegment
        );

        // test unable to decrypt the message if there no derivation scheme(s) used by the message matches the scheme used by the given private key
        const privateKeyWithMismatchingDerivationScheme: DerivedPrivateJwk = {
          derivationScheme  : 'scheme-that-is-not-protocol-context' as any,
          derivedPrivateKey : alice.keyPair.privateJwk
        };
        await expect(Records.decrypt(unsignedRecordsWrite, privateKeyWithMismatchingDerivationScheme, cipherStream)).to.be.rejectedWith(
          DwnErrorCode.RecordsDecryptNoMatchingKeyDerivationScheme
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
    const messageStore = sinon.createStubInstance(MessageStoreLevel);
    const dataStore = sinon.createStubInstance(DataStoreLevel);

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
    const messageStore = sinon.createStubInstance(MessageStoreLevel);
    const dataStore = sinon.createStubInstance(DataStoreLevel);

    const recordsReadHandler = new RecordsReadHandler(didResolver, messageStore, dataStore);

    // stub the `parse()` function to throw an error
    sinon.stub(RecordsRead, 'parse').throws('anyError');
    const reply = await recordsReadHandler.handle({ tenant: alice.did, message: recordsRead.message });

    expect(reply.status.code).to.equal(400);
  });
});
