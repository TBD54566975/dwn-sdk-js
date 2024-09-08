import { MessagesSubscribe } from '../../src/interfaces/messages-subscribe.js';
import { DwnInterfaceName, DwnMethodName, Jws, TestDataGenerator, Time } from '../../src/index.js';

import { expect } from 'chai';

describe('MessagesSubscribe', () => {
  describe('create()', () => {
    it('should be able to create and authorize MessagesSubscribe', async () => {
      const alice = await TestDataGenerator.generateDidKeyPersona();
      const timestamp = Time.getCurrentTimestamp();
      const messagesSubscribe = await MessagesSubscribe.create({
        signer           : Jws.createSigner(alice),
        messageTimestamp : timestamp,
      });

      const message = messagesSubscribe.message;
      expect(message.descriptor.interface).to.eql(DwnInterfaceName.Messages);
      expect(message.descriptor.method).to.eql(DwnMethodName.Subscribe);
      expect(message.authorization).to.exist;
      expect(message.descriptor.messageTimestamp).to.equal(timestamp);
    });
  });
});
