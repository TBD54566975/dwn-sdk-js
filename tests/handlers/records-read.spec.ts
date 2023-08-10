import type { DerivedPrivateJwk } from '../../src/utils/hd-key.js';
import type { EncryptionInput } from '../../src/interfaces/records-write.js';
import type { DataStore, EventLog, MessageStore, ProtocolDefinition, ProtocolsConfigureMessage } from '../../src/index.js';

import { DwnConstant, Message } from '../../src/index.js';
import { DwnInterfaceName, DwnMethodName } from '../../src/index.js';

import chaiAsPromised from 'chai-as-promised';
import chatProtocolDefinition from '../vectors/protocol-definitions/chat.json' assert { type: 'json' };
import contributionRewardProtocol from '../vectors/protocol-definitions/contribution-reward.json' assert { type: 'json' };
import emailProtocolDefinition from '../vectors/protocol-definitions/email.json' assert { type: 'json' };
import friendChatProtocol from '../vectors/protocol-definitions/friend-chat.json' assert { type: 'json' };
import groupChatProtocol from '../vectors/protocol-definitions/group-chat.json' assert { type: 'json' };
import minimalProtocolDefinition from '../vectors/protocol-definitions/minimal.json' assert { type: 'json' };
import publicChatProtocol from '../vectors/protocol-definitions/public-chat.json' assert { type: 'json' };
import sinon from 'sinon';
import socialMediaProtocolDefinition from '../vectors/protocol-definitions/social-media.json' assert { type: 'json' };
import chai, { expect } from 'chai';

import { ArrayUtility } from '../../src/utils/array.js';
import { authenticate } from '../../src/core/auth.js';
import { DidKeyResolver } from '../../src/did/did-key-resolver.js';
import { DwnErrorCode } from '../../src/core/dwn-error.js';
import { Encryption } from '../../src/utils/encryption.js';
import { HdKey } from '../../src/utils/hd-key.js';
import { KeyDerivationScheme } from '../../src/utils/hd-key.js';
import { RecordsReadHandler } from '../../src/handlers/records-read.js';
import { stubInterface } from 'ts-sinon';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestStores } from '../test-stores.js';
import { TestStubGenerator } from '../utils/test-stub-generator.js';

import { DataStream, DidResolver, Dwn, Jws, Protocols, ProtocolsConfigure, ProtocolsQuery, Records, RecordsDelete, RecordsRead , RecordsWrite, Secp256k1 } from '../../src/index.js';

chai.use(chaiAsPromised);


export function testRecordsReadHandler(): void {
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

        const stores = TestStores.get();
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

      it('should not allow only `protocol` to be set without a `protocolPath` nor `recordId`', async () => {
        const alice = await DidKeyResolver.generate();

        // insert public data
        const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ author: alice, published: true });
        const writeReply = await dwn.processMessage(alice.did, message, dataStream);
        expect(writeReply.status.code).to.equal(202);

        // create with protocol and protocolPath to avoid the failure within RecordsRead.create()
        const recordsRead = await RecordsRead.create({
          protocol                    : 'example.org/TestProto',
          protocolPath                : 'proto/path',
          authorizationSignatureInput : Jws.createSignatureInput(alice)
        });

        // delete protocolPath leaving only protocol to induce error below
        delete recordsRead.message.descriptor.protocolPath;

        const readReply = await dwn.handleRecordsRead(alice.did, recordsRead.message);
        expect(readReply.status.code).to.equal(400);
        expect(readReply.status.detail).to.contain('must have required property \'recordId\'');
      });

      it('should not allow only `protocolPath` to be set without a `protocol` nor `recordId`', async () => {
        const alice = await DidKeyResolver.generate();

        // insert public data
        const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({ author: alice, published: true });
        const writeReply = await dwn.processMessage(alice.did, message, dataStream);
        expect(writeReply.status.code).to.equal(202);

        // create with protocol and protocolPath to avoid the failure within RecordsRead.create()
        const recordsRead = await RecordsRead.create({
          protocol                    : 'example.org/TestProto',
          protocolPath                : 'proto/path',
          authorizationSignatureInput : Jws.createSignatureInput(alice)
        });

        // delete protocolPath leaving only protocol to induce error below
        delete recordsRead.message.descriptor.protocol;

        const readReply = await dwn.handleRecordsRead(alice.did, recordsRead.message);
        expect(readReply.status.code).to.equal(400);
        expect(readReply.status.detail).to.contain('must have required property \'recordId\'');
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

        it('should not allow anonymous reads when there is no allow-anyone rule', async () => {
          // scenario: Alice's writes a record to a protocol. An anonymous read his Alice's DWN and is rejected
          //           because there is not an allow-anyone rule.

          const alice = await TestDataGenerator.generatePersona();

          const protocolDefinition = emailProtocolDefinition as ProtocolDefinition;

          TestStubGenerator.stubDidResolver(didResolver, [alice]);

          const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition
          });
          const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message, protocolsConfig.dataStream);
          expect(protocolWriteReply.status.code).to.equal(202);

          // Alice writes a message to the minimal protocol
          const recordsWrite = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'email',
            schema       : protocolDefinition.types.email.schema,
            dataFormat   : protocolDefinition.types.email.dataFormats![0],
            data         : new TextEncoder().encode('foo')
          });
          const recordsWriteReply = await dwn.processMessage(alice.did, recordsWrite.message, recordsWrite.dataStream);
          expect(recordsWriteReply.status.code).to.equal(202);

          // Anonymous tries and fails to read Alice's message
          const recordsRead = await RecordsRead.create({
            recordId: recordsWrite.message.recordId,
          });
          const recordsReadReply = await dwn.processMessage(alice.did, recordsRead.message);
          expect(recordsReadReply.status.code).to.equal(401);
          expect(recordsReadReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationActionNotAllowed);
        });

        describe('recipient rules', () => {
          it('should allow read with ancestor recipient rule', async () => {
            // scenario: Alice sends an email to Bob, then Bob reads the email.
            //           ImposterBob tries and fails to read the email.

            const alice = await DidKeyResolver.generate();
            const bob = await DidKeyResolver.generate();
            const imposterBob = await DidKeyResolver.generate();

            const protocolDefinition = emailProtocolDefinition as ProtocolDefinition;

            // Install email protocol on Alice's DWN
            const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
              author: alice,
              protocolDefinition,
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
              dataFormat   : protocolDefinition.types.email.dataFormats![0],
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

          xit('should allow read with `context` recipient rule', async () => {
            // scenario: Alice creates a groupChat and sends a message to the groupChat.
            //           Bob tries and fails to read the message. Then Alice invites with Bob to the groupChat.
            //           Now, Bob is able to send a message to the groupChat because he recieved an invite.
            const protocolDefinition = groupChatProtocol;

            const alice = await TestDataGenerator.generatePersona();
            const bob = await TestDataGenerator.generatePersona();

            // setting up a stub DID resolver
            TestStubGenerator.stubDidResolver(didResolver, [alice, bob]);

            // Install protocol
            const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
              author: alice,
              protocolDefinition
            });
            const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message, protocolsConfig.dataStream);
            expect(protocolWriteReply.status.code).to.equal(202);

            // Alice starts a groupChat
            const groupChatRecordsWrite = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'groupChat',
              schema       : protocolDefinition.types.groupChat.schema,
              dataFormat   : protocolDefinition.types.groupChat.dataFormats[0],
              data         : new TextEncoder().encode('Bitcoin Barbie Groupchat'),
            });
            const groupChatReply = await dwn.processMessage(alice.did, groupChatRecordsWrite.message, groupChatRecordsWrite.dataStream);
            expect(groupChatReply.status.code).to.equal(202);

            // Alices adds a chat in the groupChat
            const chatRecordsWrite = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'groupChat/message',
              schema       : protocolDefinition.types.message.schema,
              dataFormat   : protocolDefinition.types.message.dataFormats[0],
              data         : new TextEncoder().encode('We are fans of bitcoin & barbie'),
              parentId     : groupChatRecordsWrite.message.recordId,
              contextId    : groupChatRecordsWrite.message.contextId,
            });
            const chatReply = await dwn.processMessage(alice.did, chatRecordsWrite.message, chatRecordsWrite.dataStream);
            expect(chatReply.status.code).to.equal(202);

            // Bob tries and fails to read Alice's message
            const bobsRead = await RecordsRead.create({
              recordId                    : chatRecordsWrite.message.recordId,
              authorizationSignatureInput : Jws.createSignatureInput(bob)
            });
            const readReply = await dwn.processMessage(alice.did, bobsRead.message);
            expect(readReply.status.code).to.equal(401);
            expect(readReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationActionNotAllowed);

            // Alice invites Bob to the groupChat
            const inviteRecordsWrite = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              recipient    : bob.did,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'groupChat/invite',
              schema       : protocolDefinition.types.invite.schema,
              dataFormat   : protocolDefinition.types.invite.dataFormats[0],
              data         : new TextEncoder().encode('Bob check out this groupchat'),
              parentId     : groupChatRecordsWrite.message.recordId,
              contextId    : groupChatRecordsWrite.message.contextId,
            });
            const inviteReply = await dwn.processMessage(alice.did, inviteRecordsWrite.message, inviteRecordsWrite.dataStream);
            expect(inviteReply.status.code).to.equal(202);

            // Bob is able to read messages from the groupChat
            const readReply2 = await dwn.processMessage(alice.did, bobsRead.message);
            expect(readReply2.status.code).to.equal(200);
          });

          xit('should allow read with `any` recipient rule', async () => {
            // scenario: Bob tries to read a chat message to Alice's DWN, but fails because Alice has not added him as a friend.
            //           Alice adds Bob as a friend, then Bob is able to read a chat message.

            const protocolDefinition = friendChatProtocol as ProtocolDefinition;

            const alice = await TestDataGenerator.generatePersona();
            const bob = await TestDataGenerator.generatePersona();

            // setting up a stub DID resolver
            TestStubGenerator.stubDidResolver(didResolver, [alice, bob]);

            // Install protocol
            const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
              author: alice,
              protocolDefinition
            });
            const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message, protocolsConfig.dataStream);
            expect(protocolWriteReply.status.code).to.equal(202);

            // Alice writes a `chat` record
            const chatRecordsWrite = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'chat',
              schema       : protocolDefinition.types.chat.schema,
              dataFormat   : protocolDefinition.types.chat.dataFormats![0],
              data         : new TextEncoder().encode('Blah blah blah'),
            });
            const chatReply = await dwn.processMessage(alice.did, chatRecordsWrite.message, chatRecordsWrite.dataStream);
            expect(chatReply.status.code).to.equal(202);

            // Bob tries and fails to read Alice's `chat`
            const bobsRead = await RecordsRead.create({
              recordId                    : chatRecordsWrite.message.recordId,
              authorizationSignatureInput : Jws.createSignatureInput(bob)
            });
            const readReply = await dwn.processMessage(alice.did, bobsRead.message);
            expect(readReply.status.code).to.equal(401);
            expect(readReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationActionNotAllowed);

            // Alice writes a `friend` record with Bob as recipient
            const addFriendRecordsWrite = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              recipient    : bob.did,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'friend',
              schema       : protocolDefinition.types.friend.schema,
              dataFormat   : protocolDefinition.types.friend.dataFormats![0],
              data         : new TextEncoder().encode('Adding Bob'),
            });
            const addFriendReply = await dwn.processMessage(alice.did, addFriendRecordsWrite.message, addFriendRecordsWrite.dataStream);
            expect(addFriendReply.status.code).to.equal(202);

            // Bob is able to read Alice's `chat`
            const readReply2 = await dwn.processMessage(alice.did, bobsRead.message);
            expect(readReply2.status.code).to.equal(200);
          });
        });

        describe('author action rules', () => {
          it('should allow read with ancestor author rule', async () => {
            // scenario: Bob sends an email to Alice, then Bob reads the email.
            //           ImposterBob tries and fails to read the email.
            const alice = await DidKeyResolver.generate();
            const bob = await DidKeyResolver.generate();
            const imposterBob = await DidKeyResolver.generate();

            const protocolDefinition = emailProtocolDefinition as ProtocolDefinition;

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
              dataFormat   : protocolDefinition.types.email.dataFormats![0],
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

          xit('should allow read with `context` author rule', async () => {
            // scenario: Alice starts a groupChat. Bob tries and fails to read a groupChat/chat.
            //           Bob joins the groupChat, then he is able to read a groupChat/chat.

            const protocolDefinition = publicChatProtocol as ProtocolDefinition;

            const alice = await TestDataGenerator.generatePersona();
            const bob = await TestDataGenerator.generatePersona();

            // setting up a stub DID resolver
            TestStubGenerator.stubDidResolver(didResolver, [alice, bob]);

            // Install protocol
            const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
              author: alice,
              protocolDefinition
            });
            const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message, protocolsConfig.dataStream);
            expect(protocolWriteReply.status.code).to.equal(202);

            // Alice starts a groupChat
            const groupChat = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'groupChat',
              schema       : protocolDefinition.types.groupChat.schema,
              dataFormat   : protocolDefinition.types.groupChat.dataFormats![0],
              data         : new TextEncoder().encode('New groupChat'),
            });
            const groupChatReply = await dwn.processMessage(alice.did, groupChat.message, groupChat.dataStream);
            expect(groupChatReply.status.code).to.equal(202);

            // Alice writes a message to the groupChat
            const groupChatMessage = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'groupChat/chat',
              schema       : protocolDefinition.types.chat.schema,
              dataFormat   : protocolDefinition.types.chat.dataFormats![0],
              data         : new TextEncoder().encode('Hello groupchat'),
              parentId     : groupChat.message.recordId,
              contextId    : groupChat.message.contextId,
            });
            const groupChatMessageReply = await dwn.processMessage(alice.did, groupChatMessage.message, groupChatMessage.dataStream);
            expect(groupChatMessageReply.status.code).to.equal(202);

            // Bob tries and fails to read Alice's message
            const bobsRead = await RecordsRead.create({
              recordId                    : groupChatMessage.message.recordId,
              authorizationSignatureInput : Jws.createSignatureInput(bob)
            });
            const readReply = await dwn.processMessage(alice.did, bobsRead.message);
            expect(readReply.status.code).to.equal(401);
            expect(readReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationActionNotAllowed);

            // Bob joins the groupChat by writing a groupChat/joinChat
            const bobsJoinChat = await TestDataGenerator.generateRecordsWrite({
              author       : bob,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'groupChat/joinChat',
              schema       : protocolDefinition.types.joinChat.schema,
              dataFormat   : protocolDefinition.types.joinChat.dataFormats![0],
              data         : new TextEncoder().encode('I try joining the chat first'),
              contextId    : groupChat.message.contextId,
              parentId     : groupChat.message.recordId,
            });
            const bobsJoinChatReply = await dwn.processMessage(alice.did, bobsJoinChat.message, bobsJoinChat.dataStream);
            expect(bobsJoinChatReply.status.code).to.equal(202);

            // Bob is able to read a groupChat/message
            const readReply2 = await dwn.processMessage(alice.did, bobsRead.message);
            expect(readReply2.status.code).to.equal(200);
          });

          xit('should allow read with `any` author rule', async () => {
            // scenario: Alice writes a `reward` to the contribution-reward protocol. Bob tries and fails to read the reward.
            //           He makes a contribution, then he is able to read the reward

            const protocolDefinition = contributionRewardProtocol as ProtocolDefinition;

            const alice = await TestDataGenerator.generatePersona();
            const bob = await TestDataGenerator.generatePersona();

            // setting up a stub DID resolver
            TestStubGenerator.stubDidResolver(didResolver, [alice, bob]);

            // Install protocol
            const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
              author: alice,
              protocolDefinition
            });
            const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message, protocolsConfig.dataStream);
            expect(protocolWriteReply.status.code).to.equal(202);

            // Alice starts a groupChat
            const reward = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'reward',
              schema       : protocolDefinition.types.reward.schema,
              dataFormat   : protocolDefinition.types.reward.dataFormats![0],
              data         : new TextEncoder().encode('New reward'),
            });
            const rewardReply = await dwn.processMessage(alice.did, reward.message, reward.dataStream);
            expect(rewardReply.status.code).to.equal(202);

            // Bob tries and fails to read the reward
            const bobsRead = await RecordsRead.create({
              recordId                    : reward.message.recordId,
              authorizationSignatureInput : Jws.createSignatureInput(bob)
            });
            const readReply = await dwn.processMessage(alice.did, bobsRead.message);
            expect(readReply.status.code).to.equal(401);
            expect(readReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationActionNotAllowed);

            // Bob makes a contribution
            const contribution = await TestDataGenerator.generateRecordsWrite({
              author       : bob,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'contribution',
              schema       : protocolDefinition.types.contribution.schema,
              dataFormat   : protocolDefinition.types.contribution.dataFormats![0],
              data         : new TextEncoder().encode('New contribution'),
            });
            const contributionReply = await dwn.processMessage(alice.did, contribution.message, contribution.dataStream);
            expect(contributionReply.status.code).to.equal(202);

            // Now bob is able to read the reward
            const readReply2 = await dwn.processMessage(alice.did, bobsRead.message);
            expect(readReply2.status.code).to.equal(200);
          });
        });


      });

      describe('grant based reads', () => {
        it('rejects with 401 an external party attempts to RecordReads if grant has different DWN method scope', async () => {
          // scenario: Alice grants Bob access to RecordsWrite, then Bob tries to invoke the grant with RecordsRead

          const alice = await DidKeyResolver.generate();
          const bob = await DidKeyResolver.generate();

          // Alice writes a record which Bob will later try to read
          const { recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite({
            author: alice,
          });
          const recordsWriteReply = await dwn.processMessage(alice.did, recordsWrite.message, dataStream);
          expect(recordsWriteReply.status.code).to.equal(202);

          // Alice gives Bob a PermissionsGrant with scope RecordsRead
          const permissionsGrant = await TestDataGenerator.generatePermissionsGrant({
            author     : alice,
            grantedBy  : alice.did,
            grantedFor : alice.did,
            grantedTo  : bob.did,
            scope      : {
              interface : DwnInterfaceName.Records,
              method    : DwnMethodName.Write,
            }
          });
          const permissionsGrantReply = await dwn.processMessage(alice.did, permissionsGrant.message);
          expect(permissionsGrantReply.status.code).to.equal(202);

          // Bob tries to RecordsRead
          const recordsRead = await RecordsRead.create({
            recordId                    : recordsWrite.message.recordId,
            authorizationSignatureInput : Jws.createSignatureInput(bob),
            permissionsGrantId          : await Message.getCid(permissionsGrant.message),
          });
          const recordsReadReply = await dwn.processMessage(alice.did, recordsRead.message);
          expect(recordsReadReply.status.code).to.equal(401);
          expect(recordsReadReply.status.detail).to.contain(DwnErrorCode.GrantAuthorizationMethodMismatch);
        });

        it('allows external parties to read a record using a grant with unrestricted RecordsRead scope', async () => {
          // scenario: Alice gives Bob a grant allowing him to read any record in her DWN.
          //           Bob invokes that grant to read a record.

          const alice = await DidKeyResolver.generate();
          const bob = await DidKeyResolver.generate();

          // Alice writes a record to her DWN
          const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({
            author: alice,
          });
          const writeReply = await dwn.processMessage(alice.did, message, dataStream);
          expect(writeReply.status.code).to.equal(202);

          // Alice issues a PermissionsGrant allowing Bob to read any record in her DWN
          const permissionsGrant = await TestDataGenerator.generatePermissionsGrant({
            author     : alice,
            grantedBy  : alice.did,
            grantedTo  : bob.did,
            grantedFor : alice.did,
            scope      : {
              interface : DwnInterfaceName.Records,
              method    : DwnMethodName.Read,
              // No futher restrictions on grant scope
            }
          });
          const grantReply = await dwn.processMessage(alice.did, permissionsGrant.message);
          expect(grantReply.status.code).to.equal(202);

          // Bob invokes that grant to read a record from Alice's DWN
          const recordsRead = await RecordsRead.create({
            recordId                    : message.recordId,
            authorizationSignatureInput : Jws.createSignatureInput(bob),
            permissionsGrantId          : await Message.getCid(permissionsGrant.message),
          });
          const readReply = await dwn.processMessage(alice.did, recordsRead.message);
          expect(readReply.status.code).to.equal(200);
        });

        describe('protocol records', () => {
          it('allows reads of protocol records with unrestricted grant scopes', async () => {
            // scenario: Alice writes a protocol record. Alice gives Bob a grant to read all records in her DWN
            //           Bob invokes that grant to read the protocol record.

            const alice = await DidKeyResolver.generate();
            const bob = await DidKeyResolver.generate();

            const protocolDefinition = minimalProtocolDefinition;

            // Alice installs the protocol
            const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
              author: alice,
              protocolDefinition
            });
            const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message, protocolsConfig.dataStream);
            expect(protocolWriteReply.status.code).to.equal(202);

            // Alice writes a record which Bob will later try to read
            const { recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'foo',
            });
            const recordsWriteReply = await dwn.processMessage(alice.did, recordsWrite.message, dataStream);
            expect(recordsWriteReply.status.code).to.equal(202);

            // Alice gives Bob a PermissionsGrant with scope RecordsRead
            const permissionsGrant = await TestDataGenerator.generatePermissionsGrant({
              author     : alice,
              grantedBy  : alice.did,
              grantedFor : alice.did,
              grantedTo  : bob.did,
              scope      : {
                interface : DwnInterfaceName.Records,
                method    : DwnMethodName.Read,
              }
            });
            const permissionsGrantReply = await dwn.processMessage(alice.did, permissionsGrant.message);
            expect(permissionsGrantReply.status.code).to.equal(202);

            // Bob is unable to read the record without using the PermissionsGrant
            const recordsReadWithoutGrant = await RecordsRead.create({
              recordId                    : recordsWrite.message.recordId,
              authorizationSignatureInput : Jws.createSignatureInput(bob),
            });
            const recordsReadWithoutGrantReply = await dwn.processMessage(alice.did, recordsReadWithoutGrant.message);
            expect(recordsReadWithoutGrantReply.status.code).to.equal(401);
            expect(recordsReadWithoutGrantReply.status.detail).to.contain('no action rule defined for Read');

            // Bob is able to read the record when he uses the PermissionsGrant
            const recordsReadWithGrant = await RecordsRead.create({
              recordId                    : recordsWrite.message.recordId,
              authorizationSignatureInput : Jws.createSignatureInput(bob),
              permissionsGrantId          : await Message.getCid(permissionsGrant.message),
            });
            const recordsReadWithGrantReply = await dwn.processMessage(alice.did, recordsReadWithGrant.message);
            expect(recordsReadWithGrantReply.status.code).to.equal(200);
          });

          it('allows reads of protocol records with matching protocol grant scopes', async () => {
            // scenario: Alice writes a protocol record. Alice gives Bob a grant to read all records in the protocol
            //           Bob invokes that grant to read the protocol record.

            const alice = await DidKeyResolver.generate();
            const bob = await DidKeyResolver.generate();

            const protocolDefinition = minimalProtocolDefinition;

            // Alice installs the protocol
            const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
              author: alice,
              protocolDefinition
            });
            const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message, protocolsConfig.dataStream);
            expect(protocolWriteReply.status.code).to.equal(202);

            // Alice writes a record which Bob will later try to read
            const { recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'foo',
            });
            const recordsWriteReply = await dwn.processMessage(alice.did, recordsWrite.message, dataStream);
            expect(recordsWriteReply.status.code).to.equal(202);

            // Alice gives Bob a PermissionsGrant with scope RecordsRead
            const permissionsGrant = await TestDataGenerator.generatePermissionsGrant({
              author     : alice,
              grantedBy  : alice.did,
              grantedFor : alice.did,
              grantedTo  : bob.did,
              scope      : {
                interface : DwnInterfaceName.Records,
                method    : DwnMethodName.Read,
                protocol  : protocolDefinition.protocol,
              }
            });
            const permissionsGrantReply = await dwn.processMessage(alice.did, permissionsGrant.message);
            expect(permissionsGrantReply.status.code).to.equal(202);

            // Bob is unable to read the record without using the PermissionsGrant
            const recordsReadWithoutGrant = await RecordsRead.create({
              recordId                    : recordsWrite.message.recordId,
              authorizationSignatureInput : Jws.createSignatureInput(bob),
            });
            const recordsReadWithoutGrantReply = await dwn.processMessage(alice.did, recordsReadWithoutGrant.message);
            expect(recordsReadWithoutGrantReply.status.code).to.equal(401);
            expect(recordsReadWithoutGrantReply.status.detail).to.contain('no action rule defined for Read');

            // Bob is able to read the record when he uses the PermissionsGrant
            const recordsReadWithGrant = await RecordsRead.create({
              recordId                    : recordsWrite.message.recordId,
              authorizationSignatureInput : Jws.createSignatureInput(bob),
              permissionsGrantId          : await Message.getCid(permissionsGrant.message),
            });
            const recordsReadWithGrantReply = await dwn.processMessage(alice.did, recordsReadWithGrant.message);
            expect(recordsReadWithGrantReply.status.code).to.equal(200);
          });

          it('rejects reads of protocol records with mismatching protocol grant scopes', async () => {
            // scenario: Alice writes a protocol record. Alice gives Bob a grant to read a different protocol
            //           Bob invokes that grant to read the protocol record, but fails.

            const alice = await DidKeyResolver.generate();
            const bob = await DidKeyResolver.generate();

            const protocolDefinition = minimalProtocolDefinition;

            // Alice installs the protocol
            const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
              author: alice,
              protocolDefinition
            });
            const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message, protocolsConfig.dataStream);
            expect(protocolWriteReply.status.code).to.equal(202);

            // Alice writes a record which Bob will later try to read
            const { recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'foo',
            });
            const recordsWriteReply = await dwn.processMessage(alice.did, recordsWrite.message, dataStream);
            expect(recordsWriteReply.status.code).to.equal(202);

            // Alice gives Bob a PermissionsGrant with scope RecordsRead
            const permissionsGrant = await TestDataGenerator.generatePermissionsGrant({
              author     : alice,
              grantedBy  : alice.did,
              grantedFor : alice.did,
              grantedTo  : bob.did,
              scope      : {
                interface : DwnInterfaceName.Records,
                method    : DwnMethodName.Read,
                protocol  : 'a-different-protocol'
              }
            });
            const permissionsGrantReply = await dwn.processMessage(alice.did, permissionsGrant.message);
            expect(permissionsGrantReply.status.code).to.equal(202);

            // Bob is unable to read the record using the mismatched PermissionsGrant
            const recordsReadWithoutGrant = await RecordsRead.create({
              recordId                    : recordsWrite.message.recordId,
              authorizationSignatureInput : Jws.createSignatureInput(bob),
              permissionsGrantId          : await Message.getCid(permissionsGrant.message),
            });
            const recordsReadWithoutGrantReply = await dwn.processMessage(alice.did, recordsReadWithoutGrant.message);
            expect(recordsReadWithoutGrantReply.status.code).to.equal(401);
            expect(recordsReadWithoutGrantReply.status.detail).to.contain(DwnErrorCode.RecordsGrantAuthorizationScopeProtocolMismatch);
          });

          it('rejects reads of protocol records with non-protocol grant scopes', async () => {
            // scenario: Alice writes a protocol record. Alice gives Bob a grant to read a records of a certain schema.
            //           Bob invokes that grant to read the protocol record, but fails.

            const alice = await DidKeyResolver.generate();
            const bob = await DidKeyResolver.generate();

            const protocolDefinition = minimalProtocolDefinition;

            // Alice installs the protocol
            const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
              author: alice,
              protocolDefinition
            });
            const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message, protocolsConfig.dataStream);
            expect(protocolWriteReply.status.code).to.equal(202);

            // Alice writes a record which Bob will later try to read
            const { recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'foo',
            });
            const recordsWriteReply = await dwn.processMessage(alice.did, recordsWrite.message, dataStream);
            expect(recordsWriteReply.status.code).to.equal(202);

            // Alice gives Bob a PermissionsGrant with scope RecordsRead
            const permissionsGrant = await TestDataGenerator.generatePermissionsGrant({
              author     : alice,
              grantedBy  : alice.did,
              grantedFor : alice.did,
              grantedTo  : bob.did,
              scope      : {
                interface : DwnInterfaceName.Records,
                method    : DwnMethodName.Read,
                schema    : 'some-schema'
              }
            });
            const permissionsGrantReply = await dwn.processMessage(alice.did, permissionsGrant.message);
            expect(permissionsGrantReply.status.code).to.equal(202);

            // Bob is unable to read the record using the mismatched PermissionsGrant
            const recordsReadWithoutGrant = await RecordsRead.create({
              recordId                    : recordsWrite.message.recordId,
              authorizationSignatureInput : Jws.createSignatureInput(bob),
              permissionsGrantId          : await Message.getCid(permissionsGrant.message),
            });
            const recordsReadWithoutGrantReply = await dwn.processMessage(alice.did, recordsReadWithoutGrant.message);
            expect(recordsReadWithoutGrantReply.status.code).to.equal(401);
            expect(recordsReadWithoutGrantReply.status.detail).to.contain(DwnErrorCode.RecordsGrantAuthorizationScopeNotProtocol);
          });

          it('allows reads of records in the contextId specified in the grant', async () => {
            // scenario: Alice grants Bob access to RecordsRead records with a specific contextId.
            //           Bob uses it to read a record in that context.
            const alice = await DidKeyResolver.generate();
            const bob = await DidKeyResolver.generate();

            const protocolDefinition = minimalProtocolDefinition;

            // Alice installs the protocol
            const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
              author: alice,
              protocolDefinition
            });
            const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message, protocolsConfig.dataStream);
            expect(protocolWriteReply.status.code).to.equal(202);

            // Alice writes a record which Bob will later try to read
            const { recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'foo',
            });
            const recordsWriteReply = await dwn.processMessage(alice.did, recordsWrite.message, dataStream);
            expect(recordsWriteReply.status.code).to.equal(202);

            // Alice gives Bob a PermissionsGrant with scope RecordsRead
            const permissionsGrant = await TestDataGenerator.generatePermissionsGrant({
              author     : alice,
              grantedBy  : alice.did,
              grantedFor : alice.did,
              grantedTo  : bob.did,
              scope      : {
                interface : DwnInterfaceName.Records,
                method    : DwnMethodName.Read,
                protocol  : protocolDefinition.protocol,
                contextId : recordsWrite.message.contextId,
              }
            });
            const permissionsGrantReply = await dwn.processMessage(alice.did, permissionsGrant.message);
            expect(permissionsGrantReply.status.code).to.equal(202);

            // Bob is unable to read the record using the mismatched PermissionsGrant
            const recordsReadWithoutGrant = await RecordsRead.create({
              recordId                    : recordsWrite.message.recordId,
              authorizationSignatureInput : Jws.createSignatureInput(bob),
              permissionsGrantId          : await Message.getCid(permissionsGrant.message),
            });
            const recordsReadWithoutGrantReply = await dwn.processMessage(alice.did, recordsReadWithoutGrant.message);
            expect(recordsReadWithoutGrantReply.status.code).to.equal(200);
          });

          it('rejects reads of records in a different contextId than is specified in the grant', async () => {
            // scenario: Alice grants Bob access to RecordsRead records with a specific contextId.
            //           Bob tries and fails to invoke the grant in order to read a record outside of the context.
            const alice = await DidKeyResolver.generate();
            const bob = await DidKeyResolver.generate();

            const protocolDefinition = minimalProtocolDefinition;

            // Alice installs the protocol
            const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
              author: alice,
              protocolDefinition
            });
            const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message, protocolsConfig.dataStream);
            expect(protocolWriteReply.status.code).to.equal(202);

            // Alice writes a record which Bob will later try to read
            const { recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'foo',
            });
            const recordsWriteReply = await dwn.processMessage(alice.did, recordsWrite.message, dataStream);
            expect(recordsWriteReply.status.code).to.equal(202);

            // Alice gives Bob a PermissionsGrant with scope RecordsRead
            const permissionsGrant = await TestDataGenerator.generatePermissionsGrant({
              author     : alice,
              grantedBy  : alice.did,
              grantedFor : alice.did,
              grantedTo  : bob.did,
              scope      : {
                interface : DwnInterfaceName.Records,
                method    : DwnMethodName.Read,
                protocol  : protocolDefinition.protocol,
                contextId : await TestDataGenerator.randomCborSha256Cid(), // different contextId than what Bob will try to read
              }
            });
            const permissionsGrantReply = await dwn.processMessage(alice.did, permissionsGrant.message);
            expect(permissionsGrantReply.status.code).to.equal(202);

            // Bob is unable to read the record using the mismatched PermissionsGrant
            const recordsReadWithoutGrant = await RecordsRead.create({
              recordId                    : recordsWrite.message.recordId,
              authorizationSignatureInput : Jws.createSignatureInput(bob),
              permissionsGrantId          : await Message.getCid(permissionsGrant.message),
            });
            const recordsReadWithoutGrantReply = await dwn.processMessage(alice.did, recordsReadWithoutGrant.message);
            expect(recordsReadWithoutGrantReply.status.code).to.equal(401);
            expect(recordsReadWithoutGrantReply.status.detail).to.contain(DwnErrorCode.RecordsGrantAuthorizationScopeContextIdMismatch);
          });

          it('allows reads of records in the protocolPath specified in the grant', async () => {
            // scenario: Alice grants Bob access to RecordsRead records with a specific protocolPath.
            //           Bob uses it to read a record in that protocolPath.
            const alice = await DidKeyResolver.generate();
            const bob = await DidKeyResolver.generate();

            const protocolDefinition = minimalProtocolDefinition;

            // Alice installs the protocol
            const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
              author: alice,
              protocolDefinition
            });
            const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message, protocolsConfig.dataStream);
            expect(protocolWriteReply.status.code).to.equal(202);

            // Alice writes a record which Bob will later try to read
            const { recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'foo',
            });
            const recordsWriteReply = await dwn.processMessage(alice.did, recordsWrite.message, dataStream);
            expect(recordsWriteReply.status.code).to.equal(202);

            // Alice gives Bob a PermissionsGrant with scope RecordsRead
            const permissionsGrant = await TestDataGenerator.generatePermissionsGrant({
              author     : alice,
              grantedBy  : alice.did,
              grantedFor : alice.did,
              grantedTo  : bob.did,
              scope      : {
                interface    : DwnInterfaceName.Records,
                method       : DwnMethodName.Read,
                protocol     : protocolDefinition.protocol,
                protocolPath : recordsWrite.message.descriptor.protocolPath,
              }
            });
            const permissionsGrantReply = await dwn.processMessage(alice.did, permissionsGrant.message);
            expect(permissionsGrantReply.status.code).to.equal(202);

            // Bob is unable to read the record using the mismatched PermissionsGrant
            const recordsReadWithoutGrant = await RecordsRead.create({
              recordId                    : recordsWrite.message.recordId,
              authorizationSignatureInput : Jws.createSignatureInput(bob),
              permissionsGrantId          : await Message.getCid(permissionsGrant.message),
            });
            const recordsReadWithoutGrantReply = await dwn.processMessage(alice.did, recordsReadWithoutGrant.message);
            expect(recordsReadWithoutGrantReply.status.code).to.equal(200);
          });

          it('rejects reads of records in a different protocolPath than is specified in the grant', async () => {
            // scenario: Alice grants Bob access to RecordsRead records with a specific protocolPath.
            //           Bob tries and fails to invoke the grant in order to read a record outside of the protocolPath.
            const alice = await DidKeyResolver.generate();
            const bob = await DidKeyResolver.generate();

            const protocolDefinition = minimalProtocolDefinition;

            // Alice installs the protocol
            const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
              author: alice,
              protocolDefinition
            });
            const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message, protocolsConfig.dataStream);
            expect(protocolWriteReply.status.code).to.equal(202);

            // Alice writes a record which Bob will later try to read
            const { recordsWrite, dataStream } = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'foo',
            });
            const recordsWriteReply = await dwn.processMessage(alice.did, recordsWrite.message, dataStream);
            expect(recordsWriteReply.status.code).to.equal(202);

            // Alice gives Bob a PermissionsGrant with scope RecordsRead
            const permissionsGrant = await TestDataGenerator.generatePermissionsGrant({
              author     : alice,
              grantedBy  : alice.did,
              grantedFor : alice.did,
              grantedTo  : bob.did,
              scope      : {
                interface    : DwnInterfaceName.Records,
                method       : DwnMethodName.Read,
                protocol     : protocolDefinition.protocol,
                protocolPath : 'different-protocol-path', // different protocol path than what Bob will try to read
              }
            });
            const permissionsGrantReply = await dwn.processMessage(alice.did, permissionsGrant.message);
            expect(permissionsGrantReply.status.code).to.equal(202);

            // Bob is unable to read the record using the mismatched PermissionsGrant
            const recordsReadWithoutGrant = await RecordsRead.create({
              recordId                    : recordsWrite.message.recordId,
              authorizationSignatureInput : Jws.createSignatureInput(bob),
              permissionsGrantId          : await Message.getCid(permissionsGrant.message),
            });
            const recordsReadWithoutGrantReply = await dwn.processMessage(alice.did, recordsReadWithoutGrant.message);
            expect(recordsReadWithoutGrantReply.status.code).to.equal(401);
            expect(recordsReadWithoutGrantReply.status.detail).to.contain(DwnErrorCode.RecordsGrantAuthorizationScopeProtocolPathMismatch);
          });
        });

        describe('grant scope schema', () => {
          it('allows access if the RecordsRead grant scope schema includes the schema of the record', async () => {
            // scenario: Alice gives Bob a grant allowing him to read records with matching schema in her DWN.
            //           Bob invokes that grant to read a record.

            const alice = await DidKeyResolver.generate();
            const bob = await DidKeyResolver.generate();

            // Alice writes a record to her DWN
            const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({
              author : alice,
              schema : 'some-schema',
            });
            const writeReply = await dwn.processMessage(alice.did, message, dataStream);
            expect(writeReply.status.code).to.equal(202);

            // Alice issues a PermissionsGrant allowing Bob to read a specific recordId
            const permissionsGrant = await TestDataGenerator.generatePermissionsGrant({
              author     : alice,
              grantedBy  : alice.did,
              grantedTo  : bob.did,
              grantedFor : alice.did,
              scope      : {
                interface : DwnInterfaceName.Records,
                method    : DwnMethodName.Read,
                schema    : message.descriptor.schema
              }
            });
            const grantReply = await dwn.processMessage(alice.did, permissionsGrant.message);
            expect(grantReply.status.code).to.equal(202);

            // Bob invokes that grant to read a record from Alice's DWN
            const recordsRead = await RecordsRead.create({
              recordId                    : message.recordId,
              authorizationSignatureInput : Jws.createSignatureInput(bob),
              permissionsGrantId          : await Message.getCid(permissionsGrant.message),
            });
            const readReply = await dwn.processMessage(alice.did, recordsRead.message);
            expect(readReply.status.code).to.equal(200);
          });

          it('rejects with 401 if the RecordsRead grant scope schema does not have the same schema as the record', async () => {
            // scenario: Alice gives Bob a grant allowing him to read records with matching schema in her DWN.
            //           Bob invokes that grant to read a different record and is rejected.

            const alice = await DidKeyResolver.generate();
            const bob = await DidKeyResolver.generate();

            // Alice writes a record to her DWN
            const recordSchema = 'record-schema';
            const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({
              author : alice,
              schema : recordSchema,
            });
            const writeReply = await dwn.processMessage(alice.did, message, dataStream);
            expect(writeReply.status.code).to.equal(202);

            // Alice issues a PermissionsGrant allowing Bob to read a specific recordId
            const scopeSchema = 'scope-schema';
            const permissionsGrant = await TestDataGenerator.generatePermissionsGrant({
              author     : alice,
              grantedBy  : alice.did,
              grantedTo  : bob.did,
              grantedFor : alice.did,
              scope      : {
                interface : DwnInterfaceName.Records,
                method    : DwnMethodName.Read,
                schema    : scopeSchema // different schema than the record Bob will try to read
              }
            });
            const grantReply = await dwn.processMessage(alice.did, permissionsGrant.message);
            expect(grantReply.status.code).to.equal(202);

            // Bob invokes that grant to read a record from Alice's DWN
            const recordsRead = await RecordsRead.create({
              recordId                    : message.recordId,
              authorizationSignatureInput : Jws.createSignatureInput(bob),
              permissionsGrantId          : await Message.getCid(permissionsGrant.message),
            });
            const readReply = await dwn.processMessage(alice.did, recordsRead.message);
            expect(readReply.status.code).to.equal(401);
            expect(readReply.status.detail).to.include(DwnErrorCode.RecordsGrantAuthorizationScopeSchema);
          });
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

      it('should return 404 underlying data store cannot locate the data when data is above threshold', async () => {
        const alice = await DidKeyResolver.generate();

        sinon.stub(dataStore, 'get').resolves(undefined);

        // insert data larger than the allowed amount in encodedData
        const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({
          author : alice,
          data   : TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded +1)
        });
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

      describe('data from encodedData', () => {
        it('should not get data from DataStore if encodedData exists', async () => {
          const alice = await DidKeyResolver.generate();

          //since the data is at the threshold it will be returned from the messageStore in the `encodedData` field.
          const { message, dataStream, dataBytes } = await TestDataGenerator.generateRecordsWrite({
            author : alice,
            data   : TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded)
          });

          const writeReply = await dwn.processMessage(alice.did, message, dataStream);
          expect(writeReply.status.code).to.equal(202);

          const recordRead = await RecordsRead.create({
            recordId                    : message.recordId,
            authorizationSignatureInput : Jws.createSignatureInput(alice)
          });

          const dataStoreGet = sinon.spy(dataStore, 'get');

          const recordsReadResponse = await dwn.handleRecordsRead(alice.did, recordRead.message);
          expect(recordsReadResponse.status.code).to.equal(200);
          expect(recordsReadResponse.record).to.exist;
          expect(recordsReadResponse.record!.data).to.exist;
          sinon.assert.notCalled(dataStoreGet);

          const readData = await DataStream.toBytes(recordsReadResponse.record!.data);
          expect(readData).to.eql(dataBytes);
        });
        it('should get data from DataStore if encodedData does not exist', async () => {
          const alice = await DidKeyResolver.generate();

          //since the data is over the threshold it will not be returned from the messageStore in the `encodedData` field.
          const { message, dataStream, dataBytes } = await TestDataGenerator.generateRecordsWrite({
            author : alice,
            data   : TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded +1)
          });

          const writeReply = await dwn.processMessage(alice.did, message, dataStream);
          expect(writeReply.status.code).to.equal(202);

          const recordRead = await RecordsRead.create({
            recordId                    : message.recordId,
            authorizationSignatureInput : Jws.createSignatureInput(alice)
          });

          const dataStoreGet = sinon.spy(dataStore, 'get');

          const recordsReadResponse = await dwn.handleRecordsRead(alice.did, recordRead.message);
          expect(recordsReadResponse.status.code).to.equal(200);
          expect(recordsReadResponse.record).to.exist;
          expect(recordsReadResponse.record!.data).to.exist;
          sinon.assert.calledOnce(dataStoreGet);

          const readData = await DataStream.toBytes(recordsReadResponse.record!.data);
          expect(readData).to.eql(dataBytes);
        });
      });

      describe('encryption scenarios', () => {
        it('should be able to decrypt flat-space schema-contained record with a correct derived key', async () => {
        // scenario: Alice writes into her own DWN an encrypted record and she is able to decrypt it

          const alice = await TestDataGenerator.generatePersona();
          TestStubGenerator.stubDidResolver(didResolver, [alice]);

          // encrypt Alice's record
          const originalData = TestDataGenerator.randomBytes(1000);
          const originalDataStream = DataStream.fromBytes(originalData);
          const dataEncryptionInitializationVector = TestDataGenerator.randomBytes(16);
          const dataEncryptionKey = TestDataGenerator.randomBytes(32);
          const encryptedDataStream = await Encryption.aes256CtrEncrypt(dataEncryptionKey, dataEncryptionInitializationVector, originalDataStream);
          const encryptedDataBytes = await DataStream.toBytes(encryptedDataStream);


          // TODO: #450 - Should not require a root key to specify the derivation scheme (https://github.com/TBD54566975/dwn-sdk-js/issues/450)
          const rootPrivateKeyWithSchemasScheme: DerivedPrivateJwk = {
            rootKeyId         : alice.keyId,
            derivationScheme  : KeyDerivationScheme.Schemas,
            derivedPrivateKey : alice.keyPair.privateJwk
          };

          const schema = 'https://some-schema.com';
          const schemaDerivationPath = Records.constructKeyDerivationPathUsingSchemasScheme(schema);
          const schemaDerivedPrivateKey = await HdKey.derivePrivateKey(rootPrivateKeyWithSchemasScheme, schemaDerivationPath);
          const schemaDerivedPublicKey = await Secp256k1.getPublicJwk(schemaDerivedPrivateKey.derivedPrivateKey);

          const rootPrivateKeyWithDataFormatsScheme: DerivedPrivateJwk = {
            rootKeyId         : alice.keyId,
            derivationScheme  : KeyDerivationScheme.DataFormats,
            derivedPrivateKey : alice.keyPair.privateJwk
          };

          const dataFormat = 'some/format';
          const dataFormatDerivationPath = Records.constructKeyDerivationPathUsingDataFormatsScheme(schema, dataFormat);
          const dataFormatDerivedPublicKey = await HdKey.derivePublicKey(rootPrivateKeyWithDataFormatsScheme, dataFormatDerivationPath);

          const encryptionInput: EncryptionInput = {
            initializationVector : dataEncryptionInitializationVector,
            key                  : dataEncryptionKey,
            keyEncryptionInputs  : [{
              publicKeyId      : alice.keyId, // reusing signing key for encryption purely as a convenience
              publicKey        : schemaDerivedPublicKey,
              derivationScheme : KeyDerivationScheme.Schemas
            },
            {
              publicKeyId      : alice.keyId, // reusing signing key for encryption purely as a convenience
              publicKey        : dataFormatDerivedPublicKey,
              derivationScheme : KeyDerivationScheme.DataFormats
            }]
          };

          const { message, dataStream } = await TestDataGenerator.generateRecordsWrite({
            author : alice,
            schema,
            dataFormat,
            data   : encryptedDataBytes,
            encryptionInput
          });

          const writeReply = await dwn.processMessage(alice.did, message, dataStream);
          expect(writeReply.status.code).to.equal(202);

          const recordsRead = await RecordsRead.create({
            recordId                    : message.recordId,
            authorizationSignatureInput : Jws.createSignatureInput(alice)
          });

          // test able to derive correct key using `schemas` scheme from root key to decrypt the message
          const readReply = await dwn.handleRecordsRead(alice.did, recordsRead.message);
          expect(readReply.status.code).to.equal(200);
          const unsignedRecordsWrite = readReply.record!;
          const cipherStream = readReply.record!.data;

          const plaintextDataStream = await Records.decrypt(unsignedRecordsWrite, schemaDerivedPrivateKey, cipherStream);
          const plaintextBytes = await DataStream.toBytes(plaintextDataStream);
          expect(ArrayUtility.byteArraysEqual(plaintextBytes, originalData)).to.be.true;


          // test able to derive correct key using `dataFormat` scheme from root key to decrypt the message
          const readReply2 = await dwn.handleRecordsRead(alice.did, recordsRead.message); // send the same read message to get a new cipher stream
          expect(readReply2.status.code).to.equal(200);
          const cipherStream2 = readReply2.record!.data;

          const plaintextDataStream2 = await Records.decrypt(unsignedRecordsWrite, rootPrivateKeyWithDataFormatsScheme, cipherStream2);
          const plaintextBytes2 = await DataStream.toBytes(plaintextDataStream2);
          expect(ArrayUtility.byteArraysEqual(plaintextBytes2, originalData)).to.be.true;


          // test unable to decrypt the message if dataFormat-derived key is derived without taking `schema` as input to derivation path
          const readReply3 = await dwn.handleRecordsRead(alice.did, recordsRead.message); // process the same read message to get a new cipher stream
          expect(readReply3.status.code).to.equal(200);
          const cipherStream3 = readReply3.record!.data;

          const invalidDerivationPath = [KeyDerivationScheme.DataFormats, message.descriptor.dataFormat];
          const inValidDescendantPrivateKey: DerivedPrivateJwk
            = await HdKey.derivePrivateKey(rootPrivateKeyWithDataFormatsScheme, invalidDerivationPath);

          await expect(Records.decrypt(unsignedRecordsWrite, inValidDescendantPrivateKey, cipherStream3)).to.be.rejectedWith(
            DwnErrorCode.RecordsInvalidAncestorKeyDerivationSegment
          );
        });

        it('should be able to decrypt flat-space schema-less record with the correct derived key', async () => {
          // scenario: Alice writes into her own DWN an encrypted record and she is able to decrypt it

          const alice = await TestDataGenerator.generatePersona();
          TestStubGenerator.stubDidResolver(didResolver, [alice]);

          // encrypt Alice's record
          const originalData = TestDataGenerator.randomBytes(1000);
          const originalDataStream = DataStream.fromBytes(originalData);
          const dataEncryptionInitializationVector = TestDataGenerator.randomBytes(16);
          const dataEncryptionKey = TestDataGenerator.randomBytes(32);
          const encryptedDataStream = await Encryption.aes256CtrEncrypt(dataEncryptionKey, dataEncryptionInitializationVector, originalDataStream);
          const encryptedDataBytes = await DataStream.toBytes(encryptedDataStream);

          // TODO: #450 - Should not require a root key to specify the derivation scheme (https://github.com/TBD54566975/dwn-sdk-js/issues/450)
          const rootPrivateKeyWithDataFormatsScheme: DerivedPrivateJwk = {
            rootKeyId         : alice.keyId,
            derivationScheme  : KeyDerivationScheme.DataFormats,
            derivedPrivateKey : alice.keyPair.privateJwk
          };

          const dataFormat = `image/jpg`;
          const dataFormatDerivationPath = Records.constructKeyDerivationPathUsingDataFormatsScheme(undefined, dataFormat);
          const dataFormatDerivedPublicKey = await HdKey.derivePublicKey(rootPrivateKeyWithDataFormatsScheme, dataFormatDerivationPath);

          const encryptionInput: EncryptionInput = {
            initializationVector : dataEncryptionInitializationVector,
            key                  : dataEncryptionKey,
            keyEncryptionInputs  : [{
              publicKeyId      : alice.keyId, // reusing signing key for encryption purely as a convenience
              publicKey        : dataFormatDerivedPublicKey,
              derivationScheme : KeyDerivationScheme.DataFormats
            }]
          };

          const recordsWrite = await RecordsWrite.create({
            authorizationSignatureInput : Jws.createSignatureInput(alice),
            dataFormat,
            data                        : encryptedDataBytes,
            encryptionInput
          });

          const dataStream = DataStream.fromBytes(encryptedDataBytes);
          const writeReply = await dwn.processMessage(alice.did, recordsWrite.message, dataStream);
          expect(writeReply.status.code).to.equal(202);

          const recordsRead = await RecordsRead.create({
            recordId                    : recordsWrite.message.recordId,
            authorizationSignatureInput : Jws.createSignatureInput(alice)
          });


          // test able to derive correct key using `dataFormat` scheme from root key to decrypt the message
          const readReply = await dwn.handleRecordsRead(alice.did, recordsRead.message); // send the same read message to get a new cipher stream
          expect(readReply.status.code).to.equal(200);
          const cipherStream = readReply.record!.data;
          const unsignedRecordsWrite = readReply.record!;

          const plaintextDataStream = await Records.decrypt(unsignedRecordsWrite, rootPrivateKeyWithDataFormatsScheme, cipherStream);
          const plaintextBytes = await DataStream.toBytes(plaintextDataStream);
          expect(ArrayUtility.byteArraysEqual(plaintextBytes, originalData)).to.be.true;
        });

        it('should only be able to decrypt record with a correct derived private key  - `protocol-context` derivation scheme', async () => {
          // scenario: Bob initiated an encrypted chat thread with Alice,
          // bob is able to decrypt subsequent messages from Alice using the `protocol-context` derived private key

          // creating Alice and Bob persona and setting up a stub DID resolver
          const alice = await TestDataGenerator.generatePersona();
          const bob = await TestDataGenerator.generatePersona();
          TestStubGenerator.stubDidResolver(didResolver, [alice, bob]);

          // Alice configures chat protocol with encryption
          const protocolDefinition: ProtocolDefinition = chatProtocolDefinition as ProtocolDefinition;

          const encryptedProtocolDefinitionForAlice
                      = await Protocols.deriveAndInjectPublicEncryptionKeys(protocolDefinition, alice.keyId, alice.keyPair.privateJwk);
          const protocolsConfigureForAlice = await TestDataGenerator.generateProtocolsConfigure({
            author             : alice,
            protocolDefinition : encryptedProtocolDefinitionForAlice
          });

          const protocolsConfigureForAliceReply = await dwn.processMessage(
            alice.did,
            protocolsConfigureForAlice.message,
            protocolsConfigureForAlice.dataStream
          );
          expect(protocolsConfigureForAliceReply.status.code).to.equal(202);

          // Bob configures chat protocol with encryption
          const encryptedProtocolDefinitionForBob
          = await Protocols.deriveAndInjectPublicEncryptionKeys(protocolDefinition, bob.keyId, bob.keyPair.privateJwk);
          const protocolsConfigureForBob = await TestDataGenerator.generateProtocolsConfigure({
            author             : bob,
            protocolDefinition : encryptedProtocolDefinitionForBob
          });

          const protocolsConfigureReply = await dwn.processMessage(bob.did, protocolsConfigureForBob.message, protocolsConfigureForBob.dataStream);
          expect(protocolsConfigureReply.status.code).to.equal(202);

          // Bob queries for Alice's chat protocol definition
          const protocolsQuery = await ProtocolsQuery.create({
            filter: { protocol: chatProtocolDefinition.protocol }
          });
          const protocolsQueryReply = await dwn.processMessage(alice.did, protocolsQuery.message);
          const protocolsConfigureMessageReceived = protocolsQueryReply.entries![0] as ProtocolsConfigureMessage;

          // Bob verifies that the chat protocol definition is authored by Alice
          await authenticate(protocolsConfigureMessageReceived.authorization, didResolver);
          const protocolsConfigureFetched = await ProtocolsConfigure.parse(protocolsConfigureMessageReceived);
          expect(protocolsConfigureFetched.author).to.equal(alice.did);

          // Bob creates an initiating a chat thread RecordsWrite
          const plaintextMessageToAlice = TestDataGenerator.randomBytes(100);
          const { message, dataStream, recordsWrite, encryptedDataBytes, encryptionInput } =
          await TestDataGenerator.generateProtocolEncryptedRecordsWrite({
            plaintextBytes           : plaintextMessageToAlice,
            author                   : bob,
            targetProtocolDefinition : protocolsConfigureForAlice.message.descriptor.definition,
            protocolPath             : 'thread'
          });

          // Bob writes the encrypted chat thread to Alice's DWN
          const bobToAliceWriteReply = await dwn.processMessage(alice.did, message, dataStream);
          expect(bobToAliceWriteReply.status.code).to.equal(202);

          // Bob also needs to write the same encrypted chat thread to his own DWN
          // Opportunity here to create a much nicer utility method for this entire block
          const bobToBobRecordsWrite = await RecordsWrite.createFrom({
            unsignedRecordsWriteMessage : recordsWrite.message,
            messageTimestamp            : recordsWrite.message.descriptor.messageTimestamp
          });

          const bobRootPrivateKey: DerivedPrivateJwk = {
            rootKeyId         : bob.keyId,
            derivationScheme  : KeyDerivationScheme.ProtocolContext,
            derivedPrivateKey : bob.keyPair.privateJwk
          };

          const protocolPathDerivationPath = Records.constructKeyDerivationPathUsingProtocolPathScheme(recordsWrite.message.descriptor);
          const protocolPathDerivedPublicJwkForBobsDwn = await HdKey.derivePublicKey(bobRootPrivateKey, protocolPathDerivationPath);
          const protocolPathDerivedKeyEncryptionInputForBobsDwn = {
            publicKeyId      : bob.keyId, // reusing signing key for encryption purely as a convenience
            publicKey        : protocolPathDerivedPublicJwkForBobsDwn,
            derivationScheme : KeyDerivationScheme.ProtocolPath
          };

          const encryptionInputForBobsDwn: EncryptionInput = encryptionInput;
          const indexOfKeyEncryptionInputToReplace
            = encryptionInputForBobsDwn.keyEncryptionInputs.findIndex(input => input.derivationScheme === KeyDerivationScheme.ProtocolPath);
          encryptionInputForBobsDwn.keyEncryptionInputs[indexOfKeyEncryptionInputToReplace] = protocolPathDerivedKeyEncryptionInputForBobsDwn;

          await bobToBobRecordsWrite.encryptSymmetricEncryptionKey(encryptionInputForBobsDwn);
          await bobToBobRecordsWrite.sign(Jws.createSignatureInput(bob));

          const dataStreamForBobsDwn = DataStream.fromBytes(encryptedDataBytes);
          const bobToBobWriteReply = await dwn.processMessage(bob.did, bobToBobRecordsWrite.message, dataStreamForBobsDwn);
          expect(bobToBobWriteReply.status.code).to.equal(202);

          // NOTE: we know Alice is able to decrypt the message using protocol-path derived key through other tests, so we won't verify it again

          // test that anyone with the protocol-context derived private key is able to decrypt the message
          const recordsRead = await RecordsRead.create({
            recordId                    : message.recordId,
            authorizationSignatureInput : Jws.createSignatureInput(alice)
          });
          const readReply = await dwn.handleRecordsRead(alice.did, recordsRead.message);
          expect(readReply.status.code).to.equal(200);

          const unsignedRecordsWrite = readReply.record!;
          const cipherStream = readReply.record!.data;

          const derivationPathFromReadContext = Records.constructKeyDerivationPathUsingProtocolContextScheme(unsignedRecordsWrite.contextId);
          const protocolContextDerivedPrivateJwk = await HdKey.derivePrivateKey(bobRootPrivateKey, derivationPathFromReadContext);
          const plaintextDataStream = await Records.decrypt(unsignedRecordsWrite, protocolContextDerivedPrivateJwk, cipherStream);
          const plaintextBytes = await DataStream.toBytes(plaintextDataStream);
          expect(ArrayUtility.byteArraysEqual(plaintextBytes, plaintextMessageToAlice)).to.be.true;

          // verify that Alice is able to send an encrypted message using the protocol-context derived public key and Bob is able to decrypt it
          // NOTE: we will skip verification of Bob's protocol configuration because we have test the such scenario above as well as in other tests
          const { derivedPublicKey: protocolContextDerivedPublicJwkReturned, rootKeyId: protocolContextDerivingRootKeyIdReturned }
            = unsignedRecordsWrite.encryption!.keyEncryption.find(
              encryptedKey => encryptedKey.derivationScheme === KeyDerivationScheme.ProtocolContext
            )!;

          const plaintextMessageToBob = TestDataGenerator.randomBytes(100);
          const recordsWriteToBob = await TestDataGenerator.generateProtocolEncryptedRecordsWrite({
            plaintextBytes                   : plaintextMessageToBob,
            author                           : alice,
            targetProtocolDefinition         : protocolsConfigureForBob.message.descriptor.definition,
            protocolPath                     : 'thread/message',
            protocolContextId                : unsignedRecordsWrite.contextId,
            protocolContextDerivingRootKeyId : protocolContextDerivingRootKeyIdReturned,
            protocolContextDerivedPublicJwk  : protocolContextDerivedPublicJwkReturned!,
            protocolParentId                 : unsignedRecordsWrite.recordId
          });

          // Alice sends the message to Bob
          const aliceWriteReply = await dwn.processMessage(bob.did, recordsWriteToBob.message, recordsWriteToBob.dataStream);
          expect(aliceWriteReply.status.code).to.equal(202);

          // test that Bob is able to read and decrypt Alice's message
          const recordsReadByBob = await RecordsRead.create({
            recordId                    : recordsWriteToBob.message.recordId,
            authorizationSignatureInput : Jws.createSignatureInput(bob)
          });
          const readByBobReply = await dwn.handleRecordsRead(bob.did, recordsReadByBob.message);
          expect(readByBobReply.status.code).to.equal(200);

          const unsignedRecordsWrite2 = readByBobReply.record!;
          const cipherStream2 = readByBobReply.record!.data;

          const plaintextDataStream2 = await Records.decrypt(unsignedRecordsWrite2, protocolContextDerivedPrivateJwk, cipherStream2);
          const plaintextBytes2 = await DataStream.toBytes(plaintextDataStream2);
          expect(ArrayUtility.byteArraysEqual(plaintextBytes2, plaintextMessageToBob)).to.be.true;
        });

        it('should only be able to decrypt record with a correct derived private key  - `protocols` derivation scheme', async () => {
          // scenario: Bob writes into Alice's DWN an encrypted "email", alice is able to decrypt it

          // creating Alice and Bob persona and setting up a stub DID resolver
          const alice = await TestDataGenerator.generatePersona();
          const bob = await TestDataGenerator.generatePersona();
          TestStubGenerator.stubDidResolver(didResolver, [alice, bob]);

          // Alice configures email protocol with encryption
          const protocolDefinition: ProtocolDefinition = emailProtocolDefinition as ProtocolDefinition;
          const encryptedProtocolDefinition
            = await Protocols.deriveAndInjectPublicEncryptionKeys(protocolDefinition, alice.keyId, alice.keyPair.privateJwk);
          const protocolsConfigure = await TestDataGenerator.generateProtocolsConfigure({
            author             : alice,
            protocolDefinition : encryptedProtocolDefinition
          });

          const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfigure.message, protocolsConfigure.dataStream);
          expect(protocolsConfigureReply.status.code).to.equal(202);

          // Bob queries for Alice's email protocol definition
          const protocolsQuery = await ProtocolsQuery.create({
            filter: { protocol: emailProtocolDefinition.protocol }
          });
          const protocolsQueryReply = await dwn.processMessage(alice.did, protocolsQuery.message);
          const protocolsConfigureMessageReceived = protocolsQueryReply.entries![0] as ProtocolsConfigureMessage;

          // Bob verifies that the email protocol definition is authored by Alice
          await authenticate(protocolsConfigureMessageReceived.authorization, didResolver);
          const protocolsConfigureFetched = await ProtocolsConfigure.parse(protocolsConfigureMessageReceived);
          expect(protocolsConfigureFetched.author).to.equal(alice.did);

          // Bob encrypts his email to Alice with a randomly generated symmetric key
          const bobMessageBytes = TestDataGenerator.randomBytes(100);
          const bobMessageStream = DataStream.fromBytes(bobMessageBytes);
          const dataEncryptionInitializationVector = TestDataGenerator.randomBytes(16);
          const dataEncryptionKey = TestDataGenerator.randomBytes(32);
          const bobMessageEncryptedStream = await Encryption.aes256CtrEncrypt(
            dataEncryptionKey, dataEncryptionInitializationVector, bobMessageStream
          );
          const bobMessageEncryptedBytes = await DataStream.toBytes(bobMessageEncryptedStream);

          // Bob generates an encrypted RecordsWrite,
          // the public encryption key designated by Alice is used to encrypt the symmetric key Bob generated above
          const publicJwk = protocolsConfigureFetched.message.descriptor.definition.structure.email.$encryption?.publicKeyJwk;
          expect(publicJwk).to.not.be.undefined;
          const encryptionInput: EncryptionInput = {
            initializationVector : dataEncryptionInitializationVector,
            key                  : dataEncryptionKey,
            keyEncryptionInputs  : [{
              publicKeyId      : alice.keyId, // reusing signing key for encryption purely as a convenience
              publicKey        : publicJwk!,
              derivationScheme : KeyDerivationScheme.ProtocolPath
            }]
          };

          const { message, dataStream } = await TestDataGenerator.generateRecordsWrite(
            {
              author       : bob,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'email', // this comes from `types` in protocol definition
              schema       : protocolDefinition.types.email.schema,
              dataFormat   : protocolDefinition.types.email.dataFormats![0],
              data         : bobMessageEncryptedBytes,
              encryptionInput
            }
          );

          // Bob writes the encrypted email to Alice's DWN
          const bobWriteReply = await dwn.processMessage(alice.did, message, dataStream);
          expect(bobWriteReply.status.code).to.equal(202);

          // Alice reads the encrypted email
          // assume Alice already made query to get the `recordId` of the email
          const recordsRead = await RecordsRead.create({
            recordId                    : message.recordId,
            authorizationSignatureInput : Jws.createSignatureInput(alice)
          });
          const readReply = await dwn.handleRecordsRead(alice.did, recordsRead.message);
          expect(readReply.status.code).to.equal(200);

          // test that Alice is able decrypt the encrypted email from Bob using the root key
          const rootPrivateKey: DerivedPrivateJwk = {
            rootKeyId         : alice.keyId,
            derivationScheme  : KeyDerivationScheme.ProtocolPath,
            derivedPrivateKey : alice.keyPair.privateJwk
          };

          const unsignedRecordsWrite = readReply.record!;
          const cipherStream = readReply.record!.data;

          const plaintextDataStream = await Records.decrypt(unsignedRecordsWrite, rootPrivateKey, cipherStream);
          const plaintextBytes = await DataStream.toBytes(plaintextDataStream);
          expect(ArrayUtility.byteArraysEqual(plaintextBytes, bobMessageBytes)).to.be.true;

          // test that a correct derived key is able decrypt the encrypted email from Bob
          const readReply2 = await dwn.handleRecordsRead(alice.did, recordsRead.message);
          expect(readReply2.status.code).to.equal(200);

          const relativeDescendantDerivationPath = Records.constructKeyDerivationPath(KeyDerivationScheme.ProtocolPath, unsignedRecordsWrite);
          const derivedPrivateKey: DerivedPrivateJwk = await HdKey.derivePrivateKey(rootPrivateKey, relativeDescendantDerivationPath);

          const unsignedRecordsWrite2 = readReply2.record!;
          const cipherStream2 = readReply2.record!.data;
          const plaintextDataStream2 = await Records.decrypt(unsignedRecordsWrite2, derivedPrivateKey, cipherStream2);
          const plaintextBytes2 = await DataStream.toBytes(plaintextDataStream2);
          expect(ArrayUtility.byteArraysEqual(plaintextBytes2, bobMessageBytes)).to.be.true;

          // test unable to decrypt the message if derived key has an unexpected path
          const invalidDerivationPath = [KeyDerivationScheme.ProtocolPath, protocolDefinition.protocol, 'invalidContextId'];
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
            derivationScheme  : KeyDerivationScheme.ProtocolPath,
            derivedPrivateKey : alice.keyPair.privateJwk
          };
          await expect(Records.decrypt(unsignedRecordsWrite, privateKeyWithMismatchingKeyId, cipherStream)).to.be.rejectedWith(
            DwnErrorCode.RecordsDecryptNoMatchingKeyEncryptedFound
          );
        });
      });
    });

    it('should not allow read without `recordId` or `protocol` and `protocolPath` to be set', async () => {
      const alice = await DidKeyResolver.generate();

      // create with recordId to avoid the failure here
      const recordsRead = await RecordsRead.create({
        recordId: 'recordId',
      });

      // delete recordId to induce the failure on the handler
      delete recordsRead.message.descriptor.recordId;

      const recordsReadHandler = new RecordsReadHandler(didResolver, messageStore, dataStore);
      const readReply = await recordsReadHandler.handle({ tenant: alice.did, message: recordsRead.message });
      expect(readReply.status.code).to.equal(400);
      expect(readReply.status.detail).to.contain(DwnErrorCode.RecordsReadMissingDescriptorProperties);
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
}
