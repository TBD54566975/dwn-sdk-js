import type { MessagesQueryMessage } from '../../src/types/messages-types.js';
import type { ProtocolsQueryFilter } from '../../src/types/protocols-types.js';

import { Jws } from '../../src/utils/jws.js';
import { Message } from '../../src/core/message.js';
import { MessagesQuery } from '../../src/interfaces/messages-query.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { Time } from '../../src/utils/time.js';

import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

chai.use(chaiAsPromised);

describe('MessagesQuery Message', () => {
  describe('create()', () => {
    it('should use `messageTimestamp` as is if given', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const currentTime = Time.getCurrentTimestamp();
      const messagesQuery = await MessagesQuery.create({
        filters          : [{ protocol: 'http://example.org/protocol/v1' }],
        messageTimestamp : currentTime,
        signer           : Jws.createSigner(alice),
      });

      expect(messagesQuery.message.descriptor.messageTimestamp).to.equal(currentTime);
    });

    it('should auto-normalize protocol URL', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const options = {
        recipient : alice.did,
        signer    : Jws.createSigner(alice),
        filters   : [{ protocol: 'example.com/' }],
      };
      const messagesQuery = await MessagesQuery.create(options);

      const message = messagesQuery.message as MessagesQueryMessage;
      expect(message.descriptor.filters?.length).to.equal(1);
      expect((message.descriptor.filters![0] as ProtocolsQueryFilter).protocol).to.eq('http://example.com');
    });

    it('allows query with no filters', async () => {
      const alice = await TestDataGenerator.generatePersona();
      const currentTime = Time.getCurrentTimestamp();
      const messagesQuery = await MessagesQuery.create({
        messageTimestamp : currentTime,
        signer           : Jws.createSigner(alice),
      });

      expect(messagesQuery.message.descriptor.filters).to.deep.equal([]); // empty array
    });

    it('removes empty filters', async () => {
      const alice = await TestDataGenerator.generatePersona();
      const currentTime = Time.getCurrentTimestamp();

      // single empty filter fails
      const messagesQuery1 = await MessagesQuery.create({
        messageTimestamp : currentTime,
        signer           : Jws.createSigner(alice),
        filters          : [{}],
      });
      expect(messagesQuery1.message.descriptor.filters).to.deep.equal([]); // empty array

      // empty filter gets removed, valid filter remains
      const messagesQuery2 = await MessagesQuery.create({
        filters          : [{ protocol: 'http://example.org/protocol/v1' },{ }], // one empty filter
        messageTimestamp : currentTime,
        signer           : Jws.createSigner(alice),
      });
      expect(messagesQuery2.message.descriptor.filters?.length).to.equal(1);
      expect(messagesQuery2.message.descriptor.filters).to.deep.equal([{ protocol: 'http://example.org/protocol/v1' }]);
    });
  });

  describe('parse', () => {
    it('parses a message into an MessagesQuery instance', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const currentTime = Time.getCurrentTimestamp();

      const messagesQuery = await MessagesQuery.create({
        filters          : [{ protocol: 'http://example.org/protocol/v1' }],
        messageTimestamp : currentTime,
        signer           : Jws.createSigner(alice),
      });

      const parsed = await MessagesQuery.parse(messagesQuery.message);
      expect(parsed).to.be.instanceof(MessagesQuery);

      const expectedMessageCid = await Message.getCid(messagesQuery.message);
      const messageCid = await Message.getCid(parsed.message);

      expect(messageCid).to.equal(expectedMessageCid);
    });

    it('throws an exception if message is not a valid MessagesQuery message', async () => {
      const alice = await TestDataGenerator.generatePersona();
      const currentTime = Time.getCurrentTimestamp();
      const messagesQuery = await MessagesQuery.create({
        filters          : [{ protocol: 'http://example.org/protocol/v1' }],
        messageTimestamp : currentTime,
        signer           : Jws.createSigner(alice),
      });

      const { message } = messagesQuery;
      (message.descriptor as any)['bad_property'] = 'property';
      const messagesQueryPromise = MessagesQuery.parse(message);
      await expect(messagesQueryPromise).to.eventually.be.rejectedWith('must NOT have additional properties');
    });

    it('allows query without any filters', async () => {
      const alice = await TestDataGenerator.generatePersona();
      const currentTime = Time.getCurrentTimestamp();
      const messagesQuery = await MessagesQuery.create({
        messageTimestamp : currentTime,
        signer           : Jws.createSigner(alice),
      });

      const { message } = messagesQuery;
      const parsedQuery = await MessagesQuery.parse(message);
      expect(parsedQuery.message.descriptor.filters).to.deep.equal([]);
    });

    it('throws an exception if message has an empty filter', async () => {
      const alice = await TestDataGenerator.generatePersona();
      const currentTime = Time.getCurrentTimestamp();
      const messagesQuery = await MessagesQuery.create({
        filters          : [{ protocol: 'http://example.org/protocol/v1' }],
        messageTimestamp : currentTime,
        signer           : Jws.createSigner(alice),
      });

      const { message } = messagesQuery;
      message.descriptor.filters!.push({ }); // add an empty filter
      const messagesQueryPromise = MessagesQuery.parse(message);
      await expect(messagesQueryPromise).to.eventually.be.rejectedWith('must NOT have fewer than 1 properties');
    });
  });
});
