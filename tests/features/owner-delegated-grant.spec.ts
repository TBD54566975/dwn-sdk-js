import type { DelegatedGrantMessage } from '../../src/types/delegated-grant-message.js';
import type { DidResolver } from '@web5/dids';
import type { EventStream } from '../../src/types/subscriptions.js';
import type { DataStore, EventLog, MessageStore, PermissionScope } from '../../src/index.js';

import chaiAsPromised from 'chai-as-promised';
import minimalProtocolDefinition from '../vectors/protocol-definitions/minimal.json' assert { type: 'json' };
import sinon from 'sinon';

import chai, { expect } from 'chai';

import { DataStream } from '../../src/utils/data-stream.js';
import { Dwn } from '../../src/dwn.js';
import { DwnErrorCode } from '../../src/core/dwn-error.js';
import { Jws } from '../../src/utils/jws.js';
import { RecordsWrite } from '../../src/interfaces/records-write.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestEventStream } from '../test-event-stream.js';
import { TestStores } from '../test-stores.js';
import { Time } from '../../src/utils/time.js';

import { DidKey, UniversalResolver } from '@web5/dids';
import { DwnInterfaceName, DwnMethodName, Encoder, Message, PermissionsGrant, PermissionsProtocol, PermissionsRevoke, ProtocolsConfigure } from '../../src/index.js';

chai.use(chaiAsPromised);

export function testOwnerDelegatedGrant(): void {
  describe('owner delegated grant', async () => {
    let didResolver: DidResolver;
    let messageStore: MessageStore;
    let dataStore: DataStore;
    let eventLog: EventLog;
    let eventStream: EventStream;
    let dwn: Dwn;

    // important to follow the `before` and `after` pattern to initialize and clean the stores in tests
    // so that different test suites can reuse the same backend store for testing
    before(async () => {
      didResolver = new UniversalResolver({ didResolvers: [DidKey] });

      const stores = TestStores.get();
      messageStore = stores.messageStore;
      dataStore = stores.dataStore;
      eventLog = stores.eventLog;
      eventStream = TestEventStream.get();

      dwn = await Dwn.create({ didResolver, messageStore, dataStore, eventLog, eventStream });
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

    describe('RecordsWrite.parse()', async () => {
      it('should throw if a message invokes an owner-delegated grant (ID) but the owner-delegated grant is not given', async () => {
        const alice = await TestDataGenerator.generatePersona();
        const bob = await TestDataGenerator.generatePersona();
        const appX = await TestDataGenerator.generatePersona();

        // Alice grants App X to write as her for the chat protocol
        const scope: PermissionScope = {
          interface : DwnInterfaceName.Records,
          method    : DwnMethodName.Write,
          protocol  : 'chat'
        };
        const grantToAppX = await PermissionsProtocol.createGrant({
          delegated   : true, // this is a delegated grant
          dateExpires : Time.createOffsetTimestamp({ seconds: 100 }),
          description : 'Allow App X to write as me in chat protocol',
          grantedTo   : appX.did,
          scope,
          signer      : Jws.createSigner(alice)
        });

        // Bob creates a RecordsWrite message
        const recordsWrite = await RecordsWrite.create({
          signer     : Jws.createSigner(bob),
          dataFormat : 'application/octet-stream',
          data       : TestDataGenerator.randomBytes(10),
        });

        // App X signs over Bob's RecordsWrite as DWN owner but does not include the delegated grant (we remove it below)
        await recordsWrite.signAsOwnerDelegate(Jws.createSigner(appX), grantToAppX.recordsWrite.message);

        delete recordsWrite.message.authorization!.ownerDelegatedGrant; // intentionally remove `ownerDelegatedGrant`
        const parsePromise = RecordsWrite.parse(recordsWrite.message);

        await expect(parsePromise).to.be.rejectedWith(DwnErrorCode.RecordsOwnerDelegatedGrantAndIdExistenceMismatch);
      });

      it('should throw if a message includes an owner-delegated grant but does not reference it in owner signature', async () => {
        const alice = await TestDataGenerator.generatePersona();
        const bob = await TestDataGenerator.generatePersona();
        const appX = await TestDataGenerator.generatePersona();

        // Alice grants App X to write as her for the chat protocol
        const scope: PermissionScope = {
          interface : DwnInterfaceName.Records,
          method    : DwnMethodName.Write,
          protocol  : 'chat'
        };
        const grantToAppX = await PermissionsProtocol.createGrant({
          delegated   : true, // this is a delegated grant
          dateExpires : Time.createOffsetTimestamp({ seconds: 100 }),
          description : 'Allow App X to write as me in chat protocol',
          grantedTo   : appX.did,
          scope,
          signer      : Jws.createSigner(alice)
        });

        // Bob creates a RecordsWrite message
        const recordsWrite = await RecordsWrite.create({
          signer     : Jws.createSigner(bob),
          dataFormat : 'application/octet-stream',
          data       : TestDataGenerator.randomBytes(10),
        });

        // App X attempts to sign over Bob's RecordsWrite as the DWN owner by including an owner-delegated grant
        // but does not reference the grant ID in owner signature (we remove it below)
        await recordsWrite.signAsOwnerDelegate(Jws.createSigner(appX), grantToAppX.recordsWrite.message);

        const ownerSignaturePayloadCopy = { ...recordsWrite.ownerSignaturePayload };
        delete ownerSignaturePayloadCopy.delegatedGrantId; // intentionally remove `delegatedGrantId` in ownerSignature
        recordsWrite.message.authorization!.ownerSignature!.payload = Encoder.stringToBase64Url(JSON.stringify(ownerSignaturePayloadCopy));
        const parsePromise = RecordsWrite.parse(recordsWrite.message);

        await expect(parsePromise).to.be.rejectedWith(DwnErrorCode.RecordsOwnerDelegatedGrantAndIdExistenceMismatch);
      });
    });

    it('should only allow correct entity invoking an owner-delegated grant to write', async () => {
      // scenario:
      // 1. Alice installs a protocol
      // 2. Alice creates a delegated grant for app X to write in the protocol
      // 3. A third party (Bob) authors a RecordsWrite
      // 4. Sanity test that Bob's RecordsWrite cannot be written to Alice's DWN by itself
      // 5. Verify that App Y cannot write Bob's message in Alice's DWN by invoking the delegated grant for App X.
      // 6. Verify that App X can successfully write Bob's message in Alice's DWN by invoking an owner-delegated grant
      // 7. Sanity verify the RecordsWrite written by App X
      const alice = await TestDataGenerator.generateDidKeyPersona();
      const bob = await TestDataGenerator.generateDidKeyPersona();
      const appX = await TestDataGenerator.generateDidKeyPersona();
      const appY = await TestDataGenerator.generateDidKeyPersona();

      // 1. Alice installs a protocol
      const protocolDefinition = minimalProtocolDefinition;
      const protocol = minimalProtocolDefinition.protocol;
      const protocolsConfig = await ProtocolsConfigure.create({
        signer     : Jws.createSigner(alice),
        definition : protocolDefinition
      });
      const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
      expect(protocolsConfigureReply.status.code).to.equal(202);

      // 2. Alice creates a delegated grant for app X to write in the protocol
      const scope: PermissionScope = {
        interface : DwnInterfaceName.Records,
        method    : DwnMethodName.Write,
        protocol
      };

      const appXGrant = await PermissionsProtocol.createGrant({
        delegated   : true, // this is a delegated grant
        dateExpires : Time.createOffsetTimestamp({ seconds: 100 }),
        grantedTo   : appX.did,
        scope       : scope,
        signer      : Jws.createSigner(alice)
      });

      // 3. A third party (Bob) authors a RecordsWrite
      const bobRecordsWriteBytes = new TextEncoder().encode('message from Bob');
      const bobRecordsWrite = await RecordsWrite.create({
        signer       : Jws.createSigner(bob),
        protocol,
        protocolPath : 'foo', // this comes from `types` in protocol definition
        dataFormat   : 'any-format',
        data         : bobRecordsWriteBytes
      });

      // 4. Sanity test that Bob's RecordsWrite cannot be written to Alice's DWN by itself
      const unAuthorizedRecordsWriteReply = await dwn.processMessage(
        alice.did,
        bobRecordsWrite.message,
        { dataStream: DataStream.fromBytes(bobRecordsWriteBytes) }
      );
      expect(unAuthorizedRecordsWriteReply.status.code).to.equal(401);

      // 5. Verify that App Y cannot write Bob's message in Alice's DWN by invoking the delegated grant for App X.
      const appYAugmentedWrite = await RecordsWrite.parse(bobRecordsWrite.message);
      await appYAugmentedWrite.signAsOwnerDelegate(Jws.createSigner(appY), appXGrant.recordsWrite.message);
      const appYWriteReply = await dwn.processMessage(
        alice.did,
        appYAugmentedWrite.message,
        { dataStream: DataStream.fromBytes(bobRecordsWriteBytes) }
      );
      expect(appYWriteReply.status.code).to.equal(400);
      expect(appYWriteReply.status.detail).to.contain(DwnErrorCode.RecordsOwnerDelegatedGrantGrantedToAndOwnerSignatureMismatch);

      // 6. Verify that App X can successfully write Bob's message in Alice's DWN by invoking an owner-delegated grant
      const appXAugmentedWrite = await RecordsWrite.parse(bobRecordsWrite.message);
      await appXAugmentedWrite.signAsOwnerDelegate(Jws.createSigner(appX), appXGrant.recordsWrite.message);

      const appXWriteReply = await dwn.processMessage(
        alice.did,
        appXAugmentedWrite.message,
        { dataStream: DataStream.fromBytes(bobRecordsWriteBytes) }
      );
      expect(appXWriteReply.status.code).to.equal(202);

      // 7. Sanity verify the RecordsWrite written by App X
      const recordsQuery = await TestDataGenerator.generateRecordsQuery({
        author : alice,
        filter : { protocol }
      });
      const recordsQueryReply = await dwn.processMessage(alice.did, recordsQuery.message);
      expect(recordsQueryReply.status.code).to.equal(200);
      expect(recordsQueryReply.entries?.length).to.equal(1);

      const fetchedEntry = recordsQueryReply.entries![0];
      expect(fetchedEntry.encodedData).to.equal(Encoder.bytesToBase64Url(bobRecordsWriteBytes));

      const fetchedRecordsWrite = await RecordsWrite.parse(fetchedEntry);
      expect(fetchedRecordsWrite.author).to.equal(bob.did);
    });

    it('should not allow entity using a non-delegated grant as an owner-delegated grant to invoke write', async () => {
      // scenario:
      // 1. Alice installs a protocol
      // 2. Alice creates a non-delegated grant for app X to write in the protocol
      // 3. A third party (Bob) authors a RecordsWrite
      // 4. Verify that App X cannot write Bob's message in Alice's DWN by invoking an non-delegated grant
      // 5. Sanity verify the RecordsWrite is not written by App X
      const alice = await TestDataGenerator.generateDidKeyPersona();
      const bob = await TestDataGenerator.generateDidKeyPersona();
      const appX = await TestDataGenerator.generateDidKeyPersona();

      // 1. Alice installs a protocol
      const protocolDefinition = minimalProtocolDefinition;
      const protocol = minimalProtocolDefinition.protocol;
      const protocolsConfig = await ProtocolsConfigure.create({
        signer     : Jws.createSigner(alice),
        definition : protocolDefinition
      });
      const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
      expect(protocolsConfigureReply.status.code).to.equal(202);

      // 2. Alice creates a non-delegated grant for app X to write in the protocol
      const scope: PermissionScope = {
        interface : DwnInterfaceName.Records,
        method    : DwnMethodName.Write,
        protocol
      };

      const appXGrant = await PermissionsProtocol.createGrant({
        // delegated   : true, // intentionally commented out to show that this is not a delegated grant
        dateExpires : Time.createOffsetTimestamp({ seconds: 100 }),
        grantedTo   : appX.did,
        scope       : scope,
        signer      : Jws.createSigner(alice)
      });

      // 3. A third party (Bob) authors a RecordsWrite
      const bobRecordsWriteBytes = new TextEncoder().encode('message from Bob');
      const bobRecordsWrite = await RecordsWrite.create({
        signer       : Jws.createSigner(bob),
        protocol,
        protocolPath : 'foo', // this comes from `types` in protocol definition
        dataFormat   : 'any-format',
        data         : bobRecordsWriteBytes
      });

      // 4. Verify that App X cannot write Bob's message in Alice's DWN by invoking an non-delegated grant
      const appXAugmentedWrite = await RecordsWrite.parse(bobRecordsWrite.message);
      await appXAugmentedWrite.signAsOwnerDelegate(
        Jws.createSigner(appX),
        appXGrant.recordsWrite.message
      );

      const appXWriteReply = await dwn.processMessage(
        alice.did,
        appXAugmentedWrite.message,
        { dataStream: DataStream.fromBytes(bobRecordsWriteBytes) }
      );
      expect(appXWriteReply.status.code).to.equal(400);
      expect(appXWriteReply.status.detail).to.contain(DwnErrorCode.RecordsOwnerDelegatedGrantNotADelegatedGrant);

      // 5. Sanity verify the RecordsWrite is not written by App X
      const recordsQuery = await TestDataGenerator.generateRecordsQuery({
        author : alice,
        filter : { protocol }
      });
      const recordsQueryReply = await dwn.processMessage(alice.did, recordsQuery.message);
      expect(recordsQueryReply.status.code).to.equal(200);
      expect(recordsQueryReply.entries?.length).to.equal(0);
    });

    it('should fail if owner-delegated grant invoked for write has a mismatching interface method or protocol scope', async () => {
      // scenario:
      // 1. Alice installs a protocol
      // 2. Alice creates a delegated grant for app X to read in the protocol
      // 3. Alice creates a delegated grant for app X to write in another random protocol
      // 4. A third party (Bob) authors a RecordsWrite
      // 5. Verify that App X cannot write Bob's message in Alice's DWN by invoking a delegated grant for RecordsRead
      // 6. Verify that App X cannot write Bob's message in Alice's DWN by invoking a delegated grant for writing in another random protocol
      // 7. Sanity verify the RecordsWrite is not written by App X
      const alice = await TestDataGenerator.generateDidKeyPersona();
      const bob = await TestDataGenerator.generateDidKeyPersona();
      const appX = await TestDataGenerator.generateDidKeyPersona();

      // 1. Alice installs a protocol
      const protocolDefinition = minimalProtocolDefinition;
      const protocol = minimalProtocolDefinition.protocol;
      const protocolsConfig = await ProtocolsConfigure.create({
        signer     : Jws.createSigner(alice),
        definition : protocolDefinition
      });
      const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
      expect(protocolsConfigureReply.status.code).to.equal(202);

      // 2. Alice creates a delegated grant for app X to read in the protocol
      const readScope: PermissionScope = {
        interface : DwnInterfaceName.Records,
        method    : DwnMethodName.Read,
        protocol
      };

      const appXGrantToRead = await PermissionsProtocol.createGrant({
        delegated   : true,
        dateExpires : Time.createOffsetTimestamp({ seconds: 100 }),
        grantedTo   : appX.did,
        scope       : readScope,
        signer      : Jws.createSigner(alice)
      });

      // 3. Alice creates a delegated grant for app X to write in another random protocol
      const randomProtocolWriteScope: PermissionScope = {
        interface : DwnInterfaceName.Records,
        method    : DwnMethodName.Write,
        protocol  : `random-protocol`
      };

      const appXGrantToWriteInRandomProtocol = await PermissionsProtocol.createGrant({
        delegated   : true,
        dateExpires : Time.createOffsetTimestamp({ seconds: 100 }),
        grantedTo   : appX.did,
        scope       : randomProtocolWriteScope,
        signer      : Jws.createSigner(alice)
      });

      // 4. A third party (Bob) authors a RecordsWrite
      const bobRecordsWriteBytes = new TextEncoder().encode('message from Bob');
      const bobRecordsWrite = await RecordsWrite.create({
        signer       : Jws.createSigner(bob),
        protocol,
        protocolPath : 'foo', // this comes from `types` in protocol definition
        dataFormat   : 'any-format',
        data         : bobRecordsWriteBytes
      });

      // 5. Verify that App X cannot write Bob's message in Alice's DWN by invoking a delegated grant for RecordsRead
      const appXAugmentedWrite = await RecordsWrite.parse(bobRecordsWrite.message);
      await appXAugmentedWrite.signAsOwnerDelegate(
        Jws.createSigner(appX),
        appXGrantToRead.recordsWrite.message
      );

      const appXWriteReply = await dwn.processMessage(
        alice.did,
        appXAugmentedWrite.message,
        { dataStream: DataStream.fromBytes(bobRecordsWriteBytes) }
      );
      expect(appXWriteReply.status.code).to.equal(401);
      expect(appXWriteReply.status.detail).to.contain(DwnErrorCode.GrantAuthorizationMethodMismatch);

      // 6. Verify that App X cannot write Bob's message in Alice's DWN by invoking a delegated grant for writing in another random protocol
      const appXAugmentedWrite2 = await RecordsWrite.parse(bobRecordsWrite.message);
      await appXAugmentedWrite2.signAsOwnerDelegate(
        Jws.createSigner(appX),
        appXGrantToWriteInRandomProtocol.recordsWrite.message
      );

      const appXWriteReply2 = await dwn.processMessage(
        alice.did,
        appXAugmentedWrite2.message,
        { dataStream: DataStream.fromBytes(bobRecordsWriteBytes) }
      );
      expect(appXWriteReply2.status.code).to.equal(401);
      expect(appXWriteReply2.status.detail).to.contain(DwnErrorCode.RecordsGrantAuthorizationScopeProtocolMismatch);

      // 7. Sanity verify the RecordsWrite is not written by App X
      const recordsQuery = await TestDataGenerator.generateRecordsQuery({
        author : alice,
        filter : { protocol }
      });
      const recordsQueryReply = await dwn.processMessage(alice.did, recordsQuery.message);
      expect(recordsQueryReply.status.code).to.equal(200);
      expect(recordsQueryReply.entries?.length).to.equal(0);
    });

    it('should fail RecordsWrite if presented with an owner-delegated grant with invalid grantor signature', async () => {
      // scenario:
      // 1. Alice installs a protocol
      // 2. Alice creates a delegated grant for App X to write as Alice, but with invalid signature
      // 3. A third party (Bob) authors a RecordsWrite
      // 4. Verify that App X cannot write Bob's message in Alice's DWN by invoking an owner-delegated grant with invalid signature
      // 5. Sanity verify the RecordsWrite is not written by App X
      const alice = await TestDataGenerator.generateDidKeyPersona();
      const bob = await TestDataGenerator.generateDidKeyPersona();
      const appX = await TestDataGenerator.generateDidKeyPersona();

      // 1. Alice installs a protocol
      const protocolDefinition = minimalProtocolDefinition;
      const protocol = minimalProtocolDefinition.protocol;
      const protocolsConfig = await ProtocolsConfigure.create({
        signer     : Jws.createSigner(alice),
        definition : protocolDefinition
      });
      const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
      expect(protocolsConfigureReply.status.code).to.equal(202);

      // 2. Alice creates a delegated grant for App X to write as Alice, but with invalid signature
      const scope: PermissionScope = {
        interface : DwnInterfaceName.Records,
        method    : DwnMethodName.Write,
        protocol
      };

      const appXGrant = await PermissionsProtocol.createGrant({
        delegated   : true,
        dateExpires : Time.createOffsetTimestamp({ seconds: 100 }),
        grantedTo   : appX.did,
        scope       : scope,
        signer      : Jws.createSigner(alice)
      });

      const appXGrantMessage = appXGrant.recordsWrite.message;
      appXGrantMessage.authorization.signature.signatures[0].signature = await TestDataGenerator.randomSignatureString();

      // 3. A third party (Bob) authors a RecordsWrite
      const bobRecordsWriteBytes = new TextEncoder().encode('message from Bob');
      const bobRecordsWrite = await RecordsWrite.create({
        signer       : Jws.createSigner(bob),
        protocol,
        protocolPath : 'foo', // this comes from `types` in protocol definition
        dataFormat   : 'any-format',
        data         : bobRecordsWriteBytes
      });

      // 4. Verify that App X cannot write Bob's message in Alice's DWN by invoking an owner-delegated grant with invalid signature
      const appXAugmentedWrite = await RecordsWrite.parse(bobRecordsWrite.message);
      await appXAugmentedWrite.signAsOwnerDelegate(Jws.createSigner(appX), appXGrantMessage);

      const appXWriteReply = await dwn.processMessage(
        alice.did,
        appXAugmentedWrite.message,
        { dataStream: DataStream.fromBytes(bobRecordsWriteBytes) }
      );
      expect(appXWriteReply.status.code).to.equal(401);
      expect(appXWriteReply.status.detail).to.contain(DwnErrorCode.GeneralJwsVerifierInvalidSignature);

      // 5. Sanity verify the RecordsWrite is not written by App X
      const recordsQuery = await TestDataGenerator.generateRecordsQuery({
        author : alice,
        filter : { protocol }
      });
      const recordsQueryReply = await dwn.processMessage(alice.did, recordsQuery.message);
      expect(recordsQueryReply.status.code).to.equal(200);
      expect(recordsQueryReply.entries?.length).to.equal(0);
    });

    it('should fail RecordsWrite if grant ID in owner signature payload and CID of owner-delegated grant are mismatching', async () => {
      // scenario:
      // 1. Alice installs a protocol
      // 2. Creates two delegated grant for App X to write as Alice
      // 3. A third party (Bob) authors a RecordsWrite
      // 4. Verify that App X cannot write Bob's message in Alice's DWN by invoking an owner-delegated grant with the wrong ID
      // 5. Sanity verify the RecordsWrite is not written by App X
      const alice = await TestDataGenerator.generateDidKeyPersona();
      const bob = await TestDataGenerator.generateDidKeyPersona();
      const appX = await TestDataGenerator.generateDidKeyPersona();

      // 1. Alice installs a protocol
      const protocolDefinition = minimalProtocolDefinition;
      const protocol = minimalProtocolDefinition.protocol;
      const protocolsConfig = await ProtocolsConfigure.create({
        signer     : Jws.createSigner(alice),
        definition : protocolDefinition
      });
      const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
      expect(protocolsConfigureReply.status.code).to.equal(202);

      // 2. Creates two delegated grant for App X to write as Alice
      const scope: PermissionScope = {
        interface : DwnInterfaceName.Records,
        method    : DwnMethodName.Write,
        protocol
      };

      const appXGrant = await PermissionsProtocol.createGrant({
        delegated   : true,
        dateExpires : Time.createOffsetTimestamp({ seconds: 100 }),
        grantedTo   : appX.did,
        scope       : scope,
        signer      : Jws.createSigner(alice)
      });

      await Time.minimalSleep();

      const appXGrant2 = await PermissionsProtocol.createGrant({
        delegated   : true,
        dateExpires : Time.createOffsetTimestamp({ seconds: 100 }),
        grantedTo   : appX.did,
        scope       : scope,
        signer      : Jws.createSigner(alice)
      });

      // 3. A third party (Bob) authors a RecordsWrite
      const bobRecordsWriteBytes = new TextEncoder().encode('message from Bob');
      const bobRecordsWrite = await RecordsWrite.create({
        signer       : Jws.createSigner(bob),
        protocol,
        protocolPath : 'foo', // this comes from `types` in protocol definition
        dataFormat   : 'any-format',
        data         : bobRecordsWriteBytes
      });

      // 4. Verify that App X cannot write Bob's message in Alice's DWN by invoking an owner-delegated grant with the wrong ID
      const appXAugmentedWrite = await RecordsWrite.parse(bobRecordsWrite.message);
      await appXAugmentedWrite.signAsOwnerDelegate(Jws.createSigner(appX), appXGrant.recordsWrite.message);

      appXAugmentedWrite.message.authorization.ownerDelegatedGrant = appXGrant2.recordsWrite.message; // intentionally have a mismatching grant

      const appXWriteReply = await dwn.processMessage(
        alice.did,
        appXAugmentedWrite.message,
        { dataStream: DataStream.fromBytes(bobRecordsWriteBytes) }
      );
      expect(appXWriteReply.status.code).to.equal(400);
      expect(appXWriteReply.status.detail).to.contain(DwnErrorCode.RecordsOwnerDelegatedGrantCidMismatch);

      // 5. Sanity verify the RecordsWrite is not written by App X
      const recordsQuery = await TestDataGenerator.generateRecordsQuery({
        author : alice,
        filter : { protocol }
      });
      const recordsQueryReply = await dwn.processMessage(alice.did, recordsQuery.message);
      expect(recordsQueryReply.status.code).to.equal(200);
      expect(recordsQueryReply.entries?.length).to.equal(0);
    });

    it('should fail RecordsWrite if owner-delegated grant is revoked', async () => {
      // scenario:
      // 1. Alice installs a protocol
      // 2. Alice creates a delegated grant for App X to write as Alice
      // 3. Alice revokes the grant
      // 4. A third party (Bob) authors a RecordsWrite
      // 5. Verify that App X cannot write Bob's message in Alice's DWN by invoking a revoked owner-delegated grant
      // 6. Sanity verify the RecordsWrite is not written by App X
      const alice = await TestDataGenerator.generateDidKeyPersona();
      const bob = await TestDataGenerator.generateDidKeyPersona();
      const appX = await TestDataGenerator.generateDidKeyPersona();

      // 1. Alice installs a protocol
      const protocolDefinition = minimalProtocolDefinition;
      const protocol = minimalProtocolDefinition.protocol;
      const protocolsConfig = await ProtocolsConfigure.create({
        signer     : Jws.createSigner(alice),
        definition : protocolDefinition
      });
      const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
      expect(protocolsConfigureReply.status.code).to.equal(202);

      // 2. Alice creates a delegated grant for App X to write as Alice
      const scope: PermissionScope = {
        interface : DwnInterfaceName.Records,
        method    : DwnMethodName.Write,
        protocol
      };

      const appXGrant = await PermissionsProtocol.createGrant({
        delegated   : true,
        dateExpires : Time.createOffsetTimestamp({ seconds: 100 }),
        grantedTo   : appX.did,
        scope       : scope,
        signer      : Jws.createSigner(alice)
      });

      const permissionsGrantReply = await dwn.processMessage(alice.did, appXGrant.recordsWrite.message);
      expect(permissionsGrantReply.status.code).to.equal(202);

      // 3. Alice revokes the grant
      const permissionsRevoke = await PermissionsRevoke.create({
        signer             : Jws.createSigner(alice),
        permissionsGrantId : await Message.getCid(appXGrant.recordsWrite.message)
      });
      const permissionsRevokeReply = await dwn.processMessage(alice.did, permissionsRevoke.message);
      expect(permissionsRevokeReply.status.code).to.equal(202);

      // 4. A third party (Bob) authors a RecordsWrite
      const bobRecordsWriteBytes = new TextEncoder().encode('message from Bob');
      const bobRecordsWrite = await RecordsWrite.create({
        signer       : Jws.createSigner(bob),
        protocol,
        protocolPath : 'foo', // this comes from `types` in protocol definition
        dataFormat   : 'any-format',
        data         : bobRecordsWriteBytes
      });

      // 5. Verify that App X cannot write Bob's message in Alice's DWN by invoking a revoked owner-delegated grant
      const appXAugmentedWrite = await RecordsWrite.parse(bobRecordsWrite.message);
      await appXAugmentedWrite.signAsOwnerDelegate(Jws.createSigner(appX), appXGrant.recordsWrite.message);

      const appXWriteReply = await dwn.processMessage(
        alice.did,
        appXAugmentedWrite.message,
        { dataStream: DataStream.fromBytes(bobRecordsWriteBytes) }
      );
      expect(appXWriteReply.status.code).to.equal(401);
      expect(appXWriteReply.status.detail).to.contain(DwnErrorCode.GrantAuthorizationGrantRevoked);

      // 6. Sanity verify the RecordsWrite is not written by App X
      const recordsQuery = await TestDataGenerator.generateRecordsQuery({
        author : alice,
        filter : { protocol }
      });
      const recordsQueryReply = await dwn.processMessage(alice.did, recordsQuery.message);
      expect(recordsQueryReply.status.code).to.equal(200);
      expect(recordsQueryReply.entries?.length).to.equal(0);
    });

    it('should fail RecordsWrite if owner-delegated grant is expired', async () => {
      // scenario:
      // 1. Alice installs a protocol
      // 2. Alice creates a delegated grant for App X to write as Alice, but make it expired
      // 3. A third party (Bob) authors a RecordsWrite
      // 4. Verify that App X cannot write Bob's message in Alice's DWN by invoking an expired owner-delegated grant
      // 5. Sanity verify the RecordsWrite is not written by App X
      const alice = await TestDataGenerator.generateDidKeyPersona();
      const bob = await TestDataGenerator.generateDidKeyPersona();
      const appX = await TestDataGenerator.generateDidKeyPersona();

      // 1. Alice installs a protocol
      const protocolDefinition = minimalProtocolDefinition;
      const protocol = minimalProtocolDefinition.protocol;
      const protocolsConfig = await ProtocolsConfigure.create({
        signer     : Jws.createSigner(alice),
        definition : protocolDefinition
      });
      const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
      expect(protocolsConfigureReply.status.code).to.equal(202);

      // 2. Alice creates a delegated grant for App X to write as Alice, but make it expired
      const scope: PermissionScope = {
        interface : DwnInterfaceName.Records,
        method    : DwnMethodName.Write,
        protocol
      };

      const appXGrant = await PermissionsProtocol.createGrant({
        delegated   : true,
        dateExpires : Time.getCurrentTimestamp(), // intentionally set to current time to make it expired immediately
        grantedTo   : appX.did,
        scope       : scope,
        signer      : Jws.createSigner(alice)
      });

      // 3. A third party (Bob) authors a RecordsWrite
      const bobRecordsWriteBytes = new TextEncoder().encode('message from Bob');
      const bobRecordsWrite = await RecordsWrite.create({
        signer       : Jws.createSigner(bob),
        protocol,
        protocolPath : 'foo', // this comes from `types` in protocol definition
        dataFormat   : 'any-format',
        data         : bobRecordsWriteBytes
      });

      // 4. Verify that App X cannot write Bob's message in Alice's DWN by invoking an expired owner-delegated grant
      const appXAugmentedWrite = await RecordsWrite.parse(bobRecordsWrite.message);
      await appXAugmentedWrite.signAsOwnerDelegate(Jws.createSigner(appX), appXGrant.recordsWrite.message);

      const appXWriteReply = await dwn.processMessage(
        alice.did,
        appXAugmentedWrite.message,
        { dataStream: DataStream.fromBytes(bobRecordsWriteBytes) }
      );
      expect(appXWriteReply.status.code).to.equal(401);
      expect(appXWriteReply.status.detail).to.contain(DwnErrorCode.GrantAuthorizationGrantExpired);

      // 5. Sanity verify the RecordsWrite is not written by App X
      const recordsQuery = await TestDataGenerator.generateRecordsQuery({
        author : alice,
        filter : { protocol }
      });
      const recordsQueryReply = await dwn.processMessage(alice.did, recordsQuery.message);
      expect(recordsQueryReply.status.code).to.equal(200);
      expect(recordsQueryReply.entries?.length).to.equal(0);
    });
  });
}
