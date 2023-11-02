import type {
  DataStore,
  EventLog,
  MessageStore } from '../../src/index.js';


import sinon from 'sinon';

import { DidKeyResolver } from '../../src/did/did-key-resolver.js';
import { DidResolver } from '../../src/did/did-resolver.js';
import { Dwn } from '../../src/dwn.js';
import { DwnErrorCode } from '../../src/core/dwn-error.js';
import { expect } from 'chai';
import { Jws } from '../../src/index.js';
import { PermissionsGrant } from '../../src/interfaces/permissions-grant.js';
import { PermissionsGrantHandler } from '../../src/handlers/permissions-grant.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestStores } from '../test-stores.js';
import { Time } from '../../src/utils/time.js';
import { DwnInterfaceName, DwnMethodName, Message } from '../../src/core/message.js';

export function testPermissionsGrantHandler(): void {
  describe('PermissionsGrantHandler.handle()', () => {
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

      it('should accept a PermissionsGrant with permissionsRequestId omitted', async () => {
        const alice = await DidKeyResolver.generate();

        const { message } = await TestDataGenerator.generatePermissionsGrant({
          author     : alice,
          grantedBy  : alice.did,
          grantedFor : alice.did,
        });

        const reply = await dwn.processMessage(alice.did, message);
        expect(reply.status.code).to.equal(202);
      });

      it('should accept a PermissionsGrant with associated PermissionsRequest', async () => {
        const alice = await DidKeyResolver.generate();

        const { permissionsRequest } = await TestDataGenerator.generatePermissionsRequest({
          author: alice,
        });
        const permissionsRequestReply = await dwn.processMessage(alice.did, permissionsRequest.message);
        expect(permissionsRequestReply.status.code).to.equal(202);

        const { permissionsGrant } = await TestDataGenerator.generatePermissionsGrant({
          author               : alice,
          grantedBy            : alice.did,
          grantedFor           : alice.did,
          permissionsRequestId : await Message.getCid(permissionsRequest.message),
        });

        const permissionsGrantReply = await dwn.processMessage(alice.did, permissionsGrant.message);
        expect(permissionsGrantReply.status.code).to.equal(202);
      });

      it('should return 401 if authentication fails', async () => {
        const alice = await DidKeyResolver.generate();
        alice.keyId = 'wrongValue'; // to fail authentication
        const { message } = await TestDataGenerator.generatePermissionsGrant({
          author: alice,
        });

        const reply = await dwn.processMessage(alice.did, message);
        expect(reply.status.code).to.equal(401);
        expect(reply.status.detail).to.contain('not a valid DID');
      });

      it('should reject if author does not match grantedBy', async () => {
        const alice = await DidKeyResolver.generate();
        const bob = await DidKeyResolver.generate();

        const { message } = await TestDataGenerator.generatePermissionsGrant({
          author    : alice,
          grantedBy : bob.did,
        });

        const reply = await dwn.processMessage(alice.did, message);
        expect(reply.status.code).to.equal(401);
        expect(reply.status.detail).to.contain(DwnErrorCode.PermissionsGrantGrantedByMismatch);
      });

      it('should reject if grantedBy is not a delegate and does not match grantedFor', async () => {
        const alice = await DidKeyResolver.generate();
        const bob = await DidKeyResolver.generate();

        const { message } = await TestDataGenerator.generatePermissionsGrant({
          author     : alice,
          grantedBy  : alice.did,
          grantedFor : bob.did,
        });

        const reply = await dwn.processMessage(alice.did, message);
        expect(reply.status.code).to.equal(401);
        expect(reply.status.detail).to.contain(DwnErrorCode.PermissionsGrantUnauthorizedGrant);
      });

      it('should return 400 if failure parsing the message', async () => {
        const alice = await DidKeyResolver.generate();
        const { message } = await TestDataGenerator.generatePermissionsGrant();

        const permissionsRequestHandler = new PermissionsGrantHandler(didResolver, messageStore, eventLog);

        // stub the `parse()` function to throw an error
        sinon.stub(PermissionsGrant, 'parse').throws('anyError');
        const reply = await permissionsRequestHandler.handle({ tenant: alice.did, message });

        expect(reply.status.code).to.equal(400);
      });

      describe('scope validation', () => {
        it('ensures that `schema` and protocol related fields `protocol`, `contextId` or `protocolPath` are not both present', async () => {
          const alice = await DidKeyResolver.generate();

          // Options to create a grant with `schema` in its `scope`
          const permissionsGrantBaseOptions = {
            author      : alice,
            dateExpires : Time.getCurrentTimestamp(),
            grantedBy   : 'did:jank:bob',
            grantedTo   : 'did:jank:alice',
            grantedFor  : 'did:jank:bob',
            scope       : {
              interface : DwnInterfaceName.Records,
              method    : DwnMethodName.Write,
            }
          };

          // `schema` and `protocol` may not both be present in grant `scope`
          const schemaAndProtocolGrant = await TestDataGenerator.generatePermissionsGrant(permissionsGrantBaseOptions);

          // Add `protocol` to `scope` and re-sign because validations upon message creation will reject it.
          schemaAndProtocolGrant.message.descriptor.scope = {
            interface : DwnInterfaceName.Records,
            method    : DwnMethodName.Write,
            schema    : 'some-schema',
            protocol  : 'some-protocol'
          };
          schemaAndProtocolGrant.message.authorization = await Message.createAuthorization(
            schemaAndProtocolGrant.message.descriptor,
            Jws.createSigner(alice)
          );
          const schemaAndProtocolGrantReply = await dwn.processMessage(alice.did, schemaAndProtocolGrant.message);
          expect(schemaAndProtocolGrantReply.status.code).to.eq(400);
          expect(schemaAndProtocolGrantReply.status.detail).to.contain(DwnErrorCode.PermissionsGrantScopeSchemaProhibitedFields);

          // `schema` and `contextId` may not both be present in grant `scope`
          const schemaAndContextIdGrant = await TestDataGenerator.generatePermissionsGrant(permissionsGrantBaseOptions);

          // Add `contextId` to `scope` and re-sign because validations upon message creation will reject it.
          schemaAndContextIdGrant.message.descriptor.scope = {
            interface : DwnInterfaceName.Records,
            method    : DwnMethodName.Write,
            schema    : 'some-schema',
            contextId : 'some-context-id'
          };
          schemaAndContextIdGrant.message.authorization = await Message.createAuthorization(
            schemaAndContextIdGrant.message.descriptor,
            Jws.createSigner(alice)
          );
          const schemaAndContextIdGrantReply = await dwn.processMessage(alice.did, schemaAndProtocolGrant.message);
          expect(schemaAndContextIdGrantReply.status.code).to.eq(400);
          expect(schemaAndContextIdGrantReply.status.detail).to.contain(DwnErrorCode.PermissionsGrantScopeSchemaProhibitedFields);

          // `schema` and `protocolPath` may not both be present in grant `scope`
          const schemaAndProtocolPathGrant = await TestDataGenerator.generatePermissionsGrant(permissionsGrantBaseOptions);

          // Add `protocolPath` to `scope` and re-sign because validations upon message creation will reject it.
          schemaAndProtocolPathGrant.message.descriptor.scope = {
            interface    : DwnInterfaceName.Records,
            method       : DwnMethodName.Write,
            schema       : 'some-schema',
            protocolPath : 'some-protocol-path'
          };
          schemaAndProtocolPathGrant.message.authorization = await Message.createAuthorization(
            schemaAndProtocolPathGrant.message.descriptor,
            Jws.createSigner(alice)
          );
          const schemaAndProtocolPathGrantReply = await dwn.processMessage(alice.did, schemaAndProtocolGrant.message);
          expect(schemaAndProtocolPathGrantReply.status.code).to.eq(400);
          expect(schemaAndProtocolPathGrantReply.status.detail).to.contain(DwnErrorCode.PermissionsGrantScopeSchemaProhibitedFields);
        });

        it('ensures that `contextId` and `protocolPath` are not both present in grant scope', async () => {
          const alice = await DidKeyResolver.generate();

          const contextIdAndProtocolPathGrant = await TestDataGenerator.generatePermissionsGrant({
            author      : alice,
            dateExpires : Time.getCurrentTimestamp(),
            grantedBy   : 'did:jank:bob',
            grantedTo   : 'did:jank:alice',
            grantedFor  : 'did:jank:bob',
            scope       : {
              interface : DwnInterfaceName.Records,
              method    : DwnMethodName.Write,
            }
          });

          // Add `protocolPath` and `contextId` to `scope` and re-sign because validations upon message creation will reject it.
          contextIdAndProtocolPathGrant.message.descriptor.scope = {
            interface    : DwnInterfaceName.Records,
            method       : DwnMethodName.Write,
            protocol     : 'some-protocol',
            contextId    : 'some-context-id',
            protocolPath : 'some-protocol-path',
          };
          contextIdAndProtocolPathGrant.message.authorization = await Message.createAuthorization(
            contextIdAndProtocolPathGrant.message.descriptor,
            Jws.createSigner(alice)
          );
          const contextIdAndProtocolPathGrantReply = await dwn.processMessage(alice.did, contextIdAndProtocolPathGrant.message);
          expect(contextIdAndProtocolPathGrantReply.status.code).to.eq(400);
          expect(contextIdAndProtocolPathGrantReply.status.detail).to.contain(DwnErrorCode.PermissionsGrantScopeContextIdAndProtocolPath);
        });
      });

      describe('event log', () => {
        it('should add event for PermissionsGrant', async () => {
          const alice = await DidKeyResolver.generate();
          const { message } = await TestDataGenerator.generatePermissionsGrant({
            author    : alice,
            grantedBy : alice.did,
          });

          const reply = await dwn.processMessage(alice.did, message);
          expect(reply.status.code).to.equal(202);

          const events = await eventLog.getEvents(alice.did);
          expect(events.length).to.equal(1);

          const messageCid = await Message.getCid(message);
          expect(events[0].messageCid).to.equal(messageCid);
        });

        it('should not add a new event if we have already stored this PermissionsRequest', async () => {
          const alice = await DidKeyResolver.generate();
          const { message } = await TestDataGenerator.generatePermissionsGrant({
            author    : alice,
            grantedBy : alice.did,
          });

          let reply = await dwn.processMessage(alice.did, message);
          expect(reply.status.code).to.equal(202);

          reply = await dwn.processMessage(alice.did, message);
          expect(reply.status.code).to.equal(202);

          const events = await eventLog.getEvents(alice.did);
          expect(events.length).to.equal(1);

          const messageCid = await Message.getCid(message);
          expect(events[0].messageCid).to.equal(messageCid);
        });
      });
    });
  });
}