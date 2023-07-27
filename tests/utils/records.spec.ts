import type { DerivedPrivateJwk } from '../../src/index.js';

import { DwnErrorCode } from '../../src/core/dwn-error.js';
import { ed25519 } from '../../src/jose/algorithms/signing/ed25519.js';
import { expect } from 'chai';
import { KeyDerivationScheme, Records } from '../../src/index.js';

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
});
