import type {
  DataStore,
  EventLog,
  MessageStore
} from '../../src/index.js';

import sinon from 'sinon';

import { DidKeyResolver } from '../../src/did/did-key-resolver.js';
import { DidResolver } from '../../src/did/did-resolver.js';
import { Dwn } from '../../src/dwn.js';
import { DwnErrorCode } from '../../src/core/dwn-error.js';
import { expect } from 'chai';
import { Message } from '../../src/core/message.js';
import { PermissionsGrant } from '../../src/interfaces/permissions-grant.js';
import { PermissionsGrantHandler } from '../../src/handlers/permissions-grant.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestStoreInitializer } from '../test-store-initializer.js';

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