import type {
  DataStore,
  EventLog,
  MessageStore,
  ProtocolsConfigureMessage
} from '../../src/index.js';

import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import chai, { expect } from 'chai';

import { DidKeyResolver } from '../../src/did/did-key-resolver.js';
import { GeneralJwsBuilder } from '../../src/jose/jws/general/builder.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestStores } from '../test-stores.js';
import { TestStubGenerator } from '../utils/test-stub-generator.js';
import { DidResolver, Dwn, DwnErrorCode, Encoder, Jws, ProtocolsQuery } from '../../src/index.js';
import { DwnInterfaceName, DwnMethodName, Message } from '../../src/core/message.js';
import { getCurrentTimeInHighPrecision, sleep } from '../../src/utils/time.js';

chai.use(chaiAsPromised);

export function testProtocolsQueryHandler(): void {
  describe('ProtocolsQueryHandler.handle()', () => {
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


      it('should return published protocols matching the query if query is unauthenticated', async () => {
        // scenario: alice has 3 protocols installed: 1 private + 2 published

        const alice = await TestDataGenerator.generatePersona();

        // setting up a stub method resolver
        TestStubGenerator.stubDidResolver(didResolver, [alice]);

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

        // testing fetch-all query without filter
        const fetchAllQuery = await ProtocolsQuery.create({
        });

        const fetchAllQueryReply = await dwn.processMessage(alice.did, fetchAllQuery.message);

        expect(fetchAllQueryReply.status.code).to.equal(200);
        expect(fetchAllQueryReply.entries?.length).to.equal(2);
        expect(fetchAllQueryReply.entries).to.deep.include(protocol2.message);
        expect(fetchAllQueryReply.entries).to.deep.include(protocol3.message);
      });

      it('should return 400 if protocol is not normalized', async () => {
        const alice = await DidKeyResolver.generate();

        // query for non-normalized protocol
        const protocolsQuery = await TestDataGenerator.generateProtocolsQuery({
          author : alice,
          filter : { protocol: 'example.com/' },
        });

      // overwrite protocol because #create auto-normalizes protocol
      protocolsQuery.message.descriptor.filter!.protocol = 'example.com/';

      // Re-create auth because we altered the descriptor after signing
      protocolsQuery.message.authorization = await Message.createAuthorizationAsAuthor(
        protocolsQuery.message.descriptor,
        Jws.createSigner(alice)
      );

      // Send records write message
      const reply = await dwn.processMessage(alice.did, protocolsQuery.message);
      expect(reply.status.code).to.equal(400);
      expect(reply.status.detail).to.contain(DwnErrorCode.UrlProtocolNotNormalized);
      });

      it('should fail with 400 if signer signature payload is referencing a different message (`descriptorCid`)', async () => {
        const { author, message, protocolsQuery } = await TestDataGenerator.generateProtocolsQuery();
        const tenant = author.did;

        // replace signer signature with incorrect `descriptorCid`, even though signature is still valid
        const incorrectDescriptorCid = await TestDataGenerator.randomCborSha256Cid();
        const signerSignaturePayload = { ...protocolsQuery.signerSignaturePayload };
        signerSignaturePayload.descriptorCid = incorrectDescriptorCid;
        const signerSignaturePayloadBytes = Encoder.objectToBytes(signerSignaturePayload);
        const signer = Jws.createSigner(author);
        const jwsBuilder = await GeneralJwsBuilder.create(signerSignaturePayloadBytes, [signer]);
        message.authorization = { authorSignature: jwsBuilder.getJws() };

        const reply = await dwn.processMessage(tenant, message);

        expect(reply.status.code).to.equal(400);
        expect(reply.status.detail).to.contain(`${incorrectDescriptorCid} does not match expected CID`);
      });

      it('should return 401 if auth fails', async () => {
        const alice = await DidKeyResolver.generate();
        alice.keyId = 'wrongValue'; // to fail authentication
        const { message } = await TestDataGenerator.generateProtocolsQuery({ author: alice });

        const reply = await dwn.processMessage(alice.did, message);

        expect(reply.status.code).to.equal(401);
        expect(reply.status.detail).to.contain('not a valid DID');
      });

      it('rejects authenticated non-tenant non-granted ProtocolsConfigures with 401', async () => {
        // Bob tries to ProtocolsConfigure to Alice's DWN without a PermissionsGrant
        const alice = await DidKeyResolver.generate();
        const bob = await DidKeyResolver.generate();

        const protocolsQuery = await TestDataGenerator.generateProtocolsQuery({
          author: bob,
        });
        const protocolsQueryReply = await dwn.processMessage(alice.did, protocolsQuery.message);
        expect(protocolsQueryReply.status.code).to.equal(401);
        expect(protocolsQueryReply.status.detail).to.contain(DwnErrorCode.ProtocolsQueryUnauthorized);
      });

      describe('Grant authorization', () => {
        it('allows an external party to ProtocolsConfigure if they have an active grant', async () => {
          // scenario: Alice grants Bob the access to ProtocolsConfigure on her DWN, then Bob does a ProtocolsConfigure
          const alice = await DidKeyResolver.generate();
          const bob = await DidKeyResolver.generate();

          // Alice gives Bob a PermissionsGrant with scope ProtocolsConfigure
          const permissionsGrant = await TestDataGenerator.generatePermissionsGrant({
            author     : alice,
            grantedBy  : alice.did,
            grantedFor : alice.did,
            grantedTo  : bob.did,
            scope      : {
              interface : DwnInterfaceName.Protocols,
              method    : DwnMethodName.Query,
            }
          });
          const permissionsGrantReply = await dwn.processMessage(alice.did, permissionsGrant.message);
          expect(permissionsGrantReply.status.code).to.equal(202);

          // Bob does ProtocolsConfigure on Alice's DWN
          const protocolsQuery = await TestDataGenerator.generateProtocolsQuery({
            author             : bob,
            permissionsGrantId : await Message.getCid(permissionsGrant.message),
          });
          const protocolsQueryReply = await dwn.processMessage(alice.did, protocolsQuery.message);
          expect(protocolsQueryReply.status.code).to.equal(200);
        });

        it('rejects with 401 an external party attempt to ProtocolsConfigure if they present an expired grant', async () => {
          // scenario: Alice grants Bob access to ProtocolsConfigure, but when Bob invokes the grant it has expired
          const alice = await DidKeyResolver.generate();
          const bob = await DidKeyResolver.generate();

          // Alice gives Bob a PermissionsGrant with scope ProtocolsConfigure and an expiry time
          const dateGranted = getCurrentTimeInHighPrecision();
          const dateExpires = getCurrentTimeInHighPrecision();
          const permissionsGrant = await TestDataGenerator.generatePermissionsGrant({
            author           : alice,
            messageTimestamp : dateGranted,
            dateExpires,
            grantedBy        : alice.did,
            grantedFor       : alice.did,
            grantedTo        : bob.did,
            scope            : {
              interface : DwnInterfaceName.Protocols,
              method    : DwnMethodName.Query,
            }
          });
          const permissionsGrantReply = await dwn.processMessage(alice.did, permissionsGrant.message);
          expect(permissionsGrantReply.status.code).to.equal(202);

          // Bob does ProtocolsConfigure after the grant has expired
          const protocolsQuery = await TestDataGenerator.generateProtocolsQuery({
            author             : bob,
            permissionsGrantId : await Message.getCid(permissionsGrant.message),
          });
          const protocolsQueryReply = await dwn.processMessage(alice.did, protocolsQuery.message);
          expect(protocolsQueryReply.status.code).to.equal(401);
          expect(protocolsQueryReply.status.detail).to.contain(DwnErrorCode.GrantAuthorizationGrantExpired);
        });

        it('rejects with 401 an external partys attempt to ProtocolsQuery if the grant is not yet active', async () => {
          // scenario: Alice grants Bob access to ProtocolsConfigure, but Bob's message has a timestamp just before the grant is active

          const alice = await DidKeyResolver.generate();
          const bob = await DidKeyResolver.generate();

          // Set up timestamps
          const protocolsQueryTimestamp = getCurrentTimeInHighPrecision();
          await sleep(2);
          const dateGranted = getCurrentTimeInHighPrecision();

          // Alice gives Bob a PermissionsGrant with scope ProtocolsConfigure
          const permissionsGrant = await TestDataGenerator.generatePermissionsGrant({
            author           : alice,
            messageTimestamp : dateGranted,
            grantedBy        : alice.did,
            grantedFor       : alice.did,
            grantedTo        : bob.did,
            scope            : {
              interface : DwnInterfaceName.Protocols,
              method    : DwnMethodName.Query,
            }
          });
          const permissionsGrantReply = await dwn.processMessage(alice.did, permissionsGrant.message);
          expect(permissionsGrantReply.status.code).to.equal(202);

          // Bob does ProtocolsConfigure but his message has timestamp before the grant is active
          const protocolsQuery = await TestDataGenerator.generateProtocolsQuery({
            author             : bob,
            messageTimestamp   : protocolsQueryTimestamp,
            permissionsGrantId : await Message.getCid(permissionsGrant.message),
          });
          const protocolsQueryReply = await dwn.processMessage(alice.did, protocolsQuery.message);
          expect(protocolsQueryReply.status.code).to.equal(401);
          expect(protocolsQueryReply.status.detail).to.contain(DwnErrorCode.GrantAuthorizationGrantNotYetActive);
        });

        it('rejects with 401 an external partys attempt to ProtocolsQuery if the grant has been revoked', async () => {
          // Alice grants and revokes Bob access to ProtocolsConfigure. Bob tries to invoke the revoked grant

          const alice = await DidKeyResolver.generate();
          const bob = await DidKeyResolver.generate();

          // Alice gives Bob a PermissionsGrant with scope ProtocolsConfigure
          const permissionsGrant = await TestDataGenerator.generatePermissionsGrant({
            author     : alice,
            grantedBy  : alice.did,
            grantedFor : alice.did,
            grantedTo  : bob.did,
            scope      : {
              interface : DwnInterfaceName.Protocols,
              method    : DwnMethodName.Query,
            }
          });
          const permissionsGrantReply = await dwn.processMessage(alice.did, permissionsGrant.message);
          expect(permissionsGrantReply.status.code).to.equal(202);
          const permissionsGrantId = await Message.getCid(permissionsGrant.message);

          // Alice revokes Bob's grant
          const permissionsRevoke = await TestDataGenerator.generatePermissionsRevoke({
            author: alice,
            permissionsGrantId,
          });
          const permissionsRevokeReply = await dwn.processMessage(alice.did, permissionsRevoke.message);
          expect(permissionsRevokeReply.status.code).to.equal(202);

          // Bob does ProtocolsConfigure with the revoked grant
          const protocolsQuery = await TestDataGenerator.generateProtocolsQuery({
            author             : bob,
            permissionsGrantId : await Message.getCid(permissionsGrant.message),
          });
          const protocolsQueryReply = await dwn.processMessage(alice.did, protocolsQuery.message);
          expect(protocolsQueryReply.status.code).to.equal(401);
          expect(protocolsQueryReply.status.detail).to.contain(DwnErrorCode.GrantAuthorizationGrantRevoked);
        });

        it('rejects with 401 an external party attempts to ProtocolsQuery if grant has different DWN interface scope', async () => {
          // scenario: Alice grants Bob access to RecordsRead, then Bob tries to invoke the grant with ProtocolsConfigure

          const alice = await DidKeyResolver.generate();
          const bob = await DidKeyResolver.generate();

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

          // Bob tries to ProtocolsConfigure
          const protocolsQuery = await TestDataGenerator.generateProtocolsQuery({
            author             : bob,
            permissionsGrantId : await Message.getCid(permissionsGrant.message),
          });
          const protocolsQueryReply = await dwn.processMessage(alice.did, protocolsQuery.message);
          expect(protocolsQueryReply.status.code).to.equal(401);
          expect(protocolsQueryReply.status.detail).to.contain(DwnErrorCode.GrantAuthorizationInterfaceMismatch);
        });

        it('rejects with 401 if the PermissionsGrant cannot be found', async () => {
          // scenario: Bob uses a permissionsGrantId to ProtocolsConfigure, but no PermissionsGrant can be found.

          const alice = await DidKeyResolver.generate();
          const bob = await DidKeyResolver.generate();

          // Bob tries to ProtocolsConfigure
          const protocolsQuery = await TestDataGenerator.generateProtocolsQuery({
            author             : bob,
            permissionsGrantId : await TestDataGenerator.randomCborSha256Cid(),
          });
          const protocolsQueryReply = await dwn.processMessage(alice.did, protocolsQuery.message);
          expect(protocolsQueryReply.status.code).to.equal(401);
          expect(protocolsQueryReply.status.detail).to.contain(DwnErrorCode.GrantAuthorizationGrantMissing);
        });

        it('rejects with 401 if the PermissionsGrant has not been grantedTo the author', async () => {
          // Alice gives a PermissionsGrant to Bob, then Carol tries to invoke it to ProtocolsConfigure on Alice's DWN
          const alice = await DidKeyResolver.generate();
          const bob = await DidKeyResolver.generate();
          const carol = await DidKeyResolver.generate();

          // Alice gives Bob a PermissionsGrant with scope ProtocolsConfigure
          const permissionsGrant = await TestDataGenerator.generatePermissionsGrant({
            author     : alice,
            grantedBy  : alice.did,
            grantedFor : alice.did,
            grantedTo  : bob.did,
            scope      : {
              interface : DwnInterfaceName.Protocols,
              method    : DwnMethodName.Query,
            }
          });
          const permissionsGrantReply = await dwn.processMessage(alice.did, permissionsGrant.message);
          expect(permissionsGrantReply.status.code).to.equal(202);

          // Carol tries to use Bob's PermissionsGrant to gain access to Alice's DWN
          const protocolsQuery = await TestDataGenerator.generateProtocolsQuery({
            author             : carol,
            permissionsGrantId : await Message.getCid(permissionsGrant.message),
          });
          const protocolsQueryReply = await dwn.processMessage(alice.did, protocolsQuery.message);
          expect(protocolsQueryReply.status.code).to.equal(401);
          expect(protocolsQueryReply.status.detail).to.contain(DwnErrorCode.GrantAuthorizationNotGrantedToAuthor);
        });

        it('rejects with 401 if the PermissionsGrant has not been grantedFor the tenant', async () => {
          // Alice gives a PermissionsGrant to Carol, which Bob stores on his DWN.
          // Then Carol tries to invoke it to ProtocolsConfigure on Bob's DWN.
          const alice = await DidKeyResolver.generate();
          const bob = await DidKeyResolver.generate();
          const carol = await DidKeyResolver.generate();

          // Alice gives Bob a PermissionsGrant with scope ProtocolsConfigure
          const permissionsGrant = await TestDataGenerator.generatePermissionsGrant({
            author     : alice,
            grantedBy  : alice.did,
            grantedFor : alice.did,
            grantedTo  : carol.did,
            scope      : {
              interface : DwnInterfaceName.Protocols,
              method    : DwnMethodName.Query,
            }
          });
          const permissionsGrantReply = await dwn.processMessage(bob.did, permissionsGrant.message);
          expect(permissionsGrantReply.status.code).to.equal(202);

          // Carol tries to use Bob's PermissionsGrant to gain access to Bob's DWN
          const protocolsQuery = await TestDataGenerator.generateProtocolsQuery({
            author             : carol,
            permissionsGrantId : await Message.getCid(permissionsGrant.message),
          });
          const protocolsQueryReply = await dwn.processMessage(bob.did, protocolsQuery.message);
          expect(protocolsQueryReply.status.code).to.equal(401);
          expect(protocolsQueryReply.status.detail).to.contain(DwnErrorCode.GrantAuthorizationNotGrantedForTenant);
        });
      });
    });
  });
}