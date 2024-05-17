import { ArrayUtility } from '../../src/utils/array.js';
import { DwnErrorCode } from '../../src/core/dwn-error.js';
import { expect } from 'chai';
import { HdKey } from '../../src/utils/hd-key.js';
import { Secp256k1 } from '../../src/utils/secp256k1.js';

describe('HdKey', () => {
  describe('derivePrivateKeyBytes()', () => {
    it('should be able to derive same key using different ancestor along the chain path', async () => {
      const { privateKey } = await Secp256k1.generateKeyPairRaw();

      const fullPathToG = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
      const fullPathToD = ['a', 'b', 'c', 'd'];
      const relativePathFromDToG = ['e', 'f', 'g'];

      // testing private key derivation from different ancestor in the same chain
      const privateKeyG = await HdKey.derivePrivateKeyBytes(privateKey, fullPathToG);
      const privateKeyD = await HdKey.derivePrivateKeyBytes(privateKey, fullPathToD);
      const privateKeyGFromD = await HdKey.derivePrivateKeyBytes(privateKeyD, relativePathFromDToG);
      expect(ArrayUtility.byteArraysEqual(privateKeyG, privateKeyGFromD)).to.be.true;
    });

    it('should throw if derivation path is invalid', async () => {
      const { privateKey } = await Secp256k1.generateKeyPairRaw();

      const invalidPath = ['should not have segment with empty string', ''];

      await expect(HdKey.derivePrivateKeyBytes(privateKey, invalidPath)).to.be.rejectedWith(DwnErrorCode.HdKeyDerivationPathInvalid);
    });
  });
});
