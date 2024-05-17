import { base64url } from 'multiformats/bases/base64';
import { DwnErrorCode } from '../../src/core/dwn-error.js';
import { expect } from 'chai';
import { Secp256k1 } from '../../src/utils/secp256k1.js';
import { TestDataGenerator } from './test-data-generator.js';

describe('Secp256k1', () => {
  describe('generateKeyPairRaw()', () => {
    it('should generate compressed publicKey', async () => {
      const { publicKey } = await Secp256k1.generateKeyPairRaw();
      expect(publicKey.length).to.equal(33);
    });
  });

  describe('validateKey()', () => {
    it('should throw if key is not a valid SECP256K1 key', async () => {
      const validKey = (await Secp256k1.generateKeyPair()).publicJwk;

      expect(() => Secp256k1.validateKey({ ...validKey, kty: 'invalidKty' as any })).to.throw(DwnErrorCode.Secp256k1KeyNotValid);
      expect(() => Secp256k1.validateKey({ ...validKey, crv: 'invalidCrv' as any })).to.throw(DwnErrorCode.Secp256k1KeyNotValid);
    });
  });

  describe('publicKeyToJwk()', () => {
    it('should generate the same JWK regardless of compressed or compressed public key bytes given', async () => {
      const compressedPublicKeyBase64UrlString = 'A5roVr1J6MufaaBwweb5Q75PrZCbZpzC55kTCO68ylMs';
      const uncompressedPublicKeyBase64UrlString = 'BJroVr1J6MufaaBwweb5Q75PrZCbZpzC55kTCO68ylMsyC3G4QfbKeDzIr2BwyMUQ3Na1mxPvwxJ8GBMO3jkGL0';

      const compressedPublicKey = base64url.baseDecode(compressedPublicKeyBase64UrlString);
      const uncompressedPublicKey = base64url.baseDecode(uncompressedPublicKeyBase64UrlString);

      const publicJwk1 = await Secp256k1.publicKeyToJwk(compressedPublicKey);
      const publicJwk2 = await Secp256k1.publicKeyToJwk(uncompressedPublicKey);

      expect(publicJwk1.x).to.equal(publicJwk2.x);
      expect(publicJwk1.y).to.equal(publicJwk2.y);
    });
  });

  describe('sign()', () => {
    it('should generate the signature in compact format', async () => {
      const { privateJwk } = await Secp256k1.generateKeyPair();

      const contentBytes = TestDataGenerator.randomBytes(16);
      const signatureBytes = await Secp256k1.sign(contentBytes, privateJwk);

      expect(signatureBytes.length).to.equal(64); // DER format would be 70 bytes
    });
  });
});
