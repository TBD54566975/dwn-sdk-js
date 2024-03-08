import type { EventStream } from '../../src/types/subscriptions.js';
import type { ProtocolDefinition } from '../../src/types/protocols-types.js';
import type { DataStore, EventLog, MessageStore } from '../../src/index.js';

import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import chai, { expect } from 'chai';

import { DataStream } from '../../src/utils/data-stream.js';
import { DidKey } from '@web5/dids';
import { DidResolver } from '@web5/dids';
import { Dwn } from '../../src/dwn.js';
import { Jws } from '../../src/utils/jws.js';
import { ProtocolAction } from '../../src/types/protocols-types.js';
import { RecordsWrite } from '../../src/interfaces/records-write.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestEventStream } from '../test-event-stream.js';
import { TestStores } from '../test-stores.js';

import { DwnErrorCode, ProtocolsConfigure } from '../../src/index.js';

chai.use(chaiAsPromised);

export function testProtocolCreateAction(): void {
  describe('Protocol `create` action', () => {
    let didResolver: DidResolver;
    let messageStore: MessageStore;
    let dataStore: DataStore;
    let eventLog: EventLog;
    let eventStream: EventStream;
    let dwn: Dwn;

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

    it('should process "create" rule correctly', async () => {
      // scenario:
      // verify requester cannot create without a matching "create" rule
      // verify role authorized create rule
      // verify authorized author of ancestor create rule
      // verify authorized recipient of ancestor create rule
      // verify anyone can create rule
      // verify create rule does not grant subsequent write (update)

      const alice = await TestDataGenerator.generateDidKeyPersona();
      const bob = await TestDataGenerator.generateDidKeyPersona();
      const carol = await TestDataGenerator.generateDidKeyPersona();
      const daniel = await TestDataGenerator.generateDidKeyPersona();

      // Alice installs a protocol with "can create" rules
      const protocolDefinition: ProtocolDefinition = {
        protocol  : 'foo-bar-baz',
        published : true,
        types     : {
          admin : {},
          foo   : {},
          bar   : {},
          baz   : {}
        },
        structure: {
          admin: {
            $role: true
          },
          foo: {
            $actions: [
              {
                role : 'admin',
                can  : [ProtocolAction.Create]
              },
            ],
            bar: {
              $actions: [
                {
                  who : 'author',
                  of  : 'foo',
                  can : [ProtocolAction.Create]
                },
                {
                  who : 'recipient',
                  of  : 'foo',
                  can : [ProtocolAction.Create]
                }
              ],
              baz: {
                $actions: [
                  {
                    who : 'anyone',
                    can : [ProtocolAction.Create]
                  }
                ],
              }
            }
          }
        }
      };
      const protocolsConfig = await ProtocolsConfigure.create({
        definition : protocolDefinition,
        signer     : Jws.createSigner(alice)
      });

      const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
      expect(protocolsConfigureReply.status.code).to.equal(202);

      // Verify Bob cannot create a record without a matching create rule
      const bobFooBytes = TestDataGenerator.randomBytes(100);
      const bobUnauthorizedWrite = await RecordsWrite.create(
        {
          signer       : Jws.createSigner(bob),
          recipient    : carol.did,
          protocol     : protocolDefinition.protocol,
          protocolPath : 'foo',
          schema       : 'any-schema',
          dataFormat   : 'any-format',
          data         : bobFooBytes
        }
      );

      const bobUnauthorizedCreateReply
        = await dwn.processMessage(alice.did, bobUnauthorizedWrite.message, { dataStream: DataStream.fromBytes(bobFooBytes) });
      expect(bobUnauthorizedCreateReply.status.code).to.equal(401);
      expect(bobUnauthorizedCreateReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationActionNotAllowed);

      // Alice gives Bob the "admin" role to be able to write `foo` records.
      const adminBobRecordsWrite = await TestDataGenerator.generateRecordsWrite({
        author       : alice,
        recipient    : bob.did,
        protocol     : protocolDefinition.protocol,
        protocolPath : 'admin'
      });
      const adminBobRecordsWriteReply
        = await dwn.processMessage(alice.did, adminBobRecordsWrite.message, { dataStream: adminBobRecordsWrite.dataStream });
      expect(adminBobRecordsWriteReply.status.code).to.equal(202);

      // Verify that Bob can create `foo` by invoking the admin role.
      const bobRoleAuthorizedFoo = await RecordsWrite.create(
        {
          signer       : Jws.createSigner(bob),
          recipient    : carol.did,
          protocolRole : 'admin',
          protocol     : protocolDefinition.protocol,
          protocolPath : 'foo',
          schema       : 'any-schema',
          dataFormat   : 'any-format',
          data         : bobFooBytes
        }
      );
      const bobRoleAuthorizedCreateReply
        = await dwn.processMessage(alice.did, bobRoleAuthorizedFoo.message, { dataStream: DataStream.fromBytes(bobFooBytes) });
      expect(bobRoleAuthorizedCreateReply.status.code).to.equal(202);

      // Verify that Bob cannot update `foo`
      const bobUnauthorizedFooUpdate = await RecordsWrite.createFrom(
        {
          recordsWriteMessage : bobRoleAuthorizedFoo.message,
          dataFormat          : `any-new-format`,
          signer              : Jws.createSigner(bob)
        }
      );
      const bobUnauthorizedFooUpdateReply
        = await dwn.processMessage(alice.did, bobUnauthorizedFooUpdate.message);
      expect(bobUnauthorizedFooUpdateReply.status.code).to.equal(401);
      expect(bobUnauthorizedFooUpdateReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationActionNotAllowed);

      // Verify that Bob can create `bar` as the author of the ancestor `foo`
      const bobBarBytes = TestDataGenerator.randomBytes(100);
      const bobAuthorAuthorizedBar = await RecordsWrite.create(
        {
          signer          : Jws.createSigner(bob),
          protocol        : protocolDefinition.protocol,
          protocolPath    : 'foo/bar',
          parentContextId : bobRoleAuthorizedFoo.message.contextId,
          schema          : 'any-schema',
          dataFormat      : 'any-format',
          data            : bobBarBytes
        }
      );
      const bobBarCreateReply
        = await dwn.processMessage(alice.did, bobAuthorAuthorizedBar.message, { dataStream: DataStream.fromBytes(bobBarBytes) });
      expect(bobBarCreateReply.status.code).to.equal(202);

      // Verify that Bob cannot update `bar`
      const bobUnauthorizedBarUpdate = await RecordsWrite.createFrom(
        {
          recordsWriteMessage : bobAuthorAuthorizedBar.message,
          dataFormat          : `any-new-format`,
          signer              : Jws.createSigner(bob)
        }
      );
      const bobUnauthorizedBarUpdateReply
        = await dwn.processMessage(alice.did, bobUnauthorizedBarUpdate.message);
      expect(bobUnauthorizedBarUpdateReply.status.code).to.equal(401);
      expect(bobUnauthorizedBarUpdateReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationActionNotAllowed);

      // Verify that Carol can create `bar` as the recipient of the ancestor `foo`
      const carolBarBytes = TestDataGenerator.randomBytes(100);
      const carolRecipientAuthorizedBar = await RecordsWrite.create(
        {
          signer          : Jws.createSigner(carol),
          protocol        : protocolDefinition.protocol,
          protocolPath    : 'foo/bar',
          parentContextId : bobRoleAuthorizedFoo.message.contextId,
          schema          : 'any-schema',
          dataFormat      : 'any-format',
          data            : carolBarBytes
        }
      );
      const carolBarCreateReply
        = await dwn.processMessage(alice.did, carolRecipientAuthorizedBar.message, { dataStream: DataStream.fromBytes(carolBarBytes) });
      expect(carolBarCreateReply.status.code).to.equal(202);

      // Verify that Carol cannot update `bar`
      const carolUnauthorizedBarUpdate = await RecordsWrite.createFrom(
        {
          recordsWriteMessage : carolRecipientAuthorizedBar.message,
          dataFormat          : `any-new-format`,
          signer              : Jws.createSigner(carol)
        }
      );
      const carolUnauthorizedBarUpdateReply
        = await dwn.processMessage(alice.did, carolUnauthorizedBarUpdate.message);
      expect(carolUnauthorizedBarUpdateReply.status.code).to.equal(401);
      expect(carolUnauthorizedBarUpdateReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationActionNotAllowed);

      // Verify that Daniel cannot create `bar` as no create rule applies to him
      const danielBarBytes = TestDataGenerator.randomBytes(100);
      const danielUnauthorizedBar = await RecordsWrite.create(
        {
          signer          : Jws.createSigner(daniel),
          protocol        : protocolDefinition.protocol,
          protocolPath    : 'foo/bar',
          parentContextId : bobRoleAuthorizedFoo.message.contextId,
          schema          : 'any-schema',
          dataFormat      : 'any-format',
          data            : danielBarBytes
        }
      );
      const danielUnauthorizedBarCreateReply
        = await dwn.processMessage(alice.did, danielUnauthorizedBar.message, { dataStream: DataStream.fromBytes(danielBarBytes) });
      expect(danielUnauthorizedBarCreateReply.status.code).to.equal(401);
      expect(danielUnauthorizedBarCreateReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationActionNotAllowed);

      // Verify anyone can create `baz`
      const danielBazBytes = TestDataGenerator.randomBytes(100);
      const danielAnyoneAuthorizedBar = await RecordsWrite.create(
        {
          signer          : Jws.createSigner(daniel),
          protocol        : protocolDefinition.protocol,
          protocolPath    : 'foo/bar/baz',
          parentContextId : carolRecipientAuthorizedBar.message.contextId,
          schema          : 'any-schema',
          dataFormat      : 'any-format',
          data            : danielBazBytes
        }
      );
      const danielBazCreateReply
        = await dwn.processMessage(alice.did, danielAnyoneAuthorizedBar.message, { dataStream: DataStream.fromBytes(danielBazBytes) });
      expect(danielBazCreateReply.status.code).to.equal(202);

      // Verify that Daniel cannot update `baz`
      const danielUnauthorizedBazUpdate = await RecordsWrite.createFrom(
        {
          recordsWriteMessage : bobAuthorAuthorizedBar.message,
          dataFormat          : `any-new-format`,
          signer              : Jws.createSigner(daniel)
        }
      );
      const danielUnauthorizedBazUpdateReply
        = await dwn.processMessage(alice.did, danielUnauthorizedBazUpdate.message);
      expect(danielUnauthorizedBazUpdateReply.status.code).to.equal(401);
      expect(danielUnauthorizedBazUpdateReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationActionNotAllowed);
    });
  });
}