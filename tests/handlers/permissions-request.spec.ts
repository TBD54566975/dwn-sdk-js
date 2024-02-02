import type { EventStream } from '../../src/types/subscriptions.js';
import type {
  DataStore,
  EventLog,
  MessageStore
} from '../../src/index.js';

import { expect } from 'chai';
import sinon from 'sinon';

import { Dwn } from '../../src/dwn.js';
import { Message } from '../../src/core/message.js';
import { PermissionsRequest } from '../../src/interfaces/permissions-request.js';
import { PermissionsRequestHandler } from '../../src/handlers/permissions-request.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestEventStream } from '../test-event-stream.js';
import { TestStores } from '../test-stores.js';
import { DidKey, DidResolver } from '@web5/dids';
import { DwnErrorCode, DwnInterfaceName, DwnMethodName } from '../../src/index.js';

export function testPermissionsRequestHandler(): void {
  describe('PermissionsRequestHandler.handle()', () => {
    let didResolver: DidResolver;
    let messageStore: MessageStore;
    let dataStore: DataStore;
    let eventLog: EventLog;
    let eventStream: EventStream;
    let dwn: Dwn;

    describe('functional tests', () => {

      // important to follow the `before` and `after` pattern to initialize and clean the stores in tests
      // so that different test suites can reuse the same backend store for testing
      before(async () => {
        didResolver = new DidResolver({ didResolvers: [DidKey] });

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

      it('should accept a PermissionsRequest with conditions omitted', async () => {
      // scenario: Bob sends a PermissionsRequest to Alice's DWN
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const bob = await TestDataGenerator.generateDidKeyPersona();

        const { message } = await TestDataGenerator.generatePermissionsRequest({
          author      : bob,
          description : 'Please allow me to RecordsWrite',
          grantedBy   : alice.did,
          grantedTo   : bob.did,
          grantedFor  : alice.did,
          scope       : {
            interface : DwnInterfaceName.Records,
            method    : DwnMethodName.Write,
          },
        });

        const reply = await dwn.processMessage(alice.did, message);
        expect(reply.status.code).to.equal(202);
      });

      it('should return 401 if auth fails', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const { message } = await TestDataGenerator.generatePermissionsRequest({
          author : alice,
          scope  : {
            interface : DwnInterfaceName.Records,
            method    : DwnMethodName.Write,
          }
        });

        // use a bad signature to fail authentication
        const badSignature = await TestDataGenerator.randomSignatureString();
        message.authorization.signature.signatures[0].signature = badSignature;

        const reply = await dwn.processMessage(alice.did, message);
        expect(reply.status.code).to.equal(401);
        expect(reply.status.detail).to.contain(DwnErrorCode.GeneralJwsVerifierInvalidSignature);
      });

      it('should return 400 if failure parsing the message', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const { message } = await TestDataGenerator.generatePermissionsRequest();

        const permissionsRequestHandler = new PermissionsRequestHandler(didResolver, messageStore, eventLog, eventStream);

        // stub the `parse()` function to throw an error
        sinon.stub(PermissionsRequest, 'parse').throws('anyError');
        const reply = await permissionsRequestHandler.handle({ tenant: alice.did, message });

        expect(reply.status.code).to.equal(400);
      });

      describe('event log', () => {
        it('should add event for PermissionsRequest', async () => {
          const alice = await TestDataGenerator.generateDidKeyPersona();
          const { message } = await TestDataGenerator.generatePermissionsRequest({
            author : alice,
            scope  : {
              interface : DwnInterfaceName.Records,
              method    : DwnMethodName.Write,
            },
          });

          const reply = await dwn.processMessage(alice.did, message);
          expect(reply.status.code).to.equal(202);

          const { events } = await eventLog.getEvents(alice.did);
          expect(events.length).to.equal(1);

          const messageCid = await Message.getCid(message);
          expect(events[0]).to.equal(messageCid);
        });

        it('should not add a new event if we have already stored this PermissionsRequest', async () => {
          const alice = await TestDataGenerator.generateDidKeyPersona();
          const { message } = await TestDataGenerator.generatePermissionsRequest({
            author : alice,
            scope  : {
              interface : DwnInterfaceName.Records,
              method    : DwnMethodName.Write,
            },
          });

          let reply = await dwn.processMessage(alice.did, message);
          expect(reply.status.code).to.equal(202);

          reply = await dwn.processMessage(alice.did, message);
          expect(reply.status.code).to.equal(202);

          const { events } = await eventLog.getEvents(alice.did);
          expect(events.length).to.equal(1);

          const messageCid = await Message.getCid(message);
          expect(events[0]).to.equal(messageCid);
        });
      });
    });
  });
}