import type { DerivedPrivateJwk, RecordsWriteDescriptor } from '../../src/index.js';

import { expect } from 'chai';

import { DwnErrorCode } from '../../src/core/dwn-error.js';
import { ed25519 } from '../../src/jose/algorithms/signing/ed25519.js';
import { DwnInterfaceName, DwnMethodName, KeyDerivationScheme, Records } from '../../src/index.js';

describe('Records', () => {
  describe('deriveLeafPrivateKey()', () => {
    it('should throw if given private key is not supported', async () => {
      const derivedKey: DerivedPrivateJwk = {
        rootKeyId         : 'unused',
        derivationScheme  : KeyDerivationScheme.ProtocolPath,
        derivedPrivateKey : (await ed25519.generateKeyPair()).privateJwk
      };
      await expect(Records.derivePrivateKey(derivedKey, ['a'])).to.be.rejectedWith(DwnErrorCode.RecordsDerivePrivateKeyUnSupportedCurve);
    });
  });

  describe('constructKeyDerivationPathUsingProtocolPathScheme()', () => {
    it('should throw if given a flat-space descriptor', async () => {
      const descriptor: RecordsWriteDescriptor = {
        interface        : DwnInterfaceName.Records,
        method           : DwnMethodName.Write,
        dataCid          : 'anyCid',
        dataFormat       : 'application/json',
        dataSize         : 123,
        dateCreated      : '2022-12-19T10:20:30.123456Z',
        messageTimestamp : '2022-12-19T10:20:30.123456Z',
      };

      expect(() => Records.constructKeyDerivationPathUsingProtocolPathScheme(descriptor))
        .to.throw(DwnErrorCode.RecordsProtocolPathDerivationSchemeMissingProtocol);
    });
  });

  describe('constructKeyDerivationPathUsingProtocolContextScheme()', () => {
    it('should throw if not given contextId', async () => {
      expect(() => Records.constructKeyDerivationPathUsingProtocolContextScheme(undefined))
        .to.throw(DwnErrorCode.RecordsProtocolContextDerivationSchemeMissingContextId);
    });
  });

  describe('constructKeyDerivationPathUsingSchemasScheme()', () => {
    it('should throw if not given schema', async () => {
      expect(() => Records.constructKeyDerivationPathUsingSchemasScheme(undefined))
        .to.throw(DwnErrorCode.RecordsSchemasDerivationSchemeMissingSchema);
    });
  });
});
