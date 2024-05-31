import type { DidResolver } from '@web5/dids';
import type { EventStream } from '../../src/types/subscriptions.js';
import type {
  DataStore,
  EventLog,
  MessageStore,
  ResumableTaskStore,
} from '../../src/index.js';

import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import chai, { expect } from 'chai';

import messageProtocolDefinition from '../vectors/protocol-definitions/message.json' assert { type: 'json' };
import nestedProtocolDefinition from '../vectors/protocol-definitions/nested.json' assert { type: 'json' };

import { DwnInterfaceName } from '../../src/enums/dwn-interface-method.js';
import { Message } from '../../src/core/message.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestEventStream } from '../test-event-stream.js';
import { TestStores } from '../test-stores.js';
import { DataStream, Dwn, DwnConstant, DwnErrorCode, Jws, ProtocolsConfigure, RecordsDelete, RecordsQuery, RecordsWrite, SortDirection } from '../../src/index.js';
import { DidKey, UniversalResolver } from '@web5/dids';

chai.use(chaiAsPromised);

export function testRecordsPrune(): void {
  describe('records pruning', () => {
    let didResolver: DidResolver;
    let messageStore: MessageStore;
    let dataStore: DataStore;
    let resumableTaskStore: ResumableTaskStore;
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

    it('should purge all descendants when given RecordsDelete with `prune` set to `true`', async () => {
      const alice = await TestDataGenerator.generateDidKeyPersona();

      // install a protocol with foo <- bar <- baz structure
      const nestedProtocol = nestedProtocolDefinition;
      const protocolsConfig = await ProtocolsConfigure.create({
        definition : nestedProtocol,
        signer     : Jws.createSigner(alice)
      });
      const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
      expect(protocolsConfigureReply.status.code).to.equal(202);

      // writes 2 foos, 2 bars under foo1, and 2 bazes under bar1

      // write 2 foos
      const fooData = TestDataGenerator.randomBytes(100);
      const fooOptions = {
        signer       : Jws.createSigner(alice),
        protocol     : nestedProtocol.protocol,
        protocolPath : 'foo',
        schema       : nestedProtocol.types.foo.schema,
        dataFormat   : nestedProtocol.types.foo.dataFormats[0],
        data         : fooData
      };

      const foo1 = await RecordsWrite.create(fooOptions);
      const foo1WriteResponse = await dwn.processMessage(alice.did, foo1.message, { dataStream: DataStream.fromBytes(fooData) });
      expect(foo1WriteResponse.status.code).equals(202);

      const foo2 = await RecordsWrite.create(fooOptions);
      const foo2WriteResponse = await dwn.processMessage(alice.did, foo2.message, { dataStream: DataStream.fromBytes(fooData) });
      expect(foo2WriteResponse.status.code).equals(202);

      // write 2 bars under foo1 with data large enough to be required to be stored in the data store so we can test purge in data store
      const barData = TestDataGenerator.randomBytes(DwnConstant.maxDataSizeAllowedToBeEncoded + 1);
      const barOptions = {
        signer          : Jws.createSigner(alice),
        protocol        : nestedProtocol.protocol,
        protocolPath    : 'foo/bar',
        schema          : nestedProtocol.types.bar.schema,
        dataFormat      : nestedProtocol.types.bar.dataFormats[0],
        parentContextId : foo1.message.contextId,
        data            : barData
      };

      const bar1 = await RecordsWrite.create({ ...barOptions });
      const bar1WriteResponse = await dwn.processMessage(alice.did, bar1.message, { dataStream: DataStream.fromBytes(barData) });
      expect(bar1WriteResponse.status.code).equals(202);

      const bar2 = await RecordsWrite.create({ ...barOptions });
      const bar2WriteResponse = await dwn.processMessage(alice.did, bar2.message, { dataStream: DataStream.fromBytes(barData) });
      expect(bar2WriteResponse.status.code).equals(202);

      // write 2 bazes under bar1, each has more than 1 message associated with the record so we can test multi-message purge
      const bazData = TestDataGenerator.randomBytes(100);
      const bazOptions = {
        signer          : Jws.createSigner(alice),
        protocol        : nestedProtocol.protocol,
        protocolPath    : 'foo/bar/baz',
        schema          : nestedProtocol.types.baz.schema,
        dataFormat      : nestedProtocol.types.baz.dataFormats[0],
        parentContextId : bar1.message.contextId,
        data            : bazData
      };

      const baz1 = await RecordsWrite.create({ ...bazOptions });
      const baz1WriteResponse = await dwn.processMessage(alice.did, baz1.message, { dataStream: DataStream.fromBytes(bazData) });
      expect(baz1WriteResponse.status.code).equals(202);

      const baz2 = await RecordsWrite.create({ ...bazOptions });
      const baz2WriteResponse = await dwn.processMessage(alice.did, baz2.message, { dataStream: DataStream.fromBytes(bazData) });
      expect(baz2WriteResponse.status.code).equals(202);

      // make latest state of baz1 a `RecordsWrite`
      const newBaz1Data = TestDataGenerator.randomBytes(100);
      const baz1Update = await RecordsWrite.createFrom({
        signer              : Jws.createSigner(alice),
        recordsWriteMessage : baz1.message,
        data                : newBaz1Data
      });
      const baz1UpdateResponse = await dwn.processMessage(alice.did, baz1Update.message, { dataStream: DataStream.fromBytes(newBaz1Data) });
      expect(baz1UpdateResponse.status.code).equals(202);

      // make latest state of baz2 a `RecordsDelete`
      const baz2Delete = await RecordsDelete.create({
        signer   : Jws.createSigner(alice),
        recordId : baz2.message.recordId
      });
      const baz2DeleteResponse = await dwn.processMessage(alice.did, baz2Delete.message);
      expect(baz2DeleteResponse.status.code).equals(202);

      // sanity test messages are inserted in message store
      const queryFilter = [{
        interface : DwnInterfaceName.Records,
        protocol  : nestedProtocol.protocol
      }];
      const queryResult = await messageStore.query(alice.did, queryFilter);
      expect(queryResult.messages.length).to.equal(8); // 2 foos, 2 bars, 2 bazes x 2 messages each

      // sanity test events are inserted in event log
      const { events } = await eventLog.queryEvents(alice.did, queryFilter);
      expect(events.length).to.equal(8);

      // sanity test data is inserted in data store
      const bar1DataGetResult = await dataStore.get(alice.did, bar1.message.recordId, bar1.message.descriptor.dataCid);
      const bar2DataGetResult = await dataStore.get(alice.did, bar2.message.recordId, bar2.message.descriptor.dataCid);
      expect(bar1DataGetResult).to.not.be.undefined;
      expect(bar2DataGetResult).to.not.be.undefined;

      // Delete foo1 with prune enabled
      const foo1Delete = await RecordsDelete.create({
        recordId : foo1.message.recordId,
        prune    : true,
        signer   : Jws.createSigner(alice)
      });

      const deleteReply = await dwn.processMessage(alice.did, foo1Delete.message);
      expect(deleteReply.status.code).to.equal(202);

      // verify all bar and baz message are permanently deleted
      const queryResult2 = await messageStore.query(alice.did, queryFilter, { messageTimestamp: SortDirection.Ascending });
      expect(queryResult2.messages.length).to.equal(3); // foo2 RecordsWrite, foo1 RecordsWrite and RecordsDelete
      expect(queryResult2.messages[0]).to.deep.include(foo1.message);
      expect(queryResult2.messages[1]).to.deep.include(foo2.message);
      expect(queryResult2.messages[2]).to.deep.include(foo1Delete.message);

      // verify all bar and baz events are permanently deleted
      const { events: events2 } = await eventLog.queryEvents(alice.did, queryFilter);
      expect(events2.length).to.equal(3);
      const foo1RecordsWriteCid = await Message.getCid(foo1.message);
      const foo2RecordsWriteCid = await Message.getCid(foo2.message);
      const foo2RecordsDeleteCid = await Message.getCid(foo1Delete.message);
      expect(events2).to.contain.members([foo1RecordsWriteCid, foo2RecordsWriteCid, foo2RecordsDeleteCid]);

      // verify all bar data are permanently deleted
      const bar1DataGetResult2 = await dataStore.get(alice.did, bar1.message.recordId, bar1.message.descriptor.dataCid);
      const bar2DataGetResult2 = await dataStore.get(alice.did, bar2.message.recordId, bar2.message.descriptor.dataCid);
      expect(bar1DataGetResult2).to.be.undefined;
      expect(bar2DataGetResult2).to.be.undefined;

      // sanity test an external query will no longer return the deleted records
      const queryData = await RecordsQuery.create({
        signer : Jws.createSigner(alice),
        filter : { protocol: nestedProtocol.protocol }
      });
      const reply2 = await dwn.processMessage(alice.did, queryData.message);
      expect(reply2.status.code).to.equal(200);
      expect(reply2.entries?.length).to.equal(1); // only foo2 is left
      expect(reply2.entries![0]).to.deep.include(foo2.message);
    });

    describe('prune and co-prune protocol action', () => {
      it('should only allow a non-owner author to prune if `prune` is allowed and set to `true` in RecordsDelete', async () => {
        // Scenario:
        // 1. Alice installs a protocol allowing others to add and prune records.
        // 2. Bob writes a record + a descendant in Alice's DWN.
        // 3. Verify Bob cannot prune the records if `prune` is not set to `true` in RecordsDelete.
        // 4. Verify Bob can prune the records by setting `prune` to `true` in RecordsDelete.

        const alice = await TestDataGenerator.generateDidKeyPersona();
        const bob = await TestDataGenerator.generateDidKeyPersona();

        // 1. Alice installs a protocol allowing others to add and prune records.
        const protocolDefinition = {
          protocol  : 'http://post-protocol.xyz',
          published : true,
          types     : {
            post       : { },
            attachment : { }
          },
          structure: {
            post: {
              $actions: [
                {
                  who : 'anyone',
                  can : [
                    'create',
                    'prune', // allowing author to prune, but not delete
                    'read'
                  ]
                }
              ],
              attachment: {
                $actions: [
                  {
                    who : 'anyone',
                    can : ['read']
                  },
                  {
                    who : 'author',
                    of  : 'post',
                    can : ['create']
                  }
                ]
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

        // 2. Bob writes a record + a descendant in Alice's DWN.
        const postData = TestDataGenerator.randomBytes(100);
        const postOptions = {
          signer       : Jws.createSigner(bob),
          protocol     : protocolDefinition.protocol,
          protocolPath : 'post',
          dataFormat   : 'application/json',
          data         : postData
        };

        const post = await RecordsWrite.create(postOptions);
        const postWriteResponse = await dwn.processMessage(alice.did, post.message, { dataStream: DataStream.fromBytes(postData) });
        expect(postWriteResponse.status.code).equals(202);

        const attachmentData = TestDataGenerator.randomBytes(100);
        const attachmentOptions = {
          signer          : Jws.createSigner(bob),
          protocol        : protocolDefinition.protocol,
          protocolPath    : 'post/attachment',
          parentContextId : post.message.contextId,
          dataFormat      : 'application/octet-stream',
          data            : attachmentData
        };

        const attachment = await RecordsWrite.create(attachmentOptions);
        const attachmentWriteResponse = await dwn.processMessage(alice.did, attachment.message, { dataStream: DataStream.fromBytes(attachmentData) });
        expect(attachmentWriteResponse.status.code).equals(202);

        // 3. Verify Bob cannot prune the records if `prune` is not set to `true` in RecordsDelete.
        const unauthorizedPostPrune = await RecordsDelete.create({
          recordId : post.message.recordId,
          // prune    : true, // intentionally not setting `prune` to true
          signer   : Jws.createSigner(bob)
        });

        const unauthorizedPostPruneReply = await dwn.processMessage(alice.did, unauthorizedPostPrune.message);
        expect(unauthorizedPostPruneReply.status.code).to.equal(401);
        expect(unauthorizedPostPruneReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationActionNotAllowed);

        // 4. Verify Bob can prune the records by setting `prune` to `true` in RecordsDelete.
        const postPrune = await RecordsDelete.create({
          recordId : post.message.recordId,
          prune    : true,
          signer   : Jws.createSigner(bob)
        });

        const pruneReply = await dwn.processMessage(alice.did, postPrune.message);
        expect(pruneReply.status.code).to.equal(202);

        // sanity test `RecordsQuery` no longer returns the deleted record
        const recordsQuery = await RecordsQuery.create({
          signer : Jws.createSigner(bob),
          filter : { protocol: protocolDefinition.protocol }
        });
        const recordsQueryReply = await dwn.processMessage(alice.did, recordsQuery.message);
        expect(recordsQueryReply.status.code).to.equal(200);
        expect(recordsQueryReply.entries?.length).to.equal(0);
      });

      it('should not allow a non-owner author to prune if `prune` is not an authorized action', async () => {
        // Scenario:
        // 1. Alice installs a protocol allowing others to add records but not prune.
        // 2. Bob writes a record + a descendant in Alice's DWN.
        // 3. Verify Bob cannot prune the records.

        const alice = await TestDataGenerator.generateDidKeyPersona();
        const bob = await TestDataGenerator.generateDidKeyPersona();

        // 1. Alice installs a protocol allowing others to add records but not prune.
        const protocolDefinition = messageProtocolDefinition;
        const protocolsConfig = await ProtocolsConfigure.create({
          definition : protocolDefinition,
          signer     : Jws.createSigner(alice)
        });
        const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
        expect(protocolsConfigureReply.status.code).to.equal(202);

        // 2. Bob writes a record + a descendant in Alice's DWN.
        const messageData = TestDataGenerator.randomBytes(100);
        const messageOptions = {
          signer       : Jws.createSigner(bob),
          protocol     : protocolDefinition.protocol,
          protocolPath : 'message',
          schema       : protocolDefinition.types.message.schema,
          dataFormat   : protocolDefinition.types.message.dataFormats[0],
          data         : messageData
        };

        const message = await RecordsWrite.create(messageOptions);
        const messageWriteResponse = await dwn.processMessage(alice.did, message.message, { dataStream: DataStream.fromBytes(messageData) });
        expect(messageWriteResponse.status.code).equals(202);

        const attachmentData = TestDataGenerator.randomBytes(100);
        const attachmentOptions = {
          signer          : Jws.createSigner(bob),
          protocol        : protocolDefinition.protocol,
          protocolPath    : 'message/attachment',
          parentContextId : message.message.contextId,
          dataFormat      : 'application/octet-stream',
          data            : attachmentData
        };

        const attachment = await RecordsWrite.create(attachmentOptions);
        const attachmentWriteResponse = await dwn.processMessage(alice.did, attachment.message, { dataStream: DataStream.fromBytes(attachmentData) });
        expect(attachmentWriteResponse.status.code).equals(202);

        // 3. Verify Bob cannot prune the records.
        const messagePrune = await RecordsDelete.create({
          recordId : message.message.recordId,
          prune    : true,
          signer   : Jws.createSigner(bob)
        });

        const deleteReply = await dwn.processMessage(alice.did, messagePrune.message);
        expect(deleteReply.status.code).to.equal(401);
        expect(deleteReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationActionNotAllowed);

        // sanity test `RecordsQuery` still returns the records
        const recordsQuery = await RecordsQuery.create({
          signer : Jws.createSigner(alice),
          filter : { protocol: protocolDefinition.protocol }
        });
        const recordsQueryReply = await dwn.processMessage(alice.did, recordsQuery.message);
        expect(recordsQueryReply.status.code).to.equal(200);
        expect(recordsQueryReply.entries?.length).to.equal(2);
      });

      it('should allow a non-author to prune if `co-prune` is allowed and `prune` is set to `true` in RecordsDelete', async () => {
        // Scenario:
        // 1. Alice installs a protocol allowing others to add and prune records.
        // 2. Bob writes a record + a descendant in Alice's DWN.
        // 3. Verify Carol cannot prune the records if `prune` is not set to `true` in RecordsDelete.
        // 4. Verify Carol can prune the records by setting `prune` to `true` in RecordsDelete.

        const alice = await TestDataGenerator.generateDidKeyPersona();
        const bob = await TestDataGenerator.generateDidKeyPersona();
        const carol = await TestDataGenerator.generateDidKeyPersona();

        // 1. Alice installs a protocol allowing others to add and prune records.
        const protocolDefinition = {
          protocol  : 'http://post-protocol.xyz',
          published : true,
          types     : {
            post       : { },
            attachment : { }
          },
          structure: {
            post: {
              $actions: [
                {
                  who : 'anyone',
                  can : [
                    'create',
                    'co-prune', // allowing anyone to prune
                    'read'
                  ]
                }
              ],
              attachment: {
                $actions: [
                  {
                    who : 'anyone',
                    can : [
                      'create',
                      'read'
                    ]
                  }
                ]
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

        // 2. Bob writes a record + a descendant in Alice's DWN.
        const postData = TestDataGenerator.randomBytes(100);
        const postOptions = {
          signer       : Jws.createSigner(bob),
          protocol     : protocolDefinition.protocol,
          protocolPath : 'post',
          dataFormat   : 'application/json',
          data         : postData
        };

        const post = await RecordsWrite.create(postOptions);
        const postWriteResponse = await dwn.processMessage(alice.did, post.message, { dataStream: DataStream.fromBytes(postData) });
        expect(postWriteResponse.status.code).equals(202);

        const attachmentData = TestDataGenerator.randomBytes(100);
        const attachmentOptions = {
          signer          : Jws.createSigner(bob),
          protocol        : protocolDefinition.protocol,
          protocolPath    : 'post/attachment',
          parentContextId : post.message.contextId,
          dataFormat      : 'application/octet-stream',
          data            : attachmentData
        };

        const attachment = await RecordsWrite.create(attachmentOptions);
        const attachmentWriteResponse = await dwn.processMessage(alice.did, attachment.message, { dataStream: DataStream.fromBytes(attachmentData) });
        expect(attachmentWriteResponse.status.code).equals(202);

        // 3. Verify Carol cannot prune the records if `prune` is not set to `true` in RecordsDelete.
        const unauthorizedPostPrune = await RecordsDelete.create({
          recordId : post.message.recordId,
          // prune    : true, // intentionally not setting `prune` to true
          signer   : Jws.createSigner(carol)
        });

        const unauthorizedPostPruneReply = await dwn.processMessage(alice.did, unauthorizedPostPrune.message);
        expect(unauthorizedPostPruneReply.status.code).to.equal(401);
        expect(unauthorizedPostPruneReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationActionNotAllowed);

        // 4. Verify Carol can prune the records by setting `prune` to `true` in RecordsDelete.
        const postPrune = await RecordsDelete.create({
          recordId : post.message.recordId,
          prune    : true,
          signer   : Jws.createSigner(carol)
        });

        const deleteReply = await dwn.processMessage(alice.did, postPrune.message);
        expect(deleteReply.status.code).to.equal(202);

        // sanity test `RecordsQuery` no longer returns the deleted record
        const recordsQuery = await RecordsQuery.create({
          signer : Jws.createSigner(bob),
          filter : { protocol: protocolDefinition.protocol }
        });
        const recordsQueryReply = await dwn.processMessage(alice.did, recordsQuery.message);
        expect(recordsQueryReply.status.code).to.equal(200);
        expect(recordsQueryReply.entries?.length).to.equal(0);
      });

      it('should not allow a non-author to prune if `prune` is allowed but `co-prune` is not allowed', async () => {
        // Scenario:
        // 1. Alice installs a protocol allowing others to add records AND only author to prune.
        // 2. Bob writes a record + a descendant in Alice's DWN.
        // 3. Verify Carol cannot prune the records.

        const alice = await TestDataGenerator.generateDidKeyPersona();
        const bob = await TestDataGenerator.generateDidKeyPersona();
        const carol = await TestDataGenerator.generateDidKeyPersona();

        // 1. Alice installs a protocol allowing others to add records AND only author to prune.
        const protocolDefinition = {
          protocol  : 'http://post-protocol.xyz',
          published : true,
          types     : {
            post       : { },
            attachment : { }
          },
          structure: {
            post: {
              $actions: [
                {
                  who : 'anyone',
                  can : [
                    'create',
                    'prune', // allowing author to prune, but not delete
                    'read'
                  ]
                }
              ],
              attachment: {
                $actions: [
                  {
                    who : 'anyone',
                    can : ['read']
                  },
                  {
                    who : 'author',
                    of  : 'post',
                    can : ['create']
                  }
                ]
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

        // 2. Bob writes a record + a descendant in Alice's DWN.
        const postData = TestDataGenerator.randomBytes(100);
        const postOptions = {
          signer       : Jws.createSigner(bob),
          protocol     : protocolDefinition.protocol,
          protocolPath : 'post',
          dataFormat   : 'application/json',
          data         : postData
        };

        const post = await RecordsWrite.create(postOptions);
        const postWriteResponse = await dwn.processMessage(alice.did, post.message, { dataStream: DataStream.fromBytes(postData) });
        expect(postWriteResponse.status.code).equals(202);

        const attachmentData = TestDataGenerator.randomBytes(100);
        const attachmentOptions = {
          signer          : Jws.createSigner(bob),
          protocol        : protocolDefinition.protocol,
          protocolPath    : 'post/attachment',
          parentContextId : post.message.contextId,
          dataFormat      : 'application/octet-stream',
          data            : attachmentData
        };

        const attachment = await RecordsWrite.create(attachmentOptions);
        const attachmentWriteResponse = await dwn.processMessage(alice.did, attachment.message, { dataStream: DataStream.fromBytes(attachmentData) });
        expect(attachmentWriteResponse.status.code).equals(202);

        // 3. Verify Carol cannot prune the records.
        const postPrune = await RecordsDelete.create({
          recordId : post.message.recordId,
          prune    : true,
          signer   : Jws.createSigner(carol)
        });

        const deleteReply = await dwn.processMessage(alice.did, postPrune.message);
        expect(deleteReply.status.code).to.equal(401);
        expect(deleteReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationActionNotAllowed);

        // sanity test `RecordsQuery` still returns the records
        const recordsQuery = await RecordsQuery.create({
          signer : Jws.createSigner(bob),
          filter : { protocol: protocolDefinition.protocol }
        });
        const recordsQueryReply = await dwn.processMessage(alice.did, recordsQuery.message);
        expect(recordsQueryReply.status.code).to.equal(200);
        expect(recordsQueryReply.entries?.length).to.equal(2);
      });

      it('should throw if only `delete` is allowed but received a RecordsDelete with `prune` set to `true`', async () => {
        // Scenario:
        // 1. Alice installs a protocol allowing others to add and delete (not prune) records.
        // 2. Bob writes a record + a descendant in Alice's DWN.
        // 3. Verify Bob cannot prune the records.

        const alice = await TestDataGenerator.generateDidKeyPersona();
        const bob = await TestDataGenerator.generateDidKeyPersona();

        // 1. Alice installs a protocol allowing others to add and delete (not prune) records.
        const protocolDefinition = {
          protocol  : 'http://post-protocol.xyz',
          published : true,
          types     : {
            post       : { },
            attachment : { }
          },
          structure: {
            post: {
              $actions: [
                {
                  who : 'anyone',
                  can : [
                    'create',
                    'delete', // only allow delete, not prune
                    'read'
                  ]
                }
              ],
              attachment: {
                $actions: [
                  {
                    who : 'anyone',
                    can : [
                      'create',
                      'read'
                    ]
                  }
                ]
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

        // 2. Bob writes a record + a descendant in Alice's DWN.
        const postData = TestDataGenerator.randomBytes(100);
        const postOptions = {
          signer       : Jws.createSigner(bob),
          protocol     : protocolDefinition.protocol,
          protocolPath : 'post',
          dataFormat   : 'application/json',
          data         : postData
        };

        const post = await RecordsWrite.create(postOptions);
        const postWriteResponse = await dwn.processMessage(alice.did, post.message, { dataStream: DataStream.fromBytes(postData) });
        expect(postWriteResponse.status.code).equals(202);

        const attachmentData = TestDataGenerator.randomBytes(100);
        const attachmentOptions = {
          signer          : Jws.createSigner(bob),
          protocol        : protocolDefinition.protocol,
          protocolPath    : 'post/attachment',
          parentContextId : post.message.contextId,
          dataFormat      : 'application/octet-stream',
          data            : attachmentData
        };

        const attachment = await RecordsWrite.create(attachmentOptions);
        const attachmentWriteResponse = await dwn.processMessage(alice.did, attachment.message, { dataStream: DataStream.fromBytes(attachmentData) });
        expect(attachmentWriteResponse.status.code).equals(202);

        // 3. Verify Bob cannot prune the records.
        const unauthorizedPostPrune = await RecordsDelete.create({
          recordId : post.message.recordId,
          prune    : true,
          signer   : Jws.createSigner(bob)
        });

        const unauthorizedPostPruneReply = await dwn.processMessage(alice.did, unauthorizedPostPrune.message);
        expect(unauthorizedPostPruneReply.status.code).to.equal(401);
        expect(unauthorizedPostPruneReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationActionNotAllowed);
      });
    });
  });
}