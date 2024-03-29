import { base64url } from 'multiformats/bases/base64';
import { DwnErrorCode } from '../../src/core/dwn-error.js';
import { expect } from 'chai';
import { p256 } from '@noble/curves/p256';
import { Secp256r1 } from '../../src/utils/secp256r1.js';
import { TestDataGenerator } from './test-data-generator.js';

describe('Secp256r1', () => {
  describe('validateKey()', () => {
    it('should throw if key is not a valid SECP256R1 key', async () => {
      const validKey = (await Secp256r1.generateKeyPair()).publicJwk;

      expect(() =>
        Secp256r1.validateKey({ ...validKey, kty: 'invalidKty' as any })
      ).to.throw(DwnErrorCode.Secp256r1KeyNotValid);
      expect(() =>
        Secp256r1.validateKey({ ...validKey, crv: 'invalidCrv' as any })
      ).to.throw(DwnErrorCode.Secp256r1KeyNotValid);
    });
  });

  describe('publicKeyToJwk()', () => {
    it('should generate the same JWK regardless of compressed or uncompressed public key bytes given', async () => {
      const compressedPublicKeyBase64UrlString =
        'Aom0shYia6t0cNMRQDRzPgCxdMWQamrfX3UJfOroLHo_';
      const uncompressedPublicKeyBase64UrlString =
        'BIm0shYia6t0cNMRQDRzPgCxdMWQamrfX3UJfOroLHo_cSITyng0NN1lt2BtZVXH4PE9Gerxq_mw2_CpbBHsWUI';

      const compressedPublicKey = base64url.baseDecode(
        compressedPublicKeyBase64UrlString
      );

      const uncompressedPublicKey = base64url.baseDecode(
        uncompressedPublicKeyBase64UrlString
      );

      const publicJwk1 = await Secp256r1.publicKeyToJwk(compressedPublicKey);
      const publicJwk2 = await Secp256r1.publicKeyToJwk(uncompressedPublicKey);

      expect(publicJwk1.x).to.equal(publicJwk2.x);
      expect(publicJwk1.y).to.equal(publicJwk2.y);
    });
  });

  describe('verify()', () => {
    it('should correctly handle DER formatted signatures', async () => {
      const { privateJwk, publicJwk } = await Secp256r1.generateKeyPair();

      const content = TestDataGenerator.randomBytes(16);

      const signature = await Secp256r1.sign(content, privateJwk);

      // Convert the signature to DER format
      const derSignature =
        p256.Signature.fromCompact(signature).toDERRawBytes();

      const result = await Secp256r1.verify(content, derSignature, publicJwk);

      expect(result).to.equal(true);
    });
  });

  describe('sign()', () => {
    it('should generate the signature in compact format', async () => {
      const { privateJwk } = await Secp256r1.generateKeyPair();

      const contentBytes = TestDataGenerator.randomBytes(16);
      const signatureBytes = await Secp256r1.sign(contentBytes, privateJwk);

      expect(signatureBytes.length).to.equal(64); // DER format would be 70 bytes
    });
  });
});
