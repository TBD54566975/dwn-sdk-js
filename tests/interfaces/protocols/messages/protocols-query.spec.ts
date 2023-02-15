import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

import { getCurrentTimeInHighPrecision } from '../../../../src/utils/time.js';
import { Jws } from '../../../../src/index.js';
import { ProtocolsQuery } from '../../../../src/interfaces/protocols/messages/protocols-query.js';
import { TestDataGenerator } from '../../../utils/test-data-generator.js';

chai.use(chaiAsPromised);

describe('ProtocolsQuery', () => {
  describe('create()', () => {
    it('should use `dateCreated` as is if given', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const currentTime = getCurrentTimeInHighPrecision();
      const protocolsQuery = await ProtocolsQuery.create({
        filter                      : { protocol: 'anyValue' },
        dateCreated                 : currentTime,
        authorizationSignatureInput : Jws.createSignatureInput(alice),
      });

      expect(protocolsQuery.message.descriptor.dateCreated).to.equal(currentTime);
    });
  });
});

