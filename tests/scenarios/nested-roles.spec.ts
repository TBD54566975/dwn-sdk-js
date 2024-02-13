import type { EncryptionInput } from '../../src/interfaces/records-write.js';
import type { EventStream } from '../../src/types/subscriptions.js';
import type { GenerateFromRecordsWriteOut } from '../utils/test-data-generator.js';
import type { ProtocolDefinition } from '../../src/types/protocols-types.js';
import type { RecordsQueryReplyEntry } from '../../src/types/records-types.js';
import type { DataStore, EventLog, MessageStore } from '../../src/index.js';

import anyoneCollaborateProtocolDefinition from '../vectors/protocol-definitions/anyone-collaborate.json' assert { type: 'json' };
import authorCanProtocolDefinition from '../vectors/protocol-definitions/author-can.json' assert { type: 'json' };
import chaiAsPromised from 'chai-as-promised';
import credentialIssuanceProtocolDefinition from '../vectors/protocol-definitions/credential-issuance.json' assert { type: 'json' };
import dexProtocolDefinition from '../vectors/protocol-definitions/dex.json' assert { type: 'json' };
import emailProtocolDefinition from '../vectors/protocol-definitions/email.json' assert { type: 'json' };
import friendRoleProtocolDefinition from '../vectors/protocol-definitions/friend-role.json' assert { type: 'json' };
import messageProtocolDefinition from '../vectors/protocol-definitions/message.json' assert { type: 'json' };
import minimalProtocolDefinition from '../vectors/protocol-definitions/minimal.json' assert { type: 'json' };
import nestedProtocol from '../vectors/protocol-definitions/nested.json' assert { type: 'json' };
import privateProtocol from '../vectors/protocol-definitions/private-protocol.json' assert { type: 'json' };
import recipientCanProtocol from '../vectors/protocol-definitions/recipient-can.json' assert { type: 'json' };
import sinon from 'sinon';
import slackProtocolDefinition from '../vectors/protocol-definitions/slack.json' assert { type: 'json' };
import threadRoleProtocolDefinition from '../vectors/protocol-definitions/thread-role.json' assert { type: 'json' };
import chai, { expect } from 'chai';

import { ArrayUtility } from '../../src/utils/array.js';
import { base64url } from 'multiformats/bases/base64';
import { Cid } from '../../src/utils/cid.js';
import { DataStream } from '../../src/utils/data-stream.js';
import { DidKey } from '@web5/dids';
import { DidResolver } from '@web5/dids';
import { Dwn } from '../../src/dwn.js';
import { DwnErrorCode } from '../../src/core/dwn-error.js';
import { Encoder } from '../../src/utils/encoder.js';
import { GeneralJwsBuilder } from '../../src/jose/jws/general/builder.js';
import { Jws } from '../../src/utils/jws.js';
import { Message } from '../../src/core/message.js';
import { PermissionsConditionPublication } from '../../src/types/permissions-grant-descriptor.js';
import { RecordsRead } from '../../src/interfaces/records-read.js';
import { RecordsWrite } from '../../src/interfaces/records-write.js';
import { RecordsWriteHandler } from '../../src/handlers/records-write.js';
import { stubInterface } from 'ts-sinon';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestEventStream } from '../test-event-stream.js';
import { TestStores } from '../test-stores.js';
import { TestStubGenerator } from '../utils/test-stub-generator.js';
import { Time } from '../../src/utils/time.js';

import { DwnConstant, DwnInterfaceName, DwnMethodName, KeyDerivationScheme, RecordsDelete, RecordsQuery } from '../../src/index.js';
import { Encryption, EncryptionAlgorithm } from '../../src/utils/encryption.js';

chai.use(chaiAsPromised);


export function testNestedContextRoleScenarios(): void {
  describe('Nested context role scenarios', () => {
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

    it.only('uses a contextRole to authorize a write', async () => {
      // scenario: Alice creates a thread and adds Bob to the 'thread/participant' role. Bob invokes the record to write in the thread

      const alice = await TestDataGenerator.generateDidKeyPersona();
      const bob = await TestDataGenerator.generateDidKeyPersona();
      const carol = await TestDataGenerator.generateDidKeyPersona();
      const daniel = await TestDataGenerator.generateDidKeyPersona();
      const mallory = await TestDataGenerator.generateDidKeyPersona(); // unauthorized person

      const protocolDefinition = slackProtocolDefinition;

      // Alice installs Slack protocol
      const protocolsConfig = await TestDataGenerator.generateProtocolsConfigure({
        author: alice,
        protocolDefinition
      });
      const protocolsConfigureReply = await dwn.processMessage(alice.did, protocolsConfig.message);
      expect(protocolsConfigureReply.status.code).to.equal(202);

      // Alice creates a community
      const communityRecord = await TestDataGenerator.generateRecordsWrite({
        author       : alice,
        protocol     : protocolDefinition.protocol,
        protocolPath : 'community'
      });
      const communityRecordReply = await dwn.processMessage(alice.did, communityRecord.message, { dataStream: communityRecord.dataStream });
      expect(communityRecordReply.status.code).to.equal(202);

      // Alice assigns bob as an 'admin' in the community
      const communityAdminBobRecord = await TestDataGenerator.generateRecordsWrite({
        author          : alice,
        recipient       : bob.did,
        protocol        : protocolDefinition.protocol,
        protocolPath    : 'community/admin',
        parentContextId : communityRecord.message.contextId,
      });
      const communityAdminBobRecordReply
        = await dwn.processMessage(alice.did, communityAdminBobRecord.message, { dataStream: communityAdminBobRecord.dataStream });
      expect(communityAdminBobRecordReply.status.code).to.equal(202);

      // Bob can create a gated-channel in the community
      const channelRecord = await TestDataGenerator.generateRecordsWrite({
        author          : bob,
        protocol        : protocolDefinition.protocol,
        protocolRole    : 'community/admin',
        protocolPath    : 'community/gatedChannel',
        parentContextId : communityRecord.message.contextId
      });
      const channelRecordReply = await dwn.processMessage(alice.did, channelRecord.message, { dataStream: channelRecord.dataStream });
      expect(channelRecordReply.status.code).to.equal(202);

      // Bob can add himself and Carol as a 'participant' in the gated-channel as the creator/author of the channel
      const participantBobRecord = await TestDataGenerator.generateRecordsWrite({
        author          : bob,
        recipient       : bob.did,
        protocol        : protocolDefinition.protocol,
        protocolPath    : 'community/gatedChannel/participant',
        parentContextId : channelRecord.message.contextId,
      });
      const participantBobRecordReply
        = await dwn.processMessage(alice.did, participantBobRecord.message, { dataStream: participantBobRecord.dataStream });
      expect(participantBobRecordReply.status.code).to.equal(202);

      const participantCarolRecord = await TestDataGenerator.generateRecordsWrite({
        author          : bob,
        recipient       : carol.did,
        protocol        : protocolDefinition.protocol,
        protocolPath    : 'community/gatedChannel/participant',
        parentContextId : channelRecord.message.contextId,
      });
      const participantCarolRecordReply
        = await dwn.processMessage(alice.did, participantCarolRecord.message, { dataStream: participantCarolRecord.dataStream });
      expect(participantCarolRecordReply.status.code).to.equal(202);

      // Carol CANNOT add Daniel as another participant in the gated-channel without invoking her role
      const participantDanielRecordAttempt1 = await TestDataGenerator.generateRecordsWrite({
        author          : carol,
        recipient       : daniel.did,
        protocol        : protocolDefinition.protocol,
        protocolPath    : 'community/gatedChannel/participant',
        parentContextId : channelRecord.message.contextId,
      });
      const participantDanielRecordAttempt1Reply
        = await dwn.processMessage(alice.did, participantDanielRecordAttempt1.message, { dataStream: participantDanielRecordAttempt1.dataStream });
      expect(participantDanielRecordAttempt1Reply.status.code).to.equal(401);
      expect(participantDanielRecordAttempt1Reply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationActionNotAllowed);

      // Carol can invoke her participant role to add Daniel as another participant in the gated-channel
      const participantDanielRecordAttempt2 = await TestDataGenerator.generateRecordsWrite({
        author          : carol,
        recipient       : daniel.did,
        protocol        : protocolDefinition.protocol,
        protocolRole    : 'community/gatedChannel/participant',
        protocolPath    : 'community/gatedChannel/participant',
        parentContextId : channelRecord.message.contextId,
      });
      const participantDanielRecordAttempt2Reply
        = await dwn.processMessage(alice.did, participantDanielRecordAttempt2.message, { dataStream: participantDanielRecordAttempt2.dataStream });
      expect(participantDanielRecordAttempt2Reply.status.code).to.equal(202);

      // Bob can invoke the participant role to write a chat message in the channel
      const bobChatMessage = await TestDataGenerator.generateRecordsWrite({
        author          : bob,
        protocol        : protocolDefinition.protocol,
        protocolRole    : 'community/gatedChannel/participant',
        protocolPath    : 'community/gatedChannel/message',
        parentContextId : channelRecord.message.contextId
      });
      const bobChatMessageReply = await dwn.processMessage(alice.did, bobChatMessage.message, { dataStream: bobChatMessage.dataStream });
      expect(bobChatMessageReply.status.code).to.equal(202);

      // Carol can invoke the participant role to read chat messages in the channel
      const carolQuery = await RecordsQuery.create({
        signer       : Jws.createSigner(carol),
        protocolRole : 'community/gatedChannel/participant',
        filter       : {
          protocol     : protocolDefinition.protocol, // TODO: why is this necessary?
          protocolPath : 'community/gatedChannel/message', // TODO: is this really necessary now?
          contextId    : channelRecord.message.contextId
        }
      });
      const carolQueryReply = await dwn.processMessage(alice.did, carolQuery.message);
      expect(carolQueryReply.status.code).to.equal(200);
      expect(carolQueryReply.entries?.[0].recordId).to.equal(bobChatMessage.message.recordId);

      // Carol can invoke the participant role to react to Bob's chat message in the channel
      const carolReaction = await TestDataGenerator.generateRecordsWrite({
        author          : bob,
        protocol        : protocolDefinition.protocol,
        protocolRole    : 'community/gatedChannel/participant',
        protocolPath    : 'community/gatedChannel/message/reaction',
        parentContextId : bobChatMessage.message.contextId
      });
      const carolReactionReply = await dwn.processMessage(alice.did, carolReaction.message, { dataStream: carolReaction.dataStream });
      expect(carolReactionReply.status.code).to.equal(202);

      // Mallory CANNOT invoke the participant role (which she is not given) to read the chat messages in the channel
      const malloryQuery = await RecordsQuery.create({
        signer       : Jws.createSigner(mallory),
        protocolRole : 'community/gatedChannel/participant',
        filter       : {
          protocol     : protocolDefinition.protocol, // TODO: why is this necessary?
          protocolPath : 'community/gatedChannel/message', // TODO: is this really necessary now?
          contextId    : channelRecord.message.contextId
        }
      });
      const malloryQueryReply = await dwn.processMessage(alice.did, malloryQuery.message);
      expect(malloryQueryReply.status.code).to.equal(401);
      expect(malloryQueryReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationMatchingRoleRecordNotFound);

      // Mallory CANNOT invoke the participant role (which she is not given) to write a chat message in the channel
      const malloryChatMessage = await TestDataGenerator.generateRecordsWrite({
        author          : mallory,
        protocol        : protocolDefinition.protocol,
        protocolRole    : 'community/gatedChannel/participant',
        protocolPath    : 'community/gatedChannel/message',
        parentContextId : channelRecord.message.contextId
      });
      const malloryChatMessageReply = await dwn.processMessage(alice.did, malloryChatMessage.message, { dataStream: malloryChatMessage.dataStream });
      expect(malloryChatMessageReply.status.code).to.equal(401);
      expect(malloryChatMessageReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationMatchingRoleRecordNotFound);
    });
  });
}
