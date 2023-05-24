import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

import type { ProtocolsConfigureMessage } from '../../../../src/index.js';

import dexProtocolDefinition from '../../../vectors/protocol-definitions/dex.json' assert { type: 'json' };
import { TestDataGenerator } from '../../../utils/test-data-generator.js';
import { getCurrentTimeInHighPrecision, sleep } from '../../../../src/utils/time.js';
import { Jws, ProtocolsConfigure } from '../../../../src/index.js';

chai.use(chaiAsPromised);

describe('ProtocolsConfigure', () => {
  describe('create()', () => {
    it('should use `dateCreated` as is if given', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const currentTime = getCurrentTimeInHighPrecision();
      const definition = { ...dexProtocolDefinition };
      const protocolsConfigure = await ProtocolsConfigure.create({
        dateCreated                 : currentTime,
        definition,
        authorizationSignatureInput : Jws.createSignatureInput(alice),
      });

      expect(protocolsConfigure.message.descriptor.dateCreated).to.equal(currentTime);
    });

    it('should auto-normalize protocol URI', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const definition = { ...dexProtocolDefinition, protocol: 'example.com/' };
      const options = {
        recipient                   : alice.did,
        data                        : TestDataGenerator.randomBytes(10),
        dataFormat                  : 'application/json',
        authorizationSignatureInput : Jws.createSignatureInput(alice),
        definition,
      };
      const protocolsConfig = await ProtocolsConfigure.create(options);

      const message = protocolsConfig.message as ProtocolsConfigureMessage;

      expect(message.descriptor.definition.protocol).to.eq('http://example.com');
    });

    it('should auto-normalize schema URIs', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const nonnormalizedDexProtocol = { ...dexProtocolDefinition };
      nonnormalizedDexProtocol.types.ask.schema = 'ask';

      const options = {
        recipient                   : alice.did,
        data                        : TestDataGenerator.randomBytes(10),
        dataFormat                  : 'application/json',
        authorizationSignatureInput : Jws.createSignatureInput(alice),
        protocol                    : 'example.com/',
        definition                  : nonnormalizedDexProtocol
      };
      const protocolsConfig = await ProtocolsConfigure.create(options);

      const message = protocolsConfig.message as ProtocolsConfigureMessage;
      expect(message.descriptor.definition.types.ask.schema).to.eq('http://ask');
    });
  });

  describe('getNewestMessage()', () => {
    it('returns the newest message in the list', async () => {
      const { message: oldest } = await TestDataGenerator.generateProtocolsConfigure();
      await sleep(1);
      const { message: middle } = await TestDataGenerator.generateProtocolsConfigure();
      await sleep(1);
      const { message: newest } = await TestDataGenerator.generateProtocolsConfigure();

      const result = await ProtocolsConfigure.getNewestMessage([middle, newest, oldest]);
      expect(result).to.equal(newest);
    });
  });
});

