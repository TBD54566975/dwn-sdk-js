import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

import dexProtocolDefinition from '../../../vectors/protocol-definitions/dex.json' assert { type: 'json' };
import { getCurrentTimeInHighPrecision } from '../../../../src/utils/time.js';
import { TestDataGenerator } from '../../../utils/test-data-generator.js';
import { Jws, ProtocolsConfigure } from '../../../../src/index.js';

chai.use(chaiAsPromised);

describe('ProtocolsConfigure', () => {
  describe('create()', () => {
    it('should use `dateCreated` as is if given', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const currentTime = getCurrentTimeInHighPrecision();
      const protocolsConfigure = await ProtocolsConfigure.create({
        dateCreated                 : currentTime,
        protocol                    : 'anyValue',
        definition                  : dexProtocolDefinition,
        authorizationSignatureInput : Jws.createSignatureInput(alice),
      });

      expect(protocolsConfigure.message.descriptor.dateCreated).to.equal(currentTime);
    });
  });
});

