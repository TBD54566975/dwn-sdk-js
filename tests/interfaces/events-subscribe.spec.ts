import { EventsSubscribe } from '../../src/interfaces/events-subscribe.js';
import { DidKeyResolver, DwnInterfaceName, DwnMethodName, Jws, Time } from '../../src/index.js';

import { expect } from 'chai';

describe('EventsSubscribe', () => {
  describe('create()', () => {
    it('should be able to create and authorize EventsSubscribe', async () => {
      const alice = await DidKeyResolver.generate();
      const timestamp = Time.getCurrentTimestamp();
      const { message } = await EventsSubscribe.create({
        signer           : Jws.createSigner(alice),
        messageTimestamp : timestamp,
      });

      expect(message.descriptor.interface).to.eql(DwnInterfaceName.Events);
      expect(message.descriptor.method).to.eql(DwnMethodName.Subscribe);
      expect(message.authorization).to.exist;
      expect(message.descriptor.messageTimestamp).to.equal(timestamp);
    });
  });
});
