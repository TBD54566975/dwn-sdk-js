import type { DerivedPrivateJwk } from '../../src/utils/hd-key.js';
import type { EncryptionInput } from '../../src/interfaces/records-write.js';
import type { DataStore, EventLog, MessageStore, ProtocolDefinition, ProtocolsConfigureMessage } from '../../src/index.js';

import { DwnConstant, Message } from '../../src/index.js';
import { DwnInterfaceName, DwnMethodName } from '../../src/index.js';

import chaiAsPromised from 'chai-as-promised';
import chatProtocolDefinition from '../vectors/protocol-definitions/chat.json' assert { type: 'json' };
import emailProtocolDefinition from '../vectors/protocol-definitions/email.json' assert { type: 'json' };
import friendRoleProtocolDefinition from '../vectors/protocol-definitions/friend-role.json' assert { type: 'json' };
import minimalProtocolDefinition from '../vectors/protocol-definitions/minimal.json' assert { type: 'json' };
import nestedProtocol from '../vectors/protocol-definitions/nested.json' assert { type: 'json' };
import sinon from 'sinon';
import socialMediaProtocolDefinition from '../vectors/protocol-definitions/social-media.json' assert { type: 'json' };
import threadRoleProtocolDefinition from '../vectors/protocol-definitions/thread-role.json' assert { type: 'json' };

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
          filter: {
            recordId: message.recordId,
          },
          authorizationSigner: Jws.createSigner(alice)
        });

        const readReply = await dwn.processMessage(alice.did, recordsRead.message);
        expect(readReply.status.code).to.equal(200);
        expect(readReply.record).to.exist;
        expect(readReply.record?.authorization).to.deep.equal(message.authorization);
        expect(readReply.record?.descriptor).to.deep.equal(message.descriptor);

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
          filter: {
            recordId: message.recordId,
          },
          authorizationSigner: Jws.createSigner(bob)
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
          filter: {
            recordId: message.recordId
          }
        });
        expect(recordsRead.author).to.be.undefined; // making sure no author/authorization is created

        const readReply = await dwn.processMessage(alice.did, recordsRead.message);
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
          filter: {
            recordId: message.recordId,
          },
          authorizationSigner: Jws.createSigner(bob)
        });

        const readReply = await dwn.processMessage(alice.did, recordsRead.message);
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
          filter: {
            recordId: message.recordId,
          },
          authorizationSigner: Jws.createSigner(bob)
        });

        const readReply = await dwn.processMessage(alice.did, recordsRead.message);
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
          const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message);
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
            filter: {
              recordId: imageRecordsWrite.message.recordId,
            },
            authorizationSigner: Jws.createSigner(bob)
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
          const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message);
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
            filter: {
              recordId: recordsWrite.message.recordId,
            }
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
            const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message);
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
              filter: {
                recordId: emailRecordsWrite.message.recordId,
              },
              authorizationSigner: Jws.createSigner(bob)
            });
            const bobReadReply = await dwn.processMessage(alice.did, bobRecordsRead.message);
            expect(bobReadReply.status.code).to.equal(200);

            // ImposterBob is not able to read Alice's email
            const imposterRecordsRead = await RecordsRead.create({
              filter: {
                recordId: emailRecordsWrite.message.recordId,
              },
              authorizationSigner: Jws.createSigner(imposterBob)
            });
            const imposterReadReply = await dwn.processMessage(alice.did, imposterRecordsRead.message);
            expect(imposterReadReply.status.code).to.equal(401);
            expect(imposterReadReply.status.detail).to.include(DwnErrorCode.ProtocolAuthorizationActionNotAllowed);
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
            const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message);
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
              filter: {
                recordId: emailRecordsWrite.message.recordId,
              },
              authorizationSigner: Jws.createSigner(bob)
            });
            const bobReadReply = await dwn.processMessage(alice.did, bobRecordsRead.message);
            expect(bobReadReply.status.code).to.equal(200);

            // ImposterBob is not able to read the email
            const imposterRecordsRead = await RecordsRead.create({
              filter: {
                recordId: emailRecordsWrite.message.recordId,
              },
              authorizationSigner: Jws.createSigner(imposterBob)
            });
            const imposterReadReply = await dwn.processMessage(alice.did, imposterRecordsRead.message);
            expect(imposterReadReply.status.code).to.equal(401);
            expect(imposterReadReply.status.detail).to.include(DwnErrorCode.ProtocolAuthorizationActionNotAllowed);
          });
        });

        describe('filter based reads', () => {
          it('should return a filter based read if there is only a single result', async () => {
            const alice = await DidKeyResolver.generate();

            const protocolDefinition = { ...nestedProtocol };
            const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
              author: alice,
              protocolDefinition
            });
            const protocolConfigReply = await dwn.processMessage(alice.did, protocolsConfig.message);
            expect(protocolConfigReply.status.code).to.equal(202);

            const foo1Write = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'foo',
              schema       : protocolDefinition.types.foo.schema,
              dataFormat   : protocolDefinition.types.foo.dataFormats![0],
              data         : new TextEncoder().encode('foo'),
              recipient    : alice.did
            });
            const foo1WriteReply = await dwn.processMessage(alice.did, foo1Write.message, foo1Write.dataStream);
            expect(foo1WriteReply.status.code).to.equal(202);

            const fooPathRead = await RecordsRead.create({
              filter: {
                protocol     : protocolDefinition.protocol,
                protocolPath : 'foo',
              },
              authorizationSigner: Jws.createSigner(alice),
            });

            const fooPathReply = await dwn.processMessage(alice.did, fooPathRead.message);
            expect(fooPathReply.status.code).to.equal(200);
            expect(fooPathReply.record!.recordId).to.equal(foo1Write.message.recordId);
          });

          it('should throw if requested filter has more than a single result', async () => {
            const alice = await DidKeyResolver.generate();

            const protocolDefinition = { ...nestedProtocol };
            const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
              author: alice,
              protocolDefinition
            });
            const protocolConfigReply = await dwn.processMessage(alice.did, protocolsConfig.message);
            expect(protocolConfigReply.status.code).to.equal(202);

            const foo1Write = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'foo',
              schema       : protocolDefinition.types.foo.schema,
              dataFormat   : protocolDefinition.types.foo.dataFormats![0],
              data         : new TextEncoder().encode('foo'),
              recipient    : alice.did
            });
            const foo1WriteReply = await dwn.processMessage(alice.did, foo1Write.message, foo1Write.dataStream);
            expect(foo1WriteReply.status.code).to.equal(202);

            const foo2Write = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'foo',
              schema       : protocolDefinition.types.foo.schema,
              dataFormat   : protocolDefinition.types.foo.dataFormats![0],
              data         : new TextEncoder().encode('foo'),
              recipient    : alice.did
            });
            const foo2WriteReply = await dwn.processMessage(alice.did, foo2Write.message, foo2Write.dataStream);
            expect(foo2WriteReply.status.code).to.equal(202);

            // Since there are two 'foo' records, this should fail.
            const fooPathRead = await RecordsRead.create({
              filter: {
                protocol     : protocolDefinition.protocol,
                protocolPath : 'foo',
              },
              authorizationSigner: Jws.createSigner(alice),
            });
            const fooPathReply = await dwn.processMessage(alice.did, fooPathRead.message);
            expect(fooPathReply.status.code).to.equal(400);
            expect(fooPathReply.status.detail).to.contain(DwnErrorCode.RecordsReadReturnedMultiple);
          });
        });

        describe('protocolRole based reads', () => {
          it('uses a globalRole to authorize a read', async () => {
            // scenario: Alice writes a chat message writes a chat message. Bob invokes his
            //           friend role in order to read the chat message.

            const alice = await DidKeyResolver.generate();
            const bob = await DidKeyResolver.generate();

            const protocolDefinition = friendRoleProtocolDefinition;

            const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
              author: alice,
              protocolDefinition
            });
            const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message);
            expect(protocolWriteReply.status.code).to.equal(202);

            // Alice writes a 'friend' $globalRole record with Bob as recipient
            const friendRoleRecord = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              recipient    : bob.did,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'friend',
              data         : new TextEncoder().encode('Bob is my friend'),
            });
            const friendRoleReply = await dwn.processMessage(alice.did, friendRoleRecord.message, friendRoleRecord.dataStream);
            expect(friendRoleReply.status.code).to.equal(202);

            // Alice writes a 'chat' record
            const chatRecord = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              recipient    : alice.did,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'chat',
              data         : new TextEncoder().encode('Bob can read this cuz he is my friend'),
            });
            const chatReply = await dwn.processMessage(alice.did, chatRecord.message, chatRecord.dataStream);
            expect(chatReply.status.code).to.equal(202);

            // Bob reads Alice's chat record
            const readChatRecord = await RecordsRead.create({
              authorizationSigner : Jws.createSigner(bob),
              filter              : {
                recordId: chatRecord.message.recordId,

              },
              protocolRole: 'friend'
            });
            const chatReadReply = await dwn.processMessage(alice.did, readChatRecord.message);
            expect(chatReadReply.status.code).to.equal(200);
          });

          it('rejects globalRole-authorized reads if the protocolRole is not a valid protocol path to a role record', async () => {
            // scenario: Alice writes a chat message writes a chat message. Bob tries to invoke the 'chat' role,
            //           but 'chat' is not a role.

            const alice = await DidKeyResolver.generate();
            const bob = await DidKeyResolver.generate();

            const protocolDefinition = friendRoleProtocolDefinition;

            const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
              author: alice,
              protocolDefinition
            });
            const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message);
            expect(protocolWriteReply.status.code).to.equal(202);

            // Alice writes a 'chat' record
            const chatRecord = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              recipient    : alice.did,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'chat',
              data         : new TextEncoder().encode('Blah blah blah'),
            });
            const chatReply = await dwn.processMessage(alice.did, chatRecord.message, chatRecord.dataStream);
            expect(chatReply.status.code).to.equal(202);

            // Bob tries to invoke a 'chat' role but 'chat' is not a role
            const readChatRecord = await RecordsRead.create({
              authorizationSigner : Jws.createSigner(bob),
              filter              : {
                recordId: chatRecord.message.recordId,
              },
              protocolRole: 'chat'
            });
            const chatReadReply = await dwn.processMessage(alice.did, readChatRecord.message);
            expect(chatReadReply.status.code).to.equal(401);
            expect(chatReadReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationNotARole);
          });

          it('rejects globalRole-authorized reads if there is no active role for the recipient', async () => {
            // scenario: Alice writes a chat message writes a chat message. Bob tries to invoke a role,
            //           but he has not been given one.

            const alice = await DidKeyResolver.generate();
            const bob = await DidKeyResolver.generate();

            const protocolDefinition = friendRoleProtocolDefinition;

            const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
              author: alice,
              protocolDefinition
            });
            const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message);
            expect(protocolWriteReply.status.code).to.equal(202);

            // Alice writes a 'chat' record
            const chatRecord = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              recipient    : alice.did,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'chat',
              data         : new TextEncoder().encode('Blah blah blah'),
            });
            const chatReply = await dwn.processMessage(alice.did, chatRecord.message, chatRecord.dataStream);
            expect(chatReply.status.code).to.equal(202);

            // Bob tries to invoke a 'friend' role but he is not a 'friend'
            const readChatRecord = await RecordsRead.create({
              authorizationSigner : Jws.createSigner(bob),
              filter              : {
                recordId: chatRecord.message.recordId,
              },
              protocolRole: 'friend',
            });
            const chatReadReply = await dwn.processMessage(alice.did, readChatRecord.message);
            expect(chatReadReply.status.code).to.equal(401);
            expect(chatReadReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationMissingRole);
          });

          it('uses a contextRole to authorize a read', async () => {
            // scenario: Alice creates a thread and adds Bob to the 'thread/participant' role. Alice writes a chat message.
            //           Bob invokes the record to read in the chat message.

            const alice = await DidKeyResolver.generate();
            const bob = await DidKeyResolver.generate();

            const protocolDefinition = threadRoleProtocolDefinition;

            const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
              author: alice,
              protocolDefinition
            });
            const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message);
            expect(protocolWriteReply.status.code).to.equal(202);

            // Alice creates a thread
            const threadRecord = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              recipient    : bob.did,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'thread'
            });
            const threadRecordReply = await dwn.processMessage(alice.did, threadRecord.message, threadRecord.dataStream);
            expect(threadRecordReply.status.code).to.equal(202);

            // Alice adds Bob as a 'thread/participant' in that thread
            const participantRecord = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              recipient    : bob.did,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'thread/participant',
              contextId    : threadRecord.message.contextId,
              parentId     : threadRecord.message.recordId,
            });
            const participantRecordReply = await dwn.processMessage(alice.did, participantRecord.message, participantRecord.dataStream);
            expect(participantRecordReply.status.code).to.equal(202);

            // Alice writes a chat message in the thread
            const chatRecord = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'thread/chat',
              contextId    : threadRecord.message.contextId,
              parentId     : threadRecord.message.recordId,
            });
            const chatRecordReply = await dwn.processMessage(alice.did, chatRecord.message, chatRecord.dataStream);
            expect(chatRecordReply.status.code).to.equal(202);

            // Bob is able to read his own 'participant' role
            // He doesn't need to invoke the role because recipients of a record are always authorized to read it
            const participantRead = await RecordsRead.create({
              authorizationSigner : Jws.createSigner(bob),
              filter              : {
                protocolPath : 'thread/participant',
                recipient    : bob.did,
                contextId    : threadRecord.message.contextId
              },
            });
            const participantReadReply = await dwn.processMessage(alice.did, participantRead.message);
            expect(participantReadReply.status.code).to.equal(200);

            // Bob is able to read the thread root record
            const threadRead = await RecordsRead.create({
              authorizationSigner : Jws.createSigner(bob),
              filter              : {
                recordId: participantReadReply.record!.descriptor.parentId,
              },
              protocolRole: 'thread/participant'
            });
            const threadReadReply = await dwn.processMessage(alice.did, threadRead.message);
            expect(threadReadReply.status.code).to.equal(200);

            // Bob invokes his 'participant' role to read the chat message
            const chatRead = await RecordsRead.create({
              authorizationSigner : Jws.createSigner(bob),
              filter              : {
                recordId: chatRecord.message.recordId,
              },
              protocolRole: 'thread/participant'
            });
            const chatReadReply = await dwn.processMessage(alice.did, chatRead.message);
            expect(chatReadReply.status.code).to.equal(200);
          });

          it('rejects contextRole-authorized read if there is no active role in that context for the recipient', async () => {
            // scenario: Alice creates a thread and adds Bob as a participant. ALice creates another thread. Bob tries and fails to invoke his
            //           contextRole to write a chat in the second thread

            const alice = await DidKeyResolver.generate();
            const bob = await DidKeyResolver.generate();

            const protocolDefinition = threadRoleProtocolDefinition;

            const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
              author: alice,
              protocolDefinition
            });
            const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message);
            expect(protocolWriteReply.status.code).to.equal(202);

            // Alice creates a thread
            const threadRecord1 = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              recipient    : bob.did,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'thread'
            });
            const threadRecordReply1 = await dwn.processMessage(alice.did, threadRecord1.message, threadRecord1.dataStream);
            expect(threadRecordReply1.status.code).to.equal(202);

            // Alice adds Bob as a 'thread/participant' in that thread
            const participantRecord = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              recipient    : bob.did,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'thread/participant',
              contextId    : threadRecord1.message.contextId,
              parentId     : threadRecord1.message.recordId,
            });
            const participantRecordReply = await dwn.processMessage(alice.did, participantRecord.message, participantRecord.dataStream);
            expect(participantRecordReply.status.code).to.equal(202);

            // Alice creates a second thread
            const threadRecord2 = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              recipient    : bob.did,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'thread'
            });
            const threadRecordReply2 = await dwn.processMessage(alice.did, threadRecord2.message, threadRecord2.dataStream);
            expect(threadRecordReply2.status.code).to.equal(202);

            // Alice writes a chat message in the thread
            const chatRecord = await TestDataGenerator.generateRecordsWrite({
              author       : alice,
              protocol     : protocolDefinition.protocol,
              protocolPath : 'thread/chat',
              contextId    : threadRecord2.message.contextId,
              parentId     : threadRecord2.message.recordId,
            });
            const chatRecordReply = await dwn.processMessage(alice.did, chatRecord.message, chatRecord.dataStream);
            expect(chatRecordReply.status.code).to.equal(202);

            // Bob invokes his 'participant' role to read the chat message
            const chatRead = await RecordsRead.create({
              authorizationSigner : Jws.createSigner(bob),
              filter              : {
                recordId: chatRecord.message.recordId,
              },
              protocolRole: 'thread/participant'
            });
            const chatReadReply = await dwn.processMessage(alice.did, chatRead.message);
            expect(chatReadReply.status.code).to.equal(401);
            expect(chatReadReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationMissingRole);
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
            filter: {
              recordId: recordsWrite.message.recordId,
            },
            authorizationSigner : Jws.createSigner(bob),
            permissionsGrantId  : await Message.getCid(permissionsGrant.message),
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
            filter: {
              recordId: message.recordId,
            },
            authorizationSigner : Jws.createSigner(bob),
            permissionsGrantId  : await Message.getCid(permissionsGrant.message),
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
            const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message);
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
              filter: {

                recordId: recordsWrite.message.recordId,
              },
              authorizationSigner: Jws.createSigner(bob),
            });
            const recordsReadWithoutGrantReply = await dwn.processMessage(alice.did, recordsReadWithoutGrant.message);
            expect(recordsReadWithoutGrantReply.status.code).to.equal(401);
            expect(recordsReadWithoutGrantReply.status.detail).to.contain('no action rule defined for Read');

            // Bob is able to read the record when he uses the PermissionsGrant
            const recordsReadWithGrant = await RecordsRead.create({
              filter: {
                recordId: recordsWrite.message.recordId,
              },
              authorizationSigner : Jws.createSigner(bob),
              permissionsGrantId  : await Message.getCid(permissionsGrant.message),
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
            const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message);
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
              filter: {
                recordId: recordsWrite.message.recordId,
              },
              authorizationSigner: Jws.createSigner(bob),
            });
            const recordsReadWithoutGrantReply = await dwn.processMessage(alice.did, recordsReadWithoutGrant.message);
            expect(recordsReadWithoutGrantReply.status.code).to.equal(401);
            expect(recordsReadWithoutGrantReply.status.detail).to.contain('no action rule defined for Read');

            // Bob is able to read the record when he uses the PermissionsGrant
            const recordsReadWithGrant = await RecordsRead.create({
              filter: {
                recordId: recordsWrite.message.recordId,
              },
              authorizationSigner : Jws.createSigner(bob),
              permissionsGrantId  : await Message.getCid(permissionsGrant.message),
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
            const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message);
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
              filter: {
                recordId: recordsWrite.message.recordId,
              },
              authorizationSigner : Jws.createSigner(bob),
              permissionsGrantId  : await Message.getCid(permissionsGrant.message),
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
            const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message);
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
              filter: {
                recordId: recordsWrite.message.recordId,
              },
              authorizationSigner : Jws.createSigner(bob),
              permissionsGrantId  : await Message.getCid(permissionsGrant.message),
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
            const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message);
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
              filter: {
                recordId: recordsWrite.message.recordId,
              },
              authorizationSigner : Jws.createSigner(bob),
              permissionsGrantId  : await Message.getCid(permissionsGrant.message),
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
            const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message);
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
              filter: {
                recordId: recordsWrite.message.recordId,
              },
              authorizationSigner : Jws.createSigner(bob),
              permissionsGrantId  : await Message.getCid(permissionsGrant.message),
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
            const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message);
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
              filter: {
                recordId: recordsWrite.message.recordId,
              },
              authorizationSigner : Jws.createSigner(bob),
              permissionsGrantId  : await Message.getCid(permissionsGrant.message),
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
            const protocolWriteReply = await dwn.processMessage(alice.did, protocolsConfig.message);
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
              filter: {
                recordId: recordsWrite.message.recordId,
              },
              authorizationSigner : Jws.createSigner(bob),
              permissionsGrantId  : await Message.getCid(permissionsGrant.message),
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
              filter: {
                recordId: message.recordId,
              },
              authorizationSigner : Jws.createSigner(bob),
              permissionsGrantId  : await Message.getCid(permissionsGrant.message),
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
              filter: {
                recordId: message.recordId,
              },
              authorizationSigner : Jws.createSigner(bob),
              permissionsGrantId  : await Message.getCid(permissionsGrant.message),
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
          filter: {
            recordId: `non-existent-record-id`,
          },
          authorizationSigner: Jws.createSigner(alice)
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
          recordId            : message.recordId,
          authorizationSigner : Jws.createSigner(alice)
        });

        const deleteReply = await dwn.processMessage(alice.did, recordsDelete.message);
        expect(deleteReply.status.code).to.equal(202);

        // RecordsRead
        const recordsRead = await RecordsRead.create({
          filter: {
            recordId: message.recordId,
          },
          authorizationSigner: Jws.createSigner(alice)
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
          filter: {
            recordId: message.recordId,
          },
          authorizationSigner: Jws.createSigner(alice)
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
            filter: {
              recordId: message.recordId,
            },
            authorizationSigner: Jws.createSigner(alice)
          });

          const dataStoreGet = sinon.spy(dataStore, 'get');

          const recordsReadResponse = await dwn.processMessage(alice.did, recordRead.message);
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
            filter: {
              recordId: message.recordId,
            },
            authorizationSigner: Jws.createSigner(alice)
          });

          const dataStoreGet = sinon.spy(dataStore, 'get');

          const recordsReadResponse = await dwn.processMessage(alice.did, recordRead.message);
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
            filter: {
              recordId: message.recordId,
            },
            authorizationSigner: Jws.createSigner(alice)
          });

          // test able to derive correct key using `schemas` scheme from root key to decrypt the message
          const readReply = await dwn.processMessage(alice.did, recordsRead.message);
          expect(readReply.status.code).to.equal(200);
          const recordsWriteMessage = readReply.record!;
          const cipherStream = readReply.record!.data;

          const plaintextDataStream = await Records.decrypt(recordsWriteMessage, schemaDerivedPrivateKey, cipherStream);
          const plaintextBytes = await DataStream.toBytes(plaintextDataStream);
          expect(ArrayUtility.byteArraysEqual(plaintextBytes, originalData)).to.be.true;


          // test able to derive correct key using `dataFormat` scheme from root key to decrypt the message
          const readReply2 = await dwn.processMessage(alice.did, recordsRead.message); // send the same read message to get a new cipher stream
          expect(readReply2.status.code).to.equal(200);
          const cipherStream2 = readReply2.record!.data;

          const plaintextDataStream2 = await Records.decrypt(recordsWriteMessage, rootPrivateKeyWithDataFormatsScheme, cipherStream2);
          const plaintextBytes2 = await DataStream.toBytes(plaintextDataStream2);
          expect(ArrayUtility.byteArraysEqual(plaintextBytes2, originalData)).to.be.true;


          // test unable to decrypt the message if dataFormat-derived key is derived without taking `schema` as input to derivation path
          const readReply3 = await dwn.processMessage(alice.did, recordsRead.message); // process the same read message to get a new cipher stream
          expect(readReply3.status.code).to.equal(200);
          const cipherStream3 = readReply3.record!.data;

          const invalidDerivationPath = [KeyDerivationScheme.DataFormats, message.descriptor.dataFormat];
          const inValidDescendantPrivateKey: DerivedPrivateJwk
            = await HdKey.derivePrivateKey(rootPrivateKeyWithDataFormatsScheme, invalidDerivationPath);

          await expect(Records.decrypt(recordsWriteMessage, inValidDescendantPrivateKey, cipherStream3)).to.be.rejectedWith(
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
            signer : Jws.createSigner(alice),
            dataFormat,
            data   : encryptedDataBytes,
            encryptionInput
          });

          const dataStream = DataStream.fromBytes(encryptedDataBytes);
          const writeReply = await dwn.processMessage(alice.did, recordsWrite.message, dataStream);
          expect(writeReply.status.code).to.equal(202);

          const recordsRead = await RecordsRead.create({
            filter: {
              recordId: recordsWrite.message.recordId,
            },
            authorizationSigner: Jws.createSigner(alice)
          });


          // test able to derive correct key using `dataFormat` scheme from root key to decrypt the message
          const readReply = await dwn.processMessage(alice.did, recordsRead.message); // send the same read message to get a new cipher stream
          expect(readReply.status.code).to.equal(200);
          const cipherStream = readReply.record!.data;
          const recordsWriteMessage = readReply.record!;

          const plaintextDataStream = await Records.decrypt(recordsWriteMessage, rootPrivateKeyWithDataFormatsScheme, cipherStream);
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

          const protocolDefinitionForAlice
                      = await Protocols.deriveAndInjectPublicEncryptionKeys(protocolDefinition, alice.keyId, alice.keyPair.privateJwk);
          const protocolsConfigureForAlice = await TestDataGenerator.generateProtocolsConfigure({
            author             : alice,
            protocolDefinition : protocolDefinitionForAlice
          });

          const protocolsConfigureForAliceReply = await dwn.processMessage(
            alice.did,
            protocolsConfigureForAlice.message
          );
          expect(protocolsConfigureForAliceReply.status.code).to.equal(202);

          // Bob configures chat protocol with encryption
          const protocolDefinitionForBob
          = await Protocols.deriveAndInjectPublicEncryptionKeys(protocolDefinition, bob.keyId, bob.keyPair.privateJwk);
          const protocolsConfigureForBob = await TestDataGenerator.generateProtocolsConfigure({
            author             : bob,
            protocolDefinition : protocolDefinitionForBob
          });

          const protocolsConfigureReply = await dwn.processMessage(bob.did, protocolsConfigureForBob.message);
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
            plaintextBytes                                   : plaintextMessageToAlice,
            author                                           : bob,
            protocolDefinition                               : protocolsConfigureForAlice.message.descriptor.definition,
            protocolPath                                     : 'thread',
            encryptSymmetricKeyWithProtocolPathDerivedKey    : true,
            encryptSymmetricKeyWithProtocolContextDerivedKey : true
          });

          // Bob writes the encrypted chat thread to Alice's DWN
          const bobToAliceWriteReply = await dwn.processMessage(alice.did, message, dataStream);
          expect(bobToAliceWriteReply.status.code).to.equal(202);

          // Bob also needs to write the same encrypted chat thread to his own DWN
          // Opportunity here to create a much nicer utility method for this entire block
          const bobToBobRecordsWrite = await RecordsWrite.createFrom({
            recordsWriteMessage : recordsWrite.message,
            messageTimestamp    : recordsWrite.message.descriptor.messageTimestamp
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
          await bobToBobRecordsWrite.sign({ signer: Jws.createSigner(bob) });

          const dataStreamForBobsDwn = DataStream.fromBytes(encryptedDataBytes);
          const bobToBobWriteReply = await dwn.processMessage(bob.did, bobToBobRecordsWrite.message, dataStreamForBobsDwn);
          expect(bobToBobWriteReply.status.code).to.equal(202);

          // NOTE: we know Alice is able to decrypt the message using protocol-path derived key through other tests, so we won't verify it again

          // test that anyone with the protocol-context derived private key is able to decrypt the message
          const recordsRead = await RecordsRead.create({
            filter: {
              recordId: message.recordId,
            },
            authorizationSigner: Jws.createSigner(alice)
          });
          const readReply = await dwn.processMessage(alice.did, recordsRead.message);
          expect(readReply.status.code).to.equal(200);

          const fetchedRecordsWrite = readReply.record!;
          const cipherStream = readReply.record!.data;

          const derivationPathFromReadContext = Records.constructKeyDerivationPathUsingProtocolContextScheme(fetchedRecordsWrite.contextId);
          const protocolContextDerivedPrivateJwk = await HdKey.derivePrivateKey(bobRootPrivateKey, derivationPathFromReadContext);
          const plaintextDataStream = await Records.decrypt(fetchedRecordsWrite, protocolContextDerivedPrivateJwk, cipherStream);
          const plaintextBytes = await DataStream.toBytes(plaintextDataStream);
          expect(ArrayUtility.byteArraysEqual(plaintextBytes, plaintextMessageToAlice)).to.be.true;

          // verify that Alice is able to send an encrypted message using the protocol-context derived public key and Bob is able to decrypt it
          // NOTE: we will skip verification of Bob's protocol configuration because we have test the such scenario above as well as in other tests
          const { derivedPublicKey: protocolContextDerivedPublicJwkReturned, rootKeyId: protocolContextDerivingRootKeyIdReturned }
            = fetchedRecordsWrite.encryption!.keyEncryption.find(
              encryptedKey => encryptedKey.derivationScheme === KeyDerivationScheme.ProtocolContext
            )!;

          const plaintextMessageToBob = TestDataGenerator.randomBytes(100);
          const recordsWriteToBob = await TestDataGenerator.generateProtocolEncryptedRecordsWrite({
            plaintextBytes                                   : plaintextMessageToBob,
            author                                           : alice,
            protocolDefinition                               : protocolsConfigureForBob.message.descriptor.definition,
            protocolPath                                     : 'thread/message',
            protocolContextId                                : fetchedRecordsWrite.contextId,
            protocolContextDerivingRootKeyId                 : protocolContextDerivingRootKeyIdReturned,
            protocolContextDerivedPublicJwk                  : protocolContextDerivedPublicJwkReturned!,
            protocolParentId                                 : fetchedRecordsWrite.recordId,
            encryptSymmetricKeyWithProtocolPathDerivedKey    : true,
            encryptSymmetricKeyWithProtocolContextDerivedKey : true
          });

          // Alice sends the message to Bob
          const aliceWriteReply = await dwn.processMessage(bob.did, recordsWriteToBob.message, recordsWriteToBob.dataStream);
          expect(aliceWriteReply.status.code).to.equal(202);

          // test that Bob is able to read and decrypt Alice's message
          const recordsReadByBob = await RecordsRead.create({
            filter: {
              recordId: recordsWriteToBob.message.recordId,
            },
            authorizationSigner: Jws.createSigner(bob)
          });
          const readByBobReply = await dwn.processMessage(bob.did, recordsReadByBob.message);
          expect(readByBobReply.status.code).to.equal(200);

          const fetchedRecordsWrite2 = readByBobReply.record!;
          const cipherStream2 = readByBobReply.record!.data;

          const plaintextDataStream2 = await Records.decrypt(fetchedRecordsWrite2, protocolContextDerivedPrivateJwk, cipherStream2);
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

          const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfigure.message);
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
            filter: {
              recordId: message.recordId,
            },
            authorizationSigner: Jws.createSigner(alice)
          });
          const readReply = await dwn.processMessage(alice.did, recordsRead.message);
          expect(readReply.status.code).to.equal(200);

          // test that Alice is able decrypt the encrypted email from Bob using the root key
          const rootPrivateKey: DerivedPrivateJwk = {
            rootKeyId         : alice.keyId,
            derivationScheme  : KeyDerivationScheme.ProtocolPath,
            derivedPrivateKey : alice.keyPair.privateJwk
          };

          const fetchedRecordsWrite = readReply.record!;
          const cipherStream = readReply.record!.data;

          const plaintextDataStream = await Records.decrypt(fetchedRecordsWrite, rootPrivateKey, cipherStream);
          const plaintextBytes = await DataStream.toBytes(plaintextDataStream);
          expect(ArrayUtility.byteArraysEqual(plaintextBytes, bobMessageBytes)).to.be.true;

          // test that a correct derived key is able decrypt the encrypted email from Bob
          const readReply2 = await dwn.processMessage(alice.did, recordsRead.message);
          expect(readReply2.status.code).to.equal(200);

          const relativeDescendantDerivationPath = Records.constructKeyDerivationPath(KeyDerivationScheme.ProtocolPath, fetchedRecordsWrite);
          const derivedPrivateKey: DerivedPrivateJwk = await HdKey.derivePrivateKey(rootPrivateKey, relativeDescendantDerivationPath);

          const fetchedRecordsWrite2 = readReply2.record!;
          const cipherStream2 = readReply2.record!.data;
          const plaintextDataStream2 = await Records.decrypt(fetchedRecordsWrite2, derivedPrivateKey, cipherStream2);
          const plaintextBytes2 = await DataStream.toBytes(plaintextDataStream2);
          expect(ArrayUtility.byteArraysEqual(plaintextBytes2, bobMessageBytes)).to.be.true;

          // test unable to decrypt the message if derived key has an unexpected path
          const invalidDerivationPath = [KeyDerivationScheme.ProtocolPath, protocolDefinition.protocol, 'invalidContextId'];
          const inValidDescendantPrivateKey: DerivedPrivateJwk = await HdKey.derivePrivateKey(rootPrivateKey, invalidDerivationPath);
          await expect(Records.decrypt(fetchedRecordsWrite, inValidDescendantPrivateKey, cipherStream)).to.be.rejectedWith(
            DwnErrorCode.RecordsInvalidAncestorKeyDerivationSegment
          );

          // test unable to decrypt the message if no derivation scheme used by the message matches the scheme used by the given private key
          const privateKeyWithMismatchingDerivationScheme: DerivedPrivateJwk = {
            rootKeyId         : alice.keyId,
            derivationScheme  : 'scheme-that-is-not-protocol-context' as any,
            derivedPrivateKey : alice.keyPair.privateJwk
          };
          await expect(Records.decrypt(fetchedRecordsWrite, privateKeyWithMismatchingDerivationScheme, cipherStream)).to.be.rejectedWith(
            DwnErrorCode.RecordsDecryptNoMatchingKeyEncryptedFound
          );

          // test unable to decrypt the message if public key ID does not match the derived private key
          const privateKeyWithMismatchingKeyId: DerivedPrivateJwk = {
            rootKeyId         : 'mismatchingKeyId',
            derivationScheme  : KeyDerivationScheme.ProtocolPath,
            derivedPrivateKey : alice.keyPair.privateJwk
          };
          await expect(Records.decrypt(fetchedRecordsWrite, privateKeyWithMismatchingKeyId, cipherStream)).to.be.rejectedWith(
            DwnErrorCode.RecordsDecryptNoMatchingKeyEncryptedFound
          );
        });
      });
    });

    it('should return 401 if signature check fails', async () => {
      const alice = await DidKeyResolver.generate();
      const recordsRead = await RecordsRead.create({
        filter: {
          recordId: 'any-id',
        },
        authorizationSigner: Jws.createSigner(alice)
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
        filter: {
          recordId: 'any-id',
        },
        authorizationSigner: Jws.createSigner(alice)
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
