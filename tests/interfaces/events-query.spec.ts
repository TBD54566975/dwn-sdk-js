import type { EventsQueryMessage } from '../../src/types/event-types.js';

import { EventsQuery } from '../../src/interfaces/events-query.js';
import { getCurrentTimeInHighPrecision } from '../../src/utils/time.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { Jws, Message } from '../../src/index.js';

import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

chai.use(chaiAsPromised);

describe('EventsQuery', () => {
  describe('create()', () => {
    it('should use `messageTimestamp` as is if given', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const currentTime = getCurrentTimeInHighPrecision();
      const eventsQuery = await EventsQuery.create({
        filter              : { schema: 'anything' },
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
        filter              : { protocol: 'example.com/' },
      };
      const eventsQuery = await EventsQuery.create(options);

      const message = eventsQuery.message as EventsQueryMessage;

      expect(message.descriptor.filter!.protocol).to.eq('http://example.com');
    });

    it('should auto-normalize schema URL', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const options = {
        recipient           : alice.did,
        authorizationSigner : Jws.createSigner(alice),
        filter              : { schema: 'example.com/' },
      };
      const eventsQuery = await EventsQuery.create(options);

      const message = eventsQuery.message as EventsQueryMessage;

      expect(message.descriptor.filter!.schema).to.eq('http://example.com');
    });
  });

  describe('parse', () => {
    it('parses a message into an EventsGet instance', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const currentTime = getCurrentTimeInHighPrecision();

      const eventsQuery = await EventsQuery.create({
        filter              : { schema: 'anything' },
        messageTimestamp    : currentTime,
        authorizationSigner : Jws.createSigner(alice),
      });

      const parsed = await EventsQuery.parse(eventsQuery.message);
      expect(parsed).to.be.instanceof(EventsQuery);

      const expectedMessageCid = await Message.getCid(eventsQuery.message);
      const messageCid = await Message.getCid(parsed.message);

      expect(messageCid).to.equal(expectedMessageCid);
    });

    it('throws an exception if message is not a valid EventsGet message', async () => {
      const alice = await TestDataGenerator.generatePersona();
      const currentTime = getCurrentTimeInHighPrecision();
      const eventsQuery = await EventsQuery.create({
        filter              : { schema: 'anything' },
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
  });
});

