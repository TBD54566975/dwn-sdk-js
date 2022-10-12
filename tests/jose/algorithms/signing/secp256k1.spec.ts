import { base64url } from 'multiformats/bases/base64';
import { expect } from 'chai';
import { secp256k1 } from '../../../../src/jose/algorithms/signing/secp256k1';
import { TestDataGenerator } from '../../../utils/test-data-generator';

describe('secp256k1', () => {
  describe('publicKeyToJwk', () => {
    it('should generate the same JWK regardless of compressed or compressed public key bytes given', async () => {
      const compressedPublicKeyBase64UrlString = 'A5roVr1J6MufaaBwweb5Q75PrZCbZpzC55kTCO68ylMs';
      const uncompressedPublicKeyBase64UrlString = 'BJroVr1J6MufaaBwweb5Q75PrZCbZpzC55kTCO68ylMsyC3G4QfbKeDzIr2BwyMUQ3Na1mxPvwxJ8GBMO3jkGL0';

      const compressedPublicKey = base64url.baseDecode(compressedPublicKeyBase64UrlString);
      const uncompressedPublicKey = base64url.baseDecode(uncompressedPublicKeyBase64UrlString);

      const publicJwk1 = await secp256k1.publicKeyToJwk(compressedPublicKey);
      const publicJwk2 = await secp256k1.publicKeyToJwk(uncompressedPublicKey);

      expect(publicJwk1.x).to.equal(publicJwk2.x);
      expect(publicJwk1.y).to.equal(publicJwk2.y);
    });
  });

  it('should generate the signature in compact format', async () => {
    const { privateJwk } = await secp256k1.generateKeyPair();

    const contentBytes = TestDataGenerator.randomBytes(16);
    const signatureBytes = await secp256k1.sign(contentBytes, privateJwk);

    expect(signatureBytes.length).to.equal(64); // DER format would be 70 bytes
  });
});
