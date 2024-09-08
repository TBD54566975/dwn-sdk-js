import type { PermissionScope } from '../../src/types/permission-types.js';
import type { RecordsQueryReplyEntry } from '../../src/types/records-types.js';

import { expect } from 'chai';
import { Jws } from '../../src/utils/jws.js';
import { Message } from '../../src/core/message.js';
import { PermissionsProtocol } from '../../src/protocols/permissions.js';
import { RecordsRead } from '../../src/interfaces/records-read.js';
import { RecordsWrite } from '../../src/interfaces/records-write.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { Time } from '../../src/utils/time.js';
import { DwnInterfaceName, DwnMethodName } from '../../src/enums/dwn-interface-method.js';

describe('Message', () => {
  describe('getAuthor()', () => {
    it('should return the author of a message', async () => {
      const bob = await TestDataGenerator.generatePersona();

      // create a record message
      const { message: recordsWriteMessage } = await TestDataGenerator.generateRecordsWrite({ author: bob });
      const recordsWriteAuthor = Message.getAuthor(recordsWriteMessage);
      expect(recordsWriteAuthor).to.equal(bob.did);

      // create a delete message
      const { message: recordsDeleteMessage } = await TestDataGenerator.generateRecordsDelete({ author: bob });
      const recordsDeleteAuthor = Message.getAuthor(recordsDeleteMessage);
      expect(recordsDeleteAuthor).to.equal(bob.did);

      // create a protocol configure message
      const { message: protocolsConfigureMessage } = await TestDataGenerator.generateProtocolsConfigure({ author: bob });
      const protocolsConfigureAuthor = Message.getAuthor(protocolsConfigureMessage);
      expect(protocolsConfigureAuthor).to.equal(bob.did);
    });

    it('should get the author of a delegated message', async () => {
      const alice = await TestDataGenerator.generatePersona();
      const deviceX = await TestDataGenerator.generatePersona();

      // create a delegation scope from alice to deviceX for writing records in a protocol
      const scope:PermissionScope = {
        interface : DwnInterfaceName.Records,
        method    : DwnMethodName.Write,
        protocol  : 'https://example.com/protocol/test',
      };

      // create the delegated grant message
      const bobGrant = await PermissionsProtocol.createGrant({
        delegated   : true,
        dateExpires : Time.createOffsetTimestamp({ seconds: 100 }),
        grantedTo   : deviceX.did,
        scope       : scope,
        signer      : Jws.createSigner(alice)
      });

      // create a record message using the grant
      const writeData = TestDataGenerator.randomBytes(32);

      const { message } = await RecordsWrite.create({
        signer         : Jws.createSigner(deviceX),
        delegatedGrant : bobGrant.dataEncodedMessage,
        protocol       : 'https://example.com/protocol/test',
        protocolPath   : 'test/path',
        dataFormat     : 'application/json',
        data           : writeData,
      });

      // expect message author to be alice
      const author = Message.getAuthor(message);
      expect(author).to.equal(alice.did);

      // expect message signer to be deviceX
      const signer = Message.getSigner(message);
      expect(signer).to.equal(deviceX.did);
    });

    it('returns undefined for an unsigned message', async () => {
      const { message } = await RecordsRead.create({
        filter: {
          recordId: await TestDataGenerator.randomCborSha256Cid()
        }
      });

      const author = Message.getAuthor(message);
      expect(author).to.be.undefined;
    });
  });

  describe('getSigner()', () => {
    it('should return `undefined` if message is not signed', async () => {
      const recordsRead = await RecordsRead.create({
        filter: {
          recordId: await TestDataGenerator.randomCborSha256Cid()
        }
      });

      const author = Message.getSigner(recordsRead.message);
      expect(author).to.be.undefined;
    });
  });

  describe('toJSON()', () => {
    it('should return the message passed in to the constructor', async () => {
      // create a message without `authorization`
      const { message } = await RecordsRead.create({
        filter: {
          recordId: await TestDataGenerator.randomCborSha256Cid()
        }
      });

      // NOTE: parse() calls constructor internally
      const recordsRead = await RecordsRead.parse(message);
      expect(recordsRead.toJSON()).to.equal(message);
    });
  });

  describe('compareMessageTimestamp', () => {
    it('should return 0 if age is same', async () => {
      const dateModified = Time.getCurrentTimestamp();
      const a = (await TestDataGenerator.generateRecordsWrite({ messageTimestamp: dateModified })).message;
      const b = JSON.parse(JSON.stringify(a)); // create a deep copy of `a`

      const compareResult = await Message.compareMessageTimestamp(a, b);
      expect(compareResult).to.equal(0);
    });
  });

  describe('getNewestMessage', () => {
    it('should return the newest message', async () => {
      const a = (await TestDataGenerator.generateRecordsWrite()).message;
      await Time.minimalSleep();
      const b = (await TestDataGenerator.generateRecordsWrite()).message;
      await Time.minimalSleep();
      const c = (await TestDataGenerator.generateRecordsWrite()).message; // c is the newest since its created last

      const newestMessage = await Message.getNewestMessage([b, c, a]);
      expect((newestMessage as any).recordId).to.equal(c.recordId);
    });
  });

  describe('getOldestMessage', () => {
    it('should return the newest message', async () => {
      const a = (await TestDataGenerator.generateRecordsWrite()).message;
      await Time.minimalSleep();
      const b = (await TestDataGenerator.generateRecordsWrite()).message;
      await Time.minimalSleep();
      const c = (await TestDataGenerator.generateRecordsWrite()).message; // c is the newest since its created last

      const newestMessage = await Message.getOldestMessage([b, c, a]);
      expect((newestMessage as any).recordId).to.equal(a.recordId);
    });
  });

  describe('getCid()', () => {
    it('encodedData does not have an effect on getCid()', async () => {
      const { message } = await TestDataGenerator.generateRecordsWrite();
      const cid1 = await Message.getCid(message);

      const messageWithData: RecordsQueryReplyEntry = message;
      messageWithData.encodedData = TestDataGenerator.randomString(25);

      const cid2 = await Message.getCid(messageWithData);

      expect(cid1).to.equal(cid2);
    });
  });
});