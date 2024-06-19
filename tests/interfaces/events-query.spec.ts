import type { EventsQueryMessage } from '../../src/types/events-types.js';
import type { ProtocolsQueryFilter } from '../../src/types/protocols-types.js';

import { EventsQuery } from '../../src/interfaces/events-query.js';
import { Jws } from '../../src/utils/jws.js';
import { Message } from '../../src/core/message.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { Time } from '../../src/utils/time.js';

import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

chai.use(chaiAsPromised);

describe('EventsQuery Message', () => {
  describe('create()', () => {
    it('should use `messageTimestamp` as is if given', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const currentTime = Time.getCurrentTimestamp();
      const eventsQuery = await EventsQuery.create({
        filters          : [{ protocol: 'http://example.org/protocol/v1' }],
        messageTimestamp : currentTime,
        signer           : Jws.createSigner(alice),
      });

      expect(eventsQuery.message.descriptor.messageTimestamp).to.equal(currentTime);
    });

    it('should auto-normalize protocol URL', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const options = {
        recipient : alice.did,
        signer    : Jws.createSigner(alice),
        filters   : [{ protocol: 'example.com/' }],
      };
      const eventsQuery = await EventsQuery.create(options);

      const message = eventsQuery.message as EventsQueryMessage;
      expect(message.descriptor.filters?.length).to.equal(1);
      expect((message.descriptor.filters![0] as ProtocolsQueryFilter).protocol).to.eq('http://example.com');
    });

    it('allows query with no filters', async () => {
      const alice = await TestDataGenerator.generatePersona();
      const currentTime = Time.getCurrentTimestamp();
      const eventsQueryPromise = await EventsQuery.create({
        messageTimestamp : currentTime,
        signer           : Jws.createSigner(alice),
      });
      expect(eventsQueryPromise.message.descriptor.filters).to.be.undefined;
    });

    it('removes empty filters', async () => {
      const alice = await TestDataGenerator.generatePersona();
      const currentTime = Time.getCurrentTimestamp();

      // single empty filter fails
      const eventsQueryPromise = EventsQuery.create({
        filters          : [{}],
        messageTimestamp : currentTime,
        signer           : Jws.createSigner(alice),
      });
      await expect(eventsQueryPromise).to.eventually.be.rejectedWith('fewer than 1 items');

      // empty filter gets removed, valid filter remains
      const eventsQuery = await EventsQuery.create({
        filters          : [{ protocol: 'http://example.org/protocol/v1' },{ }], // one empty filter
        messageTimestamp : currentTime,
        signer           : Jws.createSigner(alice),
      });
      expect(eventsQuery.message.descriptor.filters?.length).to.equal(1);
    });
  });

  describe('parse', () => {
    it('parses a message into an EventsQuery instance', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const currentTime = Time.getCurrentTimestamp();

      const eventsQuery = await EventsQuery.create({
        filters          : [{ protocol: 'http://example.org/protocol/v1' }],
        messageTimestamp : currentTime,
        signer           : Jws.createSigner(alice),
      });

      const parsed = await EventsQuery.parse(eventsQuery.message);
      expect(parsed).to.be.instanceof(EventsQuery);

      const expectedMessageCid = await Message.getCid(eventsQuery.message);
      const messageCid = await Message.getCid(parsed.message);

      expect(messageCid).to.equal(expectedMessageCid);
    });

    it('throws an exception if message is not a valid EventsQuery message', async () => {
      const alice = await TestDataGenerator.generatePersona();
      const currentTime = Time.getCurrentTimestamp();
      const eventsQuery = await EventsQuery.create({
        filters          : [{ protocol: 'http://example.org/protocol/v1' }],
        messageTimestamp : currentTime,
        signer           : Jws.createSigner(alice),
      });

      const { message } = eventsQuery;
      (message.descriptor as any)['bad_property'] = 'property';
      const eventsQueryPromise = EventsQuery.parse(message);
      await expect(eventsQueryPromise).to.eventually.be.rejectedWith('must NOT have additional properties');
    });

    it('allows query without any filters', async () => {
      const alice = await TestDataGenerator.generatePersona();
      const currentTime = Time.getCurrentTimestamp();
      const eventsQuery = await EventsQuery.create({
        messageTimestamp : currentTime,
        signer           : Jws.createSigner(alice),
      });

      const { message } = eventsQuery;
      const parsedQuery = await EventsQuery.parse(message);
      expect(parsedQuery.message.descriptor.filters).to.be.undefined;
    });

    it('throws an exception if message has an empty filter', async () => {
      const alice = await TestDataGenerator.generatePersona();
      const currentTime = Time.getCurrentTimestamp();
      const eventsQuery = await EventsQuery.create({
        filters          : [{ protocol: 'http://example.org/protocol/v1' }],
        messageTimestamp : currentTime,
        signer           : Jws.createSigner(alice),
      });

      const { message } = eventsQuery;
      message.descriptor.filters!.push({ }); // add an empty filter
      const eventsQueryPromise = EventsQuery.parse(message);
      await expect(eventsQueryPromise).to.eventually.be.rejectedWith('must NOT have fewer than 1 properties');
    });
  });
});
