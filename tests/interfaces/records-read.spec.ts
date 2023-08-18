import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

import { getCurrentTimeInHighPrecision } from '../../src/utils/time.js';
import { RecordsRead } from '../../src/interfaces/records-read.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { throws } from 'assert';
import { DwnErrorCode, DwnInterfaceName, DwnMethodName, Jws } from '../../src/index.js';

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

    it('should reject if `recordId`, `protocol` and `protocolPath` are all missing', async () => {
      const alice = await TestDataGenerator.generatePersona();
      const readPromise = RecordsRead.create({
        authorizationSignatureInput: Jws.createSignatureInput(alice),
      });

      await expect(readPromise).to.be.rejectedWith(DwnErrorCode.RecordsReadMissingCreateProperties);
    });

    it('should not reject if only `recordId` is passed', async () => {
      const alice = await TestDataGenerator.generatePersona();
      const readPromiseSuccess = RecordsRead.create({
        recordId                    : 'some-id',
        authorizationSignatureInput : Jws.createSignatureInput(alice),
      });

      await expect(readPromiseSuccess).to.not.be.rejected;
    });

    it('should reject if only one of `protocol` or `protocolPath` are set', async () => {
      const alice = await TestDataGenerator.generatePersona();
      // with only protocolPath
      const protocolPathOnlyP = RecordsRead.create({
        protocolPath                : 'some/path',
        authorizationSignatureInput : Jws.createSignatureInput(alice),
      });

      await expect(protocolPathOnlyP).to.be.rejectedWith(DwnErrorCode.RecordsReadMissingCreateProperties);
      // with only protocolPath
      const protocolOnlyP = RecordsRead.create({
        protocol                    : 'protocol',
        authorizationSignatureInput : Jws.createSignatureInput(alice),
      });

      await expect(protocolOnlyP).to.be.rejectedWith(DwnErrorCode.RecordsReadMissingCreateProperties);

      const readPromiseSuccess = RecordsRead.create({
        protocol                    : 'protocol',
        protocolPath                : 'some/path',
        authorizationSignatureInput : Jws.createSignatureInput(alice),
      });

      await expect(readPromiseSuccess).to.not.be.rejected;
    });
  });

  describe('createFilter()', async () => {
    it('should throw if `recordId`, `protocol` and `protocolPath` are left empty', async () => {
      throws(() => RecordsRead.createFilter({
        interface        : DwnInterfaceName.Records,
        method           : DwnMethodName.Read,
        messageTimestamp : '2023-08-19T00:00:00.000000Z'
      }), /missing required properties from RecordsRead descriptor/);
    });

    it('should throw if only `protocolPath` is set', async () => {
      throws(() => RecordsRead.createFilter({
        interface        : DwnInterfaceName.Records,
        method           : DwnMethodName.Read,
        messageTimestamp : '2023-08-19T00:00:00.000000Z',

        protocolPath: 'email/email'
      }), /missing required properties from RecordsRead descriptor/);
    });

    it('should throw if only `protocol` is set', async () => {
      throws(() => RecordsRead.createFilter({
        interface        : DwnInterfaceName.Records,
        method           : DwnMethodName.Read,
        messageTimestamp : '2023-08-19T00:00:00.000000Z',

        protocol: 'example.org/Protocol'
      }), /missing required properties from RecordsRead descriptor/);
    });

    it('should not throw if only `recordId` is set', async () => {
      const filter = RecordsRead.createFilter({
        interface        : DwnInterfaceName.Records,
        method           : DwnMethodName.Read,
        messageTimestamp : '2023-08-19T00:00:00.000000Z',

        recordId: 'some-id'
      });

      expect(filter['recordId']).to.equal('some-id');
    });

    it('should not throw if `protocol` and `protocolPath` are set', async () => {
      const filter = RecordsRead.createFilter({
        interface        : DwnInterfaceName.Records,
        method           : DwnMethodName.Read,
        messageTimestamp : '2023-08-19T00:00:00.000000Z',

        protocol     : 'some-protocol',
        protocolPath : 'protocol/path'
      });

      expect(filter['protocol']).to.equal('some-protocol');
      expect(filter['protocolPath']).to.equal('protocol/path');
    });

    it('should not set protocol filters if `recordId` is provided', async () => {
      const filter = RecordsRead.createFilter({
        interface        : DwnInterfaceName.Records,
        method           : DwnMethodName.Read,
        messageTimestamp : '2023-08-19T00:00:00.000000Z',

        protocol     : 'some-protocol',
        protocolPath : 'protocol/path',
        recordId     : 'some-id'
      });

      expect(filter['recordId']).to.equal('some-id');
      expect(filter['protocol']).to.be.undefined;
      expect(filter['protocolPath']).to.be.undefined;
    });
  });
});

