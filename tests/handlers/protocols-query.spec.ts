import type { DidResolver } from '@web5/dids';
import type { EventStream } from '../../src/types/subscriptions.js';
import type {
  DataStore,
  EventLog,
  MessageStore,
  ProtocolsConfigureMessage,
  ResumableTaskStore,
} from '../../src/index.js';

import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import chai, { expect } from 'chai';

import { GeneralJwsBuilder } from '../../src/jose/jws/general/builder.js';
import { Message } from '../../src/core/message.js';
import { PermissionGrant } from '../../src/protocols/permission-grant.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestEventStream } from '../test-event-stream.js';
import { TestStores } from '../test-stores.js';
import { TestStubGenerator } from '../utils/test-stub-generator.js';
import { Time } from '../../src/utils/time.js';
import { DataStream, Dwn, DwnErrorCode, DwnInterfaceName, DwnMethodName, Encoder, Jws, PermissionsProtocol, ProtocolsQuery, RecordsWrite } from '../../src/index.js';
import { DidKey, UniversalResolver } from '@web5/dids';

chai.use(chaiAsPromised);

export function testProtocolsQueryHandler(): void {
  describe('ProtocolsQueryHandler.handle()', () => {
    let didResolver: DidResolver;
    let messageStore: MessageStore;
    let dataStore: DataStore;
    let resumableTaskStore: ResumableTaskStore;
    let eventLog: EventLog;
    let eventStream: EventStream;
    let dwn: Dwn;

    describe('functional tests', () => {

      // important to follow the `before` and `after` pattern to initialize and clean the stores in tests
      // so that different test suites can reuse the same backend store for testing
      before(async () => {
        didResolver = new UniversalResolver({ didResolvers: [DidKey] });

        const stores = TestStores.get();
        messageStore = stores.messageStore;
        dataStore = stores.dataStore;
        resumableTaskStore = stores.resumableTaskStore;
        eventLog = stores.eventLog;
        eventStream = TestEventStream.get();

        dwn = await Dwn.create({ didResolver, messageStore, dataStore, eventLog, eventStream, resumableTaskStore });
      });

      beforeEach(async () => {
        sinon.restore(); // wipe all previous stubs/spies/mocks/fakes

        // clean up before each test rather than after so that a test does not depend on other tests to do the clean up
        await messageStore.clear();
        await dataStore.clear();
        await resumableTaskStore.clear();
        await eventLog.clear();
      });

      after(async () => {
        await dwn.close();
      });

      it('should return protocols matching the query', async () => {
        const alice = await TestDataGenerator.generatePersona();

        // setting up a stub method resolver
        TestStubGenerator.stubDidResolver(didResolver, [alice]);

        // insert three messages into DB, two with matching protocol
        const protocol1 = await TestDataGenerator.generateProtocolsConfigure({ author: alice });
        const protocol2 = await TestDataGenerator.generateProtocolsConfigure({ author: alice });
        const protocol3 = await TestDataGenerator.generateProtocolsConfigure({ author: alice });

        await dwn.processMessage(alice.did, protocol1.message);
        await dwn.processMessage(alice.did, protocol2.message);
        await dwn.processMessage(alice.did, protocol3.message);

        // testing singular conditional query
        const queryMessageData = await TestDataGenerator.generateProtocolsQuery({
          author : alice,
          filter : { protocol: protocol1.message.descriptor.definition.protocol }
        });

        const reply = await dwn.processMessage(alice.did, queryMessageData.message);

        expect(reply.status.code).to.equal(200);
        expect(reply.entries?.length).to.equal(1); // only 1 entry should match the query on protocol

        // testing fetch-all query without filter
        const queryMessageData2 = await TestDataGenerator.generateProtocolsQuery({
          author: alice
        });

        const reply2 = await dwn.processMessage(alice.did, queryMessageData2.message);

        expect(reply2.status.code).to.equal(200);
        expect(reply2.entries?.length).to.equal(3); // expecting all 3 entries written above match the query
      });


      it('should return published protocols matching the query if query is unauthenticated or unauthorized', async () => {
        // scenario:
        // 1. Alice has 3 protocols installed: 1 private + 2 published
        // 2. Unauthenticated ProtocolsQuery should return published ProtocolsConfigure
        // 3. Authenticated ProtocolsQuery by Bob but unauthorized to private ProtocolsConfigures should return published ProtocolsConfigure

        const alice = await TestDataGenerator.generatePersona();
        const bob = await TestDataGenerator.generatePersona();

        TestStubGenerator.stubDidResolver(didResolver, [alice, bob]);

        // insert three messages into DB, two with matching protocol
        const protocol1 = await TestDataGenerator.generateProtocolsConfigure({ author: alice, published: false });
        const protocol2 = await TestDataGenerator.generateProtocolsConfigure({ author: alice, published: true });
        const protocol3 = await TestDataGenerator.generateProtocolsConfigure({ author: alice, published: true });

        await dwn.processMessage(alice.did, protocol1.message);
        await dwn.processMessage(alice.did, protocol2.message);
        await dwn.processMessage(alice.did, protocol3.message);

        // testing unauthenticated conditional query
        const conditionalQuery = await ProtocolsQuery.create({
          filter: { protocol: protocol2.message.descriptor.definition.protocol }
        });

        const conditionalQueryReply = await dwn.processMessage(alice.did, conditionalQuery.message);
        expect(conditionalQueryReply.status.code).to.equal(200);
        expect(conditionalQueryReply.entries?.length).to.equal(1); // only 1 entry should match the query on protocol

        const protocolConfigured = conditionalQueryReply.entries![0] as ProtocolsConfigureMessage;
        expect(protocolConfigured).to.deep.equal(protocol2.message);

        // testing authenticated but unauthorized conditional query, it should return only matching published ProtocolsConfigures
        const signedConditionalQuery = await ProtocolsQuery.create({
          filter : { protocol: protocol2.message.descriptor.definition.protocol },
          signer : Jws.createSigner(bob)
        });

        const signedConditionalQueryReply = await dwn.processMessage(alice.did, signedConditionalQuery.message);
        expect(signedConditionalQueryReply.status.code).to.equal(200);
        expect(signedConditionalQueryReply.entries?.length).to.equal(1); // only 1 entry should match the query on protocol

        const protocolConfigured2 = conditionalQueryReply.entries![0] as ProtocolsConfigureMessage;
        expect(protocolConfigured2).to.deep.equal(protocol2.message);

        // testing unauthenticated fetch-all query without filter
        const fetchAllQuery = await ProtocolsQuery.create({
        });

        const fetchAllQueryReply = await dwn.processMessage(alice.did, fetchAllQuery.message);
        expect(fetchAllQueryReply.status.code).to.equal(200);
        expect(fetchAllQueryReply.entries?.length).to.equal(2);
        expect(fetchAllQueryReply.entries).to.deep.include(protocol2.message);
        expect(fetchAllQueryReply.entries).to.deep.include(protocol3.message);

        // testing authenticated but unauthorized fetch-all query without filter, it should return all matching published ProtocolsConfigures
        const signedFetchAllQuery = await ProtocolsQuery.create({
          signer: Jws.createSigner(bob)
        });

        const signedFetchAllQueryReply = await dwn.processMessage(alice.did, signedFetchAllQuery.message);
        expect(signedFetchAllQueryReply.status.code).to.equal(200);
        expect(signedFetchAllQueryReply.entries?.length).to.equal(2);
        expect(signedFetchAllQueryReply.entries).to.deep.include(protocol2.message);
        expect(signedFetchAllQueryReply.entries).to.deep.include(protocol3.message);
      });

      it('should return 400 if protocol is not normalized', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();

        // query for non-normalized protocol
        const protocolsQuery = await TestDataGenerator.generateProtocolsQuery({
          author : alice,
          filter : { protocol: 'example.com/' },
        });

      // overwrite protocol because #create auto-normalizes protocol
      protocolsQuery.message.descriptor.filter!.protocol = 'example.com/';

      // Re-create auth because we altered the descriptor after signing
      protocolsQuery.message.authorization = await Message.createAuthorization({
        descriptor : protocolsQuery.message.descriptor,
        signer     : Jws.createSigner(alice)
      });

      // Send records write message
      const reply = await dwn.processMessage(alice.did, protocolsQuery.message);
      expect(reply.status.code).to.equal(400);
      expect(reply.status.detail).to.contain(DwnErrorCode.UrlProtocolNotNormalized);
      });

      it('should fail with 400 if signature payload is referencing a different message (`descriptorCid`)', async () => {
        const { author, message, protocolsQuery } = await TestDataGenerator.generateProtocolsQuery();
        const tenant = author.did;

        // replace signature with incorrect `descriptorCid`, even though signature is still valid
        const incorrectDescriptorCid = await TestDataGenerator.randomCborSha256Cid();
        const signaturePayload = { ...protocolsQuery.signaturePayload };
        signaturePayload.descriptorCid = incorrectDescriptorCid;
        const signaturePayloadBytes = Encoder.objectToBytes(signaturePayload);
        const signer = Jws.createSigner(author);
        const jwsBuilder = await GeneralJwsBuilder.create(signaturePayloadBytes, [signer]);
        message.authorization = { signature: jwsBuilder.getJws() };

        const reply = await dwn.processMessage(tenant, message);

        expect(reply.status.code).to.equal(400);
        expect(reply.status.detail).to.contain(`${incorrectDescriptorCid} does not match expected CID`);
      });

      it('should return 401 if auth fails', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const { message } = await TestDataGenerator.generateProtocolsQuery({ author: alice });

        // use a bad signature to fail authentication
        const badSignature = await TestDataGenerator.randomSignatureString();
        message.authorization!.signature.signatures[0].signature = badSignature;

        const reply = await dwn.processMessage(alice.did, message);
        expect(reply.status.code).to.equal(401);
        expect(reply.status.detail).to.contain(DwnErrorCode.GeneralJwsVerifierInvalidSignature);
      });

      describe('Grant authorization', () => {
        it('allows an external party to ProtocolsQuery only if they have a valid grant', async () => {
          // scenario:
          // 1. Alice grants Bob the access to ProtocolsQuery on her DWN
          // 2. Verify Bob can perform a ProtocolsQuery
          // 3. Verify that Mallory cannot to use Bob's permission grant to gain access to Alice's DWN
          // 4. Alice revokes Bob's grant
          // 5. Verify Bob cannot perform ProtocolsQuery with the revoked grant
          const alice = await TestDataGenerator.generateDidKeyPersona();
          const bob = await TestDataGenerator.generateDidKeyPersona();
          const mallory = await TestDataGenerator.generateDidKeyPersona();

          // 1. Alice grants Bob the access to ProtocolsQuery on her DWN
          const permissionGrant = await PermissionsProtocol.createGrant({
            signer      : Jws.createSigner(alice),
            grantedTo   : bob.did,
            dateExpires : Time.createOffsetTimestamp({ seconds: 60 * 60 * 24 }),
            scope       : { interface: DwnInterfaceName.Protocols, method: DwnMethodName.Query }
          });
          const dataStream = DataStream.fromBytes(permissionGrant.permissionGrantBytes);

          const grantRecordsWriteReply = await dwn.processMessage(alice.did, permissionGrant.recordsWrite.message, { dataStream });
          expect(grantRecordsWriteReply.status.code).to.equal(204);

          // 2. Verify Bob can perform a ProtocolsQuery
          const permissionGrantId = permissionGrant.recordsWrite.message.recordId;
          const protocolsQuery = await TestDataGenerator.generateProtocolsQuery({
            author: bob,
            permissionGrantId,
          });
          const protocolsQueryReply = await dwn.processMessage(alice.did, protocolsQuery.message);
          expect(protocolsQueryReply.status.code).to.equal(200);

          // 3. Verify that Mallory cannot to use Bob's permission grant to gain access to Alice's DWN
          const malloryProtocolsQuery = await TestDataGenerator.generateProtocolsQuery({
            author: mallory,
            permissionGrantId,
          });
          const malloryProtocolsQueryReply = await dwn.processMessage(alice.did, malloryProtocolsQuery.message);
          expect(malloryProtocolsQueryReply.status.code).to.equal(401);
          expect(malloryProtocolsQueryReply.status.detail).to.contain(DwnErrorCode.GrantAuthorizationNotGrantedToAuthor);

          // 4. Alice revokes Bob's grant
          const revokeWrite = await PermissionsProtocol.createRevocation({
            signer      : Jws.createSigner(alice),
            grant       : await PermissionGrant.parse(permissionGrant.dataEncodedMessage),
            dateRevoked : Time.getCurrentTimestamp()
          });

          const revokeWriteReply = await dwn.processMessage(
            alice.did,
            revokeWrite.recordsWrite.message,
            { dataStream: DataStream.fromBytes(revokeWrite.permissionRevocationBytes) }
          );
          expect(revokeWriteReply.status.code).to.equal(204);

          // 5. Verify Bob cannot perform ProtocolsQuery with the revoked grant
          const unauthorizedProtocolsQuery = await TestDataGenerator.generateProtocolsQuery({
            author: bob,
            permissionGrantId,
          });
          const unauthorizedProtocolsQueryReply = await dwn.processMessage(alice.did, unauthorizedProtocolsQuery.message);
          expect(unauthorizedProtocolsQueryReply.status.code).to.equal(401);
          expect(unauthorizedProtocolsQueryReply.status.detail).to.contain(DwnErrorCode.GrantAuthorizationGrantRevoked);
        });

        it('rejects with 401 when an external party attempts to ProtocolsQuery if they present an expired grant', async () => {
          // scenario: Alice grants Bob access to ProtocolsQuery, but when Bob invokes the grant it has expired
          const alice = await TestDataGenerator.generateDidKeyPersona();
          const bob = await TestDataGenerator.generateDidKeyPersona();

          // Alice gives Bob a permission grant with scope ProtocolsQuery and an expiry time
          const permissionGrant = await PermissionsProtocol.createGrant({
            signer      : Jws.createSigner(alice),
            grantedTo   : bob.did,
            dateGranted : Time.getCurrentTimestamp(),
            dateExpires : Time.getCurrentTimestamp(), // expires immediately
            scope       : { interface: DwnInterfaceName.Protocols, method: DwnMethodName.Query }
          });
          const dataStream = DataStream.fromBytes(permissionGrant.permissionGrantBytes);

          const permissionGrantWriteReply = await dwn.processMessage(alice.did, permissionGrant.recordsWrite.message, { dataStream });
          expect(permissionGrantWriteReply.status.code).to.equal(204);

          // Bob does ProtocolsQuery after the grant has expired
          const protocolsQuery = await TestDataGenerator.generateProtocolsQuery({
            author            : bob,
            permissionGrantId : permissionGrant.recordsWrite.message.recordId,
          });
          const protocolsQueryReply = await dwn.processMessage(alice.did, protocolsQuery.message);
          expect(protocolsQueryReply.status.code).to.equal(401);
          expect(protocolsQueryReply.status.detail).to.contain(DwnErrorCode.GrantAuthorizationGrantExpired);
        });

        it('rejects with 401 when an external party attempts to ProtocolsQuery if the grant is not yet active', async () => {
          // scenario: Alice grants Bob access to ProtocolsQuery, but Bob's message has a timestamp just before the grant is active

          const alice = await TestDataGenerator.generateDidKeyPersona();
          const bob = await TestDataGenerator.generateDidKeyPersona();

          // Set up timestamps
          const protocolsQueryTimestamp = Time.getCurrentTimestamp();
          await Time.minimalSleep(); // to ensure granted created will be after the query timestamp

          // Alice gives Bob a permission grant with scope ProtocolsQuery
          const permissionGrant = await PermissionsProtocol.createGrant({
            signer      : Jws.createSigner(alice),
            grantedTo   : bob.did,
            dateGranted : Time.getCurrentTimestamp(),
            dateExpires : Time.createOffsetTimestamp({ seconds: 60 * 60 * 24 }), // 24 hours
            scope       : { interface: DwnInterfaceName.Protocols, method: DwnMethodName.Query }
          });
          const dataStream = DataStream.fromBytes(permissionGrant.permissionGrantBytes);

          const permissionGrantWriteReply = await dwn.processMessage(alice.did, permissionGrant.recordsWrite.message, { dataStream });
          expect(permissionGrantWriteReply.status.code).to.equal(204);

          // Bob does ProtocolsQuery but his message has timestamp before the grant is active
          const protocolsQuery = await TestDataGenerator.generateProtocolsQuery({
            author            : bob,
            messageTimestamp  : protocolsQueryTimestamp,
            permissionGrantId : permissionGrant.recordsWrite.message.recordId,
          });
          const protocolsQueryReply = await dwn.processMessage(alice.did, protocolsQuery.message);
          expect(protocolsQueryReply.status.code).to.equal(401);
          expect(protocolsQueryReply.status.detail).to.contain(DwnErrorCode.GrantAuthorizationGrantNotYetActive);
        });

        it('rejects with 401 when an external party attempts to ProtocolsQuery using a grant that has a different scope', async () => {
          // scenario: Alice grants Bob access to RecordsRead, then Bob tries to invoke the grant with ProtocolsQuery

          const alice = await TestDataGenerator.generateDidKeyPersona();
          const bob = await TestDataGenerator.generateDidKeyPersona();

          // Alice gives Bob a permission grant with scope RecordsRead
          const permissionGrant = await PermissionsProtocol.createGrant({
            signer      : Jws.createSigner(alice),
            grantedTo   : bob.did,
            dateExpires : Time.createOffsetTimestamp({ seconds: 60 * 60 * 24 }),
            scope       : { interface: DwnInterfaceName.Records, method: DwnMethodName.Read, protocol: 'https://example.com/protocol/test' }
          });
          const dataStream = DataStream.fromBytes(permissionGrant.permissionGrantBytes);

          const grantRecordsWriteReply = await dwn.processMessage(alice.did, permissionGrant.recordsWrite.message, { dataStream });
          expect(grantRecordsWriteReply.status.code).to.equal(204);

          // Bob tries to ProtocolsQuery
          const protocolsQuery = await TestDataGenerator.generateProtocolsQuery({
            author            : bob,
            permissionGrantId : permissionGrant.recordsWrite.message.recordId,
          });
          const protocolsQueryReply = await dwn.processMessage(alice.did, protocolsQuery.message);
          expect(protocolsQueryReply.status.code).to.equal(401);
          expect(protocolsQueryReply.status.detail).to.contain(DwnErrorCode.GrantAuthorizationInterfaceMismatch);
        });

        it('rejects with 401 if the permission grant cannot be found', async () => {
          // scenario: Bob uses a permissionGrantId to ProtocolsQuery, but no permission grant can be found.

          const alice = await TestDataGenerator.generateDidKeyPersona();
          const bob = await TestDataGenerator.generateDidKeyPersona();

          // Bob tries to ProtocolsQuery
          const protocolsQuery = await TestDataGenerator.generateProtocolsQuery({
            author            : bob,
            permissionGrantId : await TestDataGenerator.randomCborSha256Cid(),
          });
          const protocolsQueryReply = await dwn.processMessage(alice.did, protocolsQuery.message);
          expect(protocolsQueryReply.status.code).to.equal(401);
          expect(protocolsQueryReply.status.detail).to.contain(DwnErrorCode.GrantAuthorizationGrantMissing);
        });

        it('rejects with 401 if the permission grant has not been grantedFor the tenant', async () => {
          // Scenario:
          // 1. Alice gives Carol a permission grant with scope ProtocolsQuery
          // 2. Bob (for unknown reason, thus this is a super edge case) stores the grant in his DWN
          // 3. Verify that Carol cannot use permission grant to gain access to Bob's DWN
          const alice = await TestDataGenerator.generateDidKeyPersona();
          const bob = await TestDataGenerator.generateDidKeyPersona();
          const carol = await TestDataGenerator.generateDidKeyPersona();

          // 1. Alice gives Carol a permission grant with scope ProtocolsQuery
          const permissionGrant = await PermissionsProtocol.createGrant({
            signer      : Jws.createSigner(alice),
            grantedTo   : carol.did,
            dateExpires : Time.createOffsetTimestamp({ seconds: 60 * 60 * 24 }),
            scope       : { interface: DwnInterfaceName.Protocols, method: DwnMethodName.Query }
          });
          const dataStream = DataStream.fromBytes(permissionGrant.permissionGrantBytes);

          // 2. Bob (for unknown reason, thus this is a super edge case) stores the grant in his DWN
          const bobWrappedGrant = await RecordsWrite.parse(permissionGrant.recordsWrite.message);
          await bobWrappedGrant.signAsOwner(Jws.createSigner(bob));

          const grantRecordsWriteReply = await dwn.processMessage(bob.did, bobWrappedGrant.message, { dataStream });
          expect(grantRecordsWriteReply.status.code).to.equal(204);

          // 3. Verify that Carol cannot use permission grant to gain access to Bob's DWN
          const permissionGrantId = permissionGrant.recordsWrite.message.recordId;
          const protocolsQuery = await TestDataGenerator.generateProtocolsQuery({
            author: carol,
            permissionGrantId,
          });
          const protocolsQueryReply = await dwn.processMessage(bob.did, protocolsQuery.message);
          expect(protocolsQueryReply.status.code).to.equal(401);
          expect(protocolsQueryReply.status.detail).to.contain(DwnErrorCode.GrantAuthorizationNotGrantedForTenant);
        });
      });
    });
  });
}