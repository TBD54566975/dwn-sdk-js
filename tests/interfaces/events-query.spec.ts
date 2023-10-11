import type { EventsQueryMessage } from '../../src/types/event-types.js';

import { EventsQuery } from '../../src/interfaces/events-query.js';
import { getCurrentTimeInHighPrecision } from '../../src/utils/time.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { Jws, Message } from '../../src/index.js';

import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

chai.use(chaiAsPromised);

describe('EventsQuery Message', () => {
  describe('create()', () => {
    it('should use `messageTimestamp` as is if given', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const currentTime = getCurrentTimeInHighPrecision();
      const eventsQuery = await EventsQuery.create({
        filters             : [{ schema: 'anything' }],
        messageTimestamp    : currentTime,
        authorizationSigner : Jws.createSigner(alice),
      });

      expect(eventsQuery.message.descriptor.messageTimestamp).to.equal(currentTime);
    });

    it('should auto-normalize protocol URL', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const options = {
        recipient           : alice.did,
        authorizationSigner : Jws.createSigner(alice),
        filters             : [{ protocol: 'example.com/' }],
      };
      const eventsQuery = await EventsQuery.create(options);

      const message = eventsQuery.message as EventsQueryMessage;
      expect(message.descriptor.filters.length).to.equal(1);
      expect(message.descriptor.filters[0].protocol).to.eq('http://example.com');
    });

    it('should auto-normalize schema URL', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const options = {
        recipient           : alice.did,
        authorizationSigner : Jws.createSigner(alice),
        filters             : [{ schema: 'example.com/' }],
      };
      const eventsQuery = await EventsQuery.create(options);

      const message = eventsQuery.message as EventsQueryMessage;

      expect(message.descriptor.filters.length).to.equal(1);
      expect(message.descriptor.filters[0].schema).to.eq('http://example.com');
    });

    it('throws an exception if message has no filters', async () => {
      const alice = await TestDataGenerator.generatePersona();
      const currentTime = getCurrentTimeInHighPrecision();

      try {
        await EventsQuery.create({
          filters             : [],
          messageTimestamp    : currentTime,
          authorizationSigner : Jws.createSigner(alice),
        });
        expect.fail();
      } catch (e: any) {
        expect(e.message).to.include('fewer than 1 items');
      }
    });

    it('throws an exception if message has an empty filter', async () => {
      const alice = await TestDataGenerator.generatePersona();
      const currentTime = getCurrentTimeInHighPrecision();

      try {
        await EventsQuery.create({
          filters             : [{ schema: 'schema' },{ }], // one empty filter
          messageTimestamp    : currentTime,
          authorizationSigner : Jws.createSigner(alice),
        });
        expect.fail();
      } catch (e: any) {
        expect(e.message).to.include('fewer than 1 properties');
      }
    });
  });

  describe('parse', () => {
    it('parses a message into an EventsQuery instance', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const currentTime = getCurrentTimeInHighPrecision();

      const eventsQuery = await EventsQuery.create({
        filters             : [{ schema: 'anything' }],
        messageTimestamp    : currentTime,
        authorizationSigner : Jws.createSigner(alice),
      });

      const parsed = await EventsQuery.parse(eventsQuery.message);
      expect(parsed).to.be.instanceof(EventsQuery);

      const expectedMessageCid = await Message.getCid(eventsQuery.message);
      const messageCid = await Message.getCid(parsed.message);

      expect(messageCid).to.equal(expectedMessageCid);
    });

    it('throws an exception if message is not a valid EventsQuery message', async () => {
      const alice = await TestDataGenerator.generatePersona();
      const currentTime = getCurrentTimeInHighPrecision();
      const eventsQuery = await EventsQuery.create({
        filters             : [{ schema: 'anything' }],
        messageTimestamp    : currentTime,
        authorizationSigner : Jws.createSigner(alice),
      });

      const { message } = eventsQuery;
      (message.descriptor as any)['bad_property'] = 'property';

      try {
        await EventsQuery.parse(message as any);
        expect.fail();
      } catch (e: any) {
        expect(e.message).to.include('additional properties');
      }
    });

    it('throws an exception if message has no filters', async () => {
      const alice = await TestDataGenerator.generatePersona();
      const currentTime = getCurrentTimeInHighPrecision();
      const eventsQuery = await EventsQuery.create({
        filters             : [{ schema: 'anything' }],
        messageTimestamp    : currentTime,
        authorizationSigner : Jws.createSigner(alice),
      });

      const { message } = eventsQuery;
      message.descriptor.filters = []; //empty out the filters

      try {
        await EventsQuery.parse(message as any);
        expect.fail();
      } catch (e: any) {
        expect(e.message).to.include('fewer than 1 items');
      }
    });

    it('throws an exception if message has an empty filter', async () => {
      const alice = await TestDataGenerator.generatePersona();
      const currentTime = getCurrentTimeInHighPrecision();
      const eventsQuery = await EventsQuery.create({
        filters             : [{ schema: 'anything' }],
        messageTimestamp    : currentTime,
        authorizationSigner : Jws.createSigner(alice),
      });

      const { message } = eventsQuery;
      message.descriptor.filters.push({ }); // add an empty filter

      try {
        await EventsQuery.parse(message as any);
        expect.fail();
      } catch (e: any) {
        expect(e.message).to.include('fewer than 1 properties');
      }
    });
  });
});
