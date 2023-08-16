import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

import { getCurrentTimeInHighPrecision } from '../../src/utils/time.js';
import { Jws } from '../../src/index.js';
import { RecordsRead } from '../../src/interfaces/records-read.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { throws } from 'assert';

chai.use(chaiAsPromised);

describe('RecordsRead', () => {
  describe('create()', () => {
    it('should use `messageTimestamp` as is if given', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const currentTime = getCurrentTimeInHighPrecision();
      const recordsRead = await RecordsRead.create({
        recordId                    : 'anything',
        authorizationSignatureInput : Jws.createSignatureInput(alice),
        date                        : currentTime
      });

      expect(recordsRead.message.descriptor.messageTimestamp).to.equal(currentTime);
    });

    it('should require `recordId` when `protocol` and `protocolPath` are not set', async () => {
      const alice = await TestDataGenerator.generatePersona();
      const currentTime = getCurrentTimeInHighPrecision();
      const readPromise = RecordsRead.create({
        authorizationSignatureInput : Jws.createSignatureInput(alice),
        date                        : currentTime
      });

      await expect(readPromise).to.be.rejectedWith('must have required property \'recordId\'');
    });

    it('should require `recordId` when `protocolPath` is set and `protocol` is not set', async () => {
      const alice = await TestDataGenerator.generatePersona();
      const currentTime = getCurrentTimeInHighPrecision();
      const readPromise = RecordsRead.create({
        protocolPath                : 'some/path',
        authorizationSignatureInput : Jws.createSignatureInput(alice),
        date                        : currentTime
      });

      await expect(readPromise).to.be.rejectedWith('must have required property \'recordId\'');
    });

    it('should require `recordId` when `protocol` is set and `protocolPath` is not set', async () => {
      const alice = await TestDataGenerator.generatePersona();
      const currentTime = getCurrentTimeInHighPrecision();
      const readPromise = RecordsRead.create({
        protocol                    : 'example.com/Proto',
        authorizationSignatureInput : Jws.createSignatureInput(alice),
        date                        : currentTime
      });

      await expect(readPromise).to.be.rejectedWith('must have required property \'recordId\'');
    });
  });

  describe('createFilter()', async () => {
    it('should throw if `recordId`, `protocol` and `protocolPath` are left empty', async () => {
      throws(() => RecordsRead.createFilter({
        //empty descriptor
      }), /missing required properties from RecordsRead descriptor/);
    });

    it('should throw if only `protocolPath` is set', async () => {
      throws(() => RecordsRead.createFilter({
        // only protocolPath
        protocolPath: 'email/email'
      }), /missing required properties from RecordsRead descriptor/);
    });

    it('should throw if only `protocol` is set', async () => {
      throws(() => RecordsRead.createFilter({
        // only protocol
        protocol: 'example.org/Protocol'
      }), /missing required properties from RecordsRead descriptor/);
    });

    it('should not throw if only `recordId` is set', async () => {
      const filter = RecordsRead.createFilter({
        recordId: 'some-id'
      });

      expect(filter['recordId']).to.equal('some-id');
    });

    it('should not throw if `protocol` and `protocolPath` are set', async () => {
      const filter = RecordsRead.createFilter({
        protocol     : 'some-protocol',
        protocolPath : 'protocol/path'
      });

      expect(filter['protocol']).to.equal('some-protocol');
      expect(filter['protocolPath']).to.equal('protocol/path');
    });

    it('should not throw if `protocol` and `protocolPath` are set along with optional `parentId`', async () => {
      const filter = RecordsRead.createFilter({
        protocol     : 'some-protocol',
        protocolPath : 'protocol/path',
        parentId     : 'parent-id',
      });

      expect(filter['protocol']).to.equal('some-protocol');
      expect(filter['protocolPath']).to.equal('protocol/path');
      expect(filter['parentId']).to.equal('parent-id');
    });
  });
});

