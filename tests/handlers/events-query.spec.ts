import type { EventsQueryReply } from '../../src/types/event-types.js';
import type { Persona } from '../utils/test-data-generator.js';
import type {
  DataStore,
  EventLog,
  EventsGetReply,
  GenericMessage,
  MessageStore
} from '../../src/index.js';

import contributionReward from '../vectors/protocol-definitions/contribution-reward.json' assert { type: 'json' };
import { expect } from 'chai';
import { normalizeSchemaUrl } from '../../src/utils/url.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestStores } from '../test-stores.js';
import {
  DidKeyResolver,
  DidResolver,
  Dwn,
  DwnInterfaceName,
  DwnMethodName,
  Message
} from '../../src/index.js';


export function testEventsQueryHandler(): void {
  describe('EventsQueryHandler.handle()', () => {
    let didResolver: DidResolver;
    let messageStore: MessageStore;
    let dataStore: DataStore;
    let eventLog: EventLog;
    let dwn: Dwn;

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
    // clean up before each test rather than after so that a test does not depend on other tests to do the clean up
      await messageStore.clear();
      await dataStore.clear();
      await eventLog.clear();
    });

    after(async () => {
      await dwn.close();
    });

    describe('selective sync', () => {
      let author: Persona;
      let grantee: Persona;
      let proto1:string, proto2: string;
      let testWatermark: string;

      // a map of messages and a n array of filter properties they map to.
      const testMessages: Map<GenericMessage, string[]> = new Map();
      const testMessagesAfterWatermark: Map<GenericMessage, string[]> = new Map();

      // initializes a set of various events for filtering returning a watermark to filter after
      // 11 total events
      // proto1 has 4 events total, 1 after the watermark
      // proto2 has 5 events total, 2 after the watermark
      // contribution has 3 events total, 2 after the watermark
      // reward has 5 events total, 3 after the watermark
      // proto1 contribution has 1 events total, 0 after the watermark
      // proto1 reward has 1 event total, 1 after the watermark
      // proto2 contribution has 2 events total, 2 after the watermark
      // proto2 reward has 2 events total, 0 after the watermark
      const initEvents = async (): Promise<string> => {
        // create protocols
        const protoDefinition1 = { ...contributionReward, protocol: 'http://proto1.xyz' };
        const protoConf1 = await TestDataGenerator.generateProtocolsConfigure({
          author,
          protocolDefinition: protoDefinition1
        });
        const protoConf1Response = await dwn.processMessage(author.did, protoConf1.message);
        expect(protoConf1Response.status.code).equals(202);
        proto1 = protoConf1.message.descriptor.definition.protocol;
        testMessages.set(protoConf1.message, [ proto1 ]);

        const protoDefinition2 = { ...contributionReward, protocol: 'http://proto2.xyz' };

        const protoConf2 = await TestDataGenerator.generateProtocolsConfigure({
          author,
          protocolDefinition: protoDefinition2,
        });
        const protoConf2Response = await dwn.processMessage(author.did, protoConf2.message);
        expect(protoConf2Response.status.code).equals(202);
        proto2 = protoConf2.message.descriptor.definition.protocol;
        testMessages.set(protoConf2.message, [ proto2 ]);


        // create some initial writes
        const write1 = await TestDataGenerator.generateRecordsWrite({ author, schema: 'contribution', protocol: proto1, protocolPath: 'contribution' });
        const write1Response = await dwn.processMessage(author.did, write1.message, write1.dataStream);
        expect(write1Response.status.code).equals(202);
        testMessages.set(write1.message, [ proto1, 'contribution' ]);

        const write2 = await TestDataGenerator.generateRecordsWrite({ author, schema: 'reward', protocol: proto2, protocolPath: 'reward' });
        const write2Response = await dwn.processMessage(author.did, write2.message, write2.dataStream);
        expect(write2Response.status.code).equals(202);
        testMessages.set(write2.message, [ proto2, 'reward' ]);

        // delete write2 to show a delete event filtered by protocol
        const deleteForWrite2 = await TestDataGenerator.generateRecordsDelete({ author, recordId: write2.message.recordId });
        const deleteForWrite2Response = await dwn.processMessage(author.did, deleteForWrite2.message);
        expect(deleteForWrite2Response.status.code).equals(202);
        testMessages.set(deleteForWrite2.message, [ proto2, 'reward' ]);

        const grant1 = await TestDataGenerator.generatePermissionsGrant({
          author,
          grantedTo   : grantee.did,
          dateExpires : '2023-12-12T12:12:12.121212Z',
          scope       : { protocol: proto1, interface: DwnInterfaceName.Records, method: DwnMethodName.Read }
        });

        const grant1Response = await dwn.processMessage(author.did, grant1.message);
        expect(grant1Response.status.code).equals(202);
        testMessages.set(grant1.message, [ proto1 ]);

        // get a watermark here for testing;
        let eventsGet = await TestDataGenerator.generateEventsGet({ author });
        const eventsGetResponse = await dwn.processMessage(author.did, eventsGet.message) as EventsGetReply;
        expect(eventsGetResponse.status.code).to.equal(200);
        expect(eventsGetResponse.events?.length).equals(testMessages.size);

        const watermark = eventsGetResponse.events!.at(eventsGetResponse.events!.length - 1)!.watermark;


        //events after the watermark
        const grant2 = await TestDataGenerator.generatePermissionsGrant({
          author,
          dateExpires : '2023-12-13T12:12:12.121212Z',
          scope       : { schema: normalizeSchemaUrl('reward'), interface: DwnInterfaceName.Records, method: DwnMethodName.Read }
        });
        const grant2Response = await dwn.processMessage(author.did, grant2.message);
        expect(grant2Response.status.code).to.equal(202);
        testMessages.set(grant2.message, [ 'reward' ]);
        testMessagesAfterWatermark.set(grant2.message, [ 'reward' ]);

        const write3 = await TestDataGenerator.generateRecordsWrite({ author, schema: 'contribution', protocol: proto2, protocolPath: 'contribution' });
        const write3Response = await dwn.processMessage(author.did, write3.message, write3.dataStream);
        expect(write3Response.status.code).equals(202);
        testMessages.set(write3.message, [ proto2, 'contribution' ]);
        testMessagesAfterWatermark.set(write3.message, [ proto2, 'contribution' ]);

        const write4 = await TestDataGenerator.generateRecordsWrite({ author, schema: 'reward', protocol: proto1, protocolPath: 'reward' });
        const write4Response = await dwn.processMessage(author.did, write4.message, write4.dataStream);
        expect(write4Response.status.code).equals(202);
        testMessages.set(write4.message, [ proto1, 'reward' ]);
        testMessagesAfterWatermark.set(write4.message, [ proto1, 'reward' ]);

        const deleteForWrite3 = await TestDataGenerator.generateRecordsDelete({ author, recordId: write3.message.recordId });
        const deleteForWrite3Response = await dwn.processMessage(author.did, deleteForWrite3.message);
        expect(deleteForWrite3Response.status.code).equals(202);
        testMessages.set(deleteForWrite3.message, [ proto2, 'contribution' ]);
        testMessagesAfterWatermark.set(deleteForWrite3.message, [ proto2, 'contribution' ]);

        const grant2Id = await Message.getCid(grant2.message);
        const revokeForGrant2 = await TestDataGenerator.generatePermissionsRevoke({ author, permissionsGrantId: grant2Id });
        const revokeForGrant2Response = await dwn.processMessage(author.did, revokeForGrant2.message);
        expect(revokeForGrant2Response.status.code).equals(202);
        testMessages.set(revokeForGrant2.message, [ 'reward' ]);
        testMessagesAfterWatermark.set(revokeForGrant2.message, [ 'reward' ]);

        // make sure all messages were logged and indexed
        eventsGet = await TestDataGenerator.generateEventsGet({ author });
        const eventsGetReply = await dwn.processMessage(author.did, eventsGet.message) as EventsGetReply;
        expect(eventsGetReply.status.code).to.equal(200);
        expect(eventsGetReply.events!.length).to.equal(testMessages.size);

        eventsGet = await TestDataGenerator.generateEventsGet({ author, watermark });
        const eventsGetReplyAfterWatermark = await dwn.processMessage(author.did, eventsGet.message) as EventsGetReply;
        expect(eventsGetReplyAfterWatermark.status.code).to.equal(200);
        expect(eventsGetReplyAfterWatermark.events!.length).to.equal(testMessagesAfterWatermark.size);

        return watermark;
      };

      beforeEach(async () => {
        testMessages.clear();
        testMessagesAfterWatermark.clear();
        author = await DidKeyResolver.generate();
        grantee = await DidKeyResolver.generate();
        testWatermark = await initEvents();
      });

      it('filter for events matching a protocol across all message types', async () => {
        // filter for proto1
        const proto1EventsQuery = await TestDataGenerator.generateEventsQuery({ author, filter: { protocol: proto1 } });
        const proto1EventsReply = await dwn.processMessage(author.did, proto1EventsQuery.message) as EventsQueryReply;
        expect(proto1EventsReply.status.code).equals(200);

        //filter for proto 1 messages
        const expectedProto1MessageCids: string[] = [];
        for (const [message, indexes] of testMessages) {
          if (indexes.includes(proto1)) {
            const messageCid = await Message.getCid(message);
            expectedProto1MessageCids.push(messageCid);
          }
        }

        const proto1Events = proto1EventsReply.events!;
        expect(proto1Events.length).to.equal(expectedProto1MessageCids.length);
        expect(proto1Events.every(e => expectedProto1MessageCids.includes(e.messageCid))).to.be.true;

        // filter for proto2
        const proto2EventsQuery = await TestDataGenerator.generateEventsQuery({ author, filter: { protocol: proto2 } });
        const proto2EventsReply = await dwn.processMessage(author.did, proto2EventsQuery.message) as EventsQueryReply;
        expect(proto2EventsReply.status.code).equals(200);

        //filter for proto 1 messages
        const expectedProto2MessageCids: string[] = [];
        for (const [message, indexes] of testMessages) {
          if (indexes.includes(proto2)) {
            const messageCid = await Message.getCid(message);
            expectedProto2MessageCids.push(messageCid);
          }
        }

        const proto2Events = proto2EventsReply.events!;
        expect(proto2Events.length).to.equal(expectedProto2MessageCids.length);
        expect(proto2Events.every(e => expectedProto2MessageCids.includes(e.messageCid))).to.be.true;
      });

      it('filter for events matching a protocol across all message types after a watermark', async () => {
        // filter for proto1 given a watermark
        const proto1EventsQuery = await TestDataGenerator.generateEventsQuery({
          author,
          filter    : { protocol: proto1 },
          watermark : testWatermark
        });
        const proto1EventsReply = await dwn.processMessage(author.did, proto1EventsQuery.message) as EventsQueryReply;
        expect(proto1EventsReply.status.code).equals(200);

        //filter for proto 1 messages after the watermark
        const expectedProto1MessageCids: string[] = [];
        for (const [message, indexes] of testMessagesAfterWatermark) {
          if (indexes.includes(proto1)) {
            const messageCid = await Message.getCid(message);
            expectedProto1MessageCids.push(messageCid);
          }
        }

        const proto1Events = proto1EventsReply.events!;
        expect(proto1Events.length).to.equal(expectedProto1MessageCids.length);
        expect(proto1Events.every(e => expectedProto1MessageCids.includes(e.messageCid))).to.be.true;

        // filter for proto2 given a watermark
        const proto2EventsQuery = await TestDataGenerator.generateEventsQuery({
          author,
          filter    : { protocol: proto2 },
          watermark : testWatermark
        });
        const proto2EventsReply = await dwn.processMessage(author.did, proto2EventsQuery.message) as EventsQueryReply;
        expect(proto2EventsReply.status.code).equals(200);

        //filter for proto 1 messages after the watermark
        const expectedProto2MessageCids: string[] = [];
        for (const [message, indexes] of testMessagesAfterWatermark) {
          if (indexes.includes(proto2)) {
            const messageCid = await Message.getCid(message);
            expectedProto2MessageCids.push(messageCid);
          }
        }

        const proto2Events = proto2EventsReply.events!;
        expect(proto2Events.length).to.equal(expectedProto2MessageCids.length);
        expect(proto2Events.every(e => expectedProto2MessageCids.includes(e.messageCid))).to.be.true;
      });

      it('filter for events matching a schema across all message types', async () => {
        // filter for contribution schema
        const contributionSchemaEventsQuery = await TestDataGenerator.generateEventsQuery({ author, filter: { schema: 'contribution' } });
        const contributionSchemaEventsReply = await dwn.processMessage(author.did, contributionSchemaEventsQuery.message) as EventsQueryReply;
        expect(contributionSchemaEventsReply.status.code).equals(200);

        //filter for contribution schema
        const expectedContributionMessages: string[] = [];
        for (const [message, indexes] of testMessages) {
          if (indexes.includes('contribution')) {
            const messageCid = await Message.getCid(message);
            expectedContributionMessages.push(messageCid);
          }
        }

        const contributionEvents = contributionSchemaEventsReply.events!;
        expect(contributionEvents.length).to.equal(expectedContributionMessages.length);
        expect(contributionEvents.every(e => expectedContributionMessages.includes(e.messageCid))).to.be.true;

        // filter for reward schema
        const rewardEventsQuery = await TestDataGenerator.generateEventsQuery({ author, filter: { schema: 'reward' } });
        const rewardEventsReply = await dwn.processMessage(author.did, rewardEventsQuery.message) as EventsQueryReply;
        expect(rewardEventsReply.status.code).equals(200);

        //filter for reward messages
        const expectedRewardMessages: string[] = [];
        for (const [message, indexes] of testMessages) {
          if (indexes.includes('reward')) {
            const messageCid = await Message.getCid(message);
            expectedRewardMessages.push(messageCid);
          }
        }

        const rewardEvents = rewardEventsReply.events!;
        expect(rewardEvents.length).to.equal(expectedRewardMessages.length);
        expect(rewardEvents.every(e => expectedRewardMessages.includes(e.messageCid))).to.be.true;
      });

      it('filter for events matching a schema across all message types after a watermark', async () => {
        // filter for contribution schema given a watermark
        const contributionSchemaEventsQuery = await TestDataGenerator.generateEventsQuery({
          author,
          filter    : { schema: 'contribution' },
          watermark : testWatermark
        });
        const contributionSchemaEventsReply = await dwn.processMessage(author.did, contributionSchemaEventsQuery.message) as EventsQueryReply;
        expect(contributionSchemaEventsReply.status.code).equals(200);

        //filter for contribution schema after the watermark
        const expectedContributionMessages: string[] = [];
        for (const [message, indexes] of testMessagesAfterWatermark) {
          if (indexes.includes('contribution')) {
            const messageCid = await Message.getCid(message);
            expectedContributionMessages.push(messageCid);
          }
        }

        const contributionEvents = contributionSchemaEventsReply.events!;
        expect(contributionEvents.length).to.equal(expectedContributionMessages.length);
        expect(contributionEvents.every(e => expectedContributionMessages.includes(e.messageCid))).to.be.true;

        // filter for reward schema given a watermark
        const rewardEventsQuery = await TestDataGenerator.generateEventsQuery({
          author,
          filter    : { schema: 'reward' },
          watermark : testWatermark
        });
        const rewardEventsReply = await dwn.processMessage(author.did, rewardEventsQuery.message) as EventsQueryReply;
        expect(rewardEventsReply.status.code).equals(200);

        //filter for reward messages after the watermark
        const expectedRewardMessages: string[] = [];
        for (const [message, indexes] of testMessagesAfterWatermark) {
          if (indexes.includes('reward')) {
            const messageCid = await Message.getCid(message);
            expectedRewardMessages.push(messageCid);
          }
        }

        const rewardEvents = rewardEventsReply.events!;
        expect(rewardEvents.length).to.equal(expectedRewardMessages.length);
        expect(rewardEvents.every(e => expectedRewardMessages.includes(e.messageCid))).to.be.true;
      });

      it('filter for events matching a protocol and protocolPath across all message types', async () => {
        // query for proto1 contribution path
        const proto1ContributionQuery = await TestDataGenerator.generateEventsQuery({ author, filter: { protocol: proto1, protocolPath: 'contribution' } });
        const proto1ContributionReply = await dwn.processMessage(author.did, proto1ContributionQuery.message) as EventsQueryReply;
        expect(proto1ContributionReply.status.code).equals(200);

        //filter for proto 1 contribution messages
        const expectedProto1ContributionMessages: string[] = [];
        for (const [message, indexes] of testMessages) {
          if (indexes.includes(proto1) && indexes.includes('contribution')) {
            const messageCid = await Message.getCid(message);
            expectedProto1ContributionMessages.push(messageCid);
          }
        }
        const proto1ContributionEvents = proto1ContributionReply.events!;
        expect(proto1ContributionEvents.length).to.equal(expectedProto1ContributionMessages.length);
        expect(proto1ContributionEvents.every(e => expectedProto1ContributionMessages.includes(e.messageCid))).to.be.true;

        // query for proto1 reward path
        const proto1RewardQuery = await TestDataGenerator.generateEventsQuery({ author, filter: { protocol: proto1, protocolPath: 'reward' } });
        const proto1RewardReply = await dwn.processMessage(author.did, proto1RewardQuery.message) as EventsQueryReply;
        expect(proto1RewardReply.status.code).equals(200);

        // filter for proto1 reward path
        const expectedProto1RewardMessages: string[] = [];
        for (const [message, indexes] of testMessages) {
          if (indexes.includes(proto1) && indexes.includes('reward')) {
            const messageCid = await Message.getCid(message);
            expectedProto1RewardMessages.push(messageCid);
          }
        }

        const proto1RewardEvents = proto1RewardReply.events!;
        expect(proto1RewardEvents.length).to.equal(expectedProto1RewardMessages.length);
        expect(proto1RewardEvents.every(e => expectedProto1RewardMessages.includes(e.messageCid))).to.be.true;

        // query for proto2 contribution path
        const proto2ContributionQuery = await TestDataGenerator.generateEventsQuery({ author, filter: { protocol: proto2, protocolPath: 'contribution' } });
        const proto2ContributionReply = await dwn.processMessage(author.did, proto2ContributionQuery.message) as EventsQueryReply;
        expect(proto2ContributionReply.status.code).equals(200);

        //filter for proto2 contribution messages
        const expectedProto2ContributionMessages: string[] = [];
        for (const [message, indexes] of testMessages) {
          if (indexes.includes(proto2) && indexes.includes('contribution')) {
            const messageCid = await Message.getCid(message);
            expectedProto2ContributionMessages.push(messageCid);
          }
        }
        const proto2ContributionEvents = proto2ContributionReply.events!;
        expect(proto2ContributionEvents.length).to.equal(expectedProto2ContributionMessages.length);
        expect(proto2ContributionEvents.every(e => expectedProto2ContributionMessages.includes(e.messageCid))).to.be.true;

        // query for proto2 reward path
        const proto2RewardQuery = await TestDataGenerator.generateEventsQuery({ author, filter: { protocol: proto2, protocolPath: 'reward' } });
        const proto2RewardReply = await dwn.processMessage(author.did, proto2RewardQuery.message) as EventsQueryReply;
        expect(proto2RewardReply.status.code).equals(200);

        // filter for proto1 reward path
        const expectedProto2RewardMessages: string[] = [];
        for (const [message, indexes] of testMessages) {
          if (indexes.includes(proto2) && indexes.includes('reward')) {
            const messageCid = await Message.getCid(message);
            expectedProto2RewardMessages.push(messageCid);
          }
        }

        const proto2RewardEvents = proto2RewardReply.events!;
        expect(proto2RewardEvents.length).to.equal(expectedProto2RewardMessages.length);
        expect(proto2RewardEvents.every(e => expectedProto2RewardMessages.includes(e.messageCid))).to.be.true;
      });

      it('filter for events matching a protocol and protocolPath across all message types after a watermark', async () => {
        // query for proto1 contribution path given a watermark
        const proto1ContributionQuery = await TestDataGenerator.generateEventsQuery({
          author,
          filter    : { protocol: proto1, protocolPath: 'contribution' },
          watermark : testWatermark
        });
        const proto1ContributionReply = await dwn.processMessage(author.did, proto1ContributionQuery.message) as EventsQueryReply;
        expect(proto1ContributionReply.status.code).equals(200);

        const proto1ContributionEvents = proto1ContributionReply.events!;
        expect(proto1ContributionEvents.length).to.equal(0); //none should exist here

        // query for proto1 reward path given a watermark
        const proto1RewardQuery = await TestDataGenerator.generateEventsQuery({
          author,
          filter    : { protocol: proto1, protocolPath: 'reward' },
          watermark : testWatermark }
        );
        const proto1RewardReply = await dwn.processMessage(author.did, proto1RewardQuery.message) as EventsQueryReply;
        expect(proto1RewardReply.status.code).equals(200);

        // filter for proto1 reward path after watermark
        const expectedProto1RewardMessages: string[] = [];
        for (const [message, indexes] of testMessagesAfterWatermark) {
          if (indexes.includes(proto1) && indexes.includes('reward')) {
            const messageCid = await Message.getCid(message);
            expectedProto1RewardMessages.push(messageCid);
          }
        }

        const proto1RewardEvents = proto1RewardReply.events!;
        expect(proto1RewardEvents.length).to.equal(expectedProto1RewardMessages.length);
        expect(proto1RewardEvents.every(e => expectedProto1RewardMessages.includes(e.messageCid))).to.be.true;

        // query for proto2 contribution path given a watermark
        const proto2ContributionQuery = await TestDataGenerator.generateEventsQuery({
          author,
          filter    : { protocol: proto2, protocolPath: 'contribution' },
          watermark : testWatermark,
        });
        const proto2ContributionReply = await dwn.processMessage(author.did, proto2ContributionQuery.message) as EventsQueryReply;
        expect(proto2ContributionReply.status.code).equals(200);

        //filter for proto2 contribution messages after watermark
        const expectedProto2ContributionMessages: string[] = [];
        for (const [message, indexes] of testMessagesAfterWatermark) {
          if (indexes.includes(proto2) && indexes.includes('contribution')) {
            const messageCid = await Message.getCid(message);
            expectedProto2ContributionMessages.push(messageCid);
          }
        }
        const proto2ContributionEvents = proto2ContributionReply.events!;
        expect(proto2ContributionEvents.length).to.equal(expectedProto2ContributionMessages.length);
        expect(proto2ContributionEvents.every(e => expectedProto2ContributionMessages.includes(e.messageCid))).to.be.true;

        // query for proto2 reward path given a watermark
        const proto2RewardQuery = await TestDataGenerator.generateEventsQuery({
          author,
          filter    : { protocol: proto2, protocolPath: 'reward' },
          watermark : testWatermark,
        });
        const proto2RewardReply = await dwn.processMessage(author.did, proto2RewardQuery.message) as EventsQueryReply;
        expect(proto2RewardReply.status.code).equals(200);
        const proto2RewardEvents = proto2RewardReply.events!;
        expect(proto2RewardEvents.length).to.equal(0); //should not exist
      });

      // it('returns events from multiple filters in a single request', async () => {
      //   const protocol1And2Events = await eventLog.query(author.did, [{ protocol: proto1 }, { protocol: proto2 }]);
      //   expect(protocol1And2Events.length).to.equal(9);

      //   const eventArray = [...events.keys()];

      //   const expectedEvents:Event[] = [];
      //   eventArray.forEach((e) => {
      //     const indexes = events.get(e)!;
      //     if (indexes.protocol === proto1 || indexes.protocol === proto2) {
      //       expectedEvents.push(e);
      //     }
      //   });

      //   expectedEvents.forEach(expected => {
      //     const event = protocol1And2Events.find(e => e.messageCid === expected.messageCid);
      //     expect(event?.watermark).to.equal(expected.watermark);
      //   });
      // });

      // it('returns events from multiple filters in a single request after a watermark', async () => {
      //   const protocol1And2Events = await eventLog.query(
      //     author.did,
      //     [{ protocol: proto1 }, { protocol: proto2 }],
      //     testWatermark
      //   );
      //   expect(protocol1And2Events.length).to.equal(3);

      //   // filter for events after watermark
      //   const eventArray = [...events.keys()].filter(e => e.watermark > testWatermark);

      //   const expectedEvents:Event[] = [];
      //   eventArray.forEach((e) => {
      //     const indexes = events.get(e)!;
      //     if (indexes.protocol === proto1 || indexes.protocol === proto2) {
      //       expectedEvents.push(e);
      //     }
      //   });

      //   expectedEvents.forEach(expected => {
      //     const event = protocol1And2Events.find(e => e.messageCid === expected.messageCid);
      //     expect(event?.watermark).to.equal(expected.watermark);
      //   });
      // });
    });

    it('returns a 401 if tenant is not author', async () => {
      const alice = await DidKeyResolver.generate();
      const bob = await DidKeyResolver.generate();

      const { message } = await TestDataGenerator.generateEventsQuery({ author: alice, filter: { schema: 'schema1' } });
      const reply = await dwn.processMessage(bob.did, message);

      expect(reply.status.code).to.equal(401);
      expect(reply.entries).to.not.exist;
      expect(reply.data).to.not.exist;
    });

    it('returns a 400 if message is invalid', async () => {
      const alice = await DidKeyResolver.generate();

      const { message } = await TestDataGenerator.generateEventsQuery({ author: alice, filter: { schema: 'schema1' } });
      (message['descriptor'] as any)['troll'] = 'hehe';

      const reply = await dwn.processMessage(alice.did, message);

      expect(reply.status.code).to.equal(400);
      expect(reply.entries).to.not.exist;
      expect(reply.data).to.not.exist;
    });
  });
}
