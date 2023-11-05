
import { EventsGet } from '../../src/interfaces/events-get.js';
import { expect } from 'chai';
import { Jws } from '../../src/index.js';
import { Message } from '../../src/core/message.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';

describe('EventsGet Message', () => {
  describe('create', () => {
    it('creates an EventsGet message', async () => {
      const alice = await TestDataGenerator.generatePersona();
      const eventsGet = await EventsGet.create({
        watermark : 'yolo',
        signer    : await Jws.createSigner(alice)
      });

      const { message } = eventsGet;
      expect(message.descriptor).to.exist;
      expect(message.descriptor.watermark).to.equal('yolo');
      expect(message.authorization).to.exist;
    });

    it('does not require a watermark', async () => {
      const alice = await TestDataGenerator.generatePersona();
      const eventsGet = await EventsGet.create({
        signer: await Jws.createSigner(alice)
      });

      const message = eventsGet.message;
      expect(message.descriptor).to.exist;
      expect(message.descriptor.watermark).to.not.exist;
      expect(message.authorization).to.exist;
    });
  });

  describe('parse', () => {
    it('parses a message into an EventsGet instance', async () => {
      const alice = await TestDataGenerator.generatePersona();
      const eventsGet = await EventsGet.create({
        watermark : 'yolo',
        signer    : await Jws.createSigner(alice)
      });

      const parsed = await EventsGet.parse(eventsGet.message);
      expect(parsed).to.be.instanceof(EventsGet);

      const expectedMessageCid = await Message.getCid(eventsGet.message);
      const messageCid = await Message.getCid(parsed.message);

      expect(messageCid).to.equal(expectedMessageCid);
    });

    it('throws an exception if message is not a valid EventsGet message', async () => {
      const alice = await TestDataGenerator.generatePersona();
      const eventsGet = await EventsGet.create({
        watermark : 'yolo',
        signer    : await Jws.createSigner(alice)
      });

      const { message } = eventsGet;
      (message as any)['hehe'] = 'troll';

      try {
        await EventsGet.parse(message as any);
        expect.fail();
      } catch (e: any) {
        expect(e.message).to.include('additional properties');
      }
    });
  });
});