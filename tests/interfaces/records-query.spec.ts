import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

import type { RecordsQueryMessage } from '../../src/index.js';

import dexProtocolDefinition from '../vectors/protocol-definitions/dex.json' assert { type: 'json' };
import { getCurrentTimeInHighPrecision } from '../../src/utils/time.js';
import { Jws } from '../../src/index.js';
import { RecordsQuery } from '../../src/interfaces/records-query.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';

chai.use(chaiAsPromised);

describe('RecordsQuery', () => {
  describe('create()', () => {
    it('should use `messageTimestamp` as is if given', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const currentTime = getCurrentTimeInHighPrecision();
      const recordsQuery = await RecordsQuery.create({
        filter                      : { schema: 'anything' },
        messageTimestamp            : currentTime,
        authorizationSignatureInput : Jws.createSignatureInput(alice),
      });

      expect(recordsQuery.message.descriptor.messageTimestamp).to.equal(currentTime);
    });

    it('should auto-normalize protocol URL', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const options = {
        recipient                   : alice.did,
        data                        : TestDataGenerator.randomBytes(10),
        dataFormat                  : 'application/json',
        authorizationSignatureInput : Jws.createSignatureInput(alice),
        filter                      : { protocol: 'example.com/' },
        definition                  : dexProtocolDefinition
      };
      const recordsQuery = await RecordsQuery.create(options);

      const message = recordsQuery.message as RecordsQueryMessage;

      expect(message.descriptor.filter!.protocol).to.eq('http://example.com');
    });

    it('should auto-normalize schema URL', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const options = {
        recipient                   : alice.did,
        data                        : TestDataGenerator.randomBytes(10),
        dataFormat                  : 'application/json',
        authorizationSignatureInput : Jws.createSignatureInput(alice),
        filter                      : { schema: 'example.com/' },
        definition                  : dexProtocolDefinition
      };
      const recordsQuery = await RecordsQuery.create(options);

      const message = recordsQuery.message as RecordsQueryMessage;

      expect(message.descriptor.filter!.schema).to.eq('http://example.com');
    });
  });
});

