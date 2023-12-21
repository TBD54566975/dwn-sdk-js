import { EventsSubscribe } from '../../src/interfaces/events-subscribe.js';
import { DidKeyResolver, DwnInterfaceName, DwnMethodName, Jws } from '../../src/index.js';

import { expect } from 'chai';

describe('EventsSubscribe', () => {
  describe('create()', () => {
    it('should be able to create and authorize EventsSubscribe', async () => {
      const alice = await DidKeyResolver.generate();
      const { message } = await EventsSubscribe.create({
        signer: Jws.createSigner(alice)
      });

      expect(message.descriptor.interface).to.eql(DwnInterfaceName.Events);
      expect(message.descriptor.method).to.eql(DwnMethodName.Subscribe);
      expect(message.authorization).to.exist;
    });

  });
});
