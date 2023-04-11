import { base64url } from 'multiformats/bases/base64';
import { Comparer } from './comparer.js';
import { DwnErrorCode } from '../../src/core/dwn-error.js';
import { expect } from 'chai';
import { Secp256k1 } from '../../src/utils/secp256k1.js';
import { TestDataGenerator } from './test-data-generator.js';

describe('Secp256k1', () => {
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

  describe('deriveChildPublic/PrivateKey()', () => {
    it('should derive the same key pair counterparts when given the same tweak input', async () => {
      const { publicKey, privateKey } = await Secp256k1.generateKeyPairRaw();

      const tweakInput = TestDataGenerator.randomBytes(32);
      const derivedPrivateKey = Secp256k1.deriveChildPrivateKey(privateKey, tweakInput);
      const derivedPublicKey = Secp256k1.deriveChildPublicKey(publicKey, tweakInput);

      const publicKeyFromDerivedPrivateKey = await Secp256k1.getPublicKey(derivedPrivateKey);
      expect(Comparer.byteArraysEqual(derivedPublicKey, publicKeyFromDerivedPrivateKey)).to.be.true;
    });
  });

  describe('derivePublic/PrivateKey()', () => {
    it('should be able to derive same key using different ancestor along the chain path', async () => {
      const { publicKey, privateKey } = await Secp256k1.generateKeyPairRaw();

      const fullPathToG = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
      const fullPathToD = ['a', 'b', 'c', 'd'];
      const relativePathFromDToG = ['e', 'f', 'g'];

      // testing public key derivation from different ancestor in the same chain
      const publicKeyG = await Secp256k1.derivePublicKey(publicKey, fullPathToG);
      const publicKeyD = await Secp256k1.derivePublicKey(publicKey, fullPathToD);
      const publicKeyGFromD = await Secp256k1.derivePublicKey(publicKeyD, relativePathFromDToG);
      expect(Comparer.byteArraysEqual(publicKeyG, publicKeyGFromD)).to.be.true;

      // testing private key derivation from different ancestor in the same chain
      const privateKeyG = await Secp256k1.derivePrivateKey(privateKey, fullPathToG);
      const privateKeyD = await Secp256k1.derivePrivateKey(privateKey, fullPathToD);
      const privateKeyGFromD = await Secp256k1.derivePrivateKey(privateKeyD, relativePathFromDToG);
      expect(Comparer.byteArraysEqual(privateKeyG, privateKeyGFromD)).to.be.true;

      // testing that the derived private key matches up with the derived public key
      const publicKeyGFromPrivateKeyG = await Secp256k1.getPublicKey(privateKeyG);
      expect(Comparer.byteArraysEqual(publicKeyGFromPrivateKeyG, publicKeyG)).to.be.true;
    });

    it('should derive the same public key using either the private or public counterpart of the same key pair', async () => {
      const { publicKey, privateKey } = await Secp256k1.generateKeyPairRaw();

      const path = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];

      const derivedKeyFromPublicKey = await Secp256k1.derivePublicKey(publicKey, path);
      const derivedKeyFromPrivateKey = await Secp256k1.derivePublicKey(privateKey, path);
      expect(Comparer.byteArraysEqual(derivedKeyFromPublicKey, derivedKeyFromPrivateKey)).to.be.true;
    });

    it('should derive the same public key using either the private or public counterpart of the same key pair', async () => {
      const { publicKey, privateKey } = await Secp256k1.generateKeyPairRaw();

      const invalidPath = ['should not have segment with empty string', ''];

      await expect(Secp256k1.derivePublicKey(publicKey, invalidPath)).to.be.rejectedWith(DwnErrorCode.HdKeyDerivationPathInvalid);
      await expect(Secp256k1.derivePrivateKey(privateKey, invalidPath)).to.be.rejectedWith(DwnErrorCode.HdKeyDerivationPathInvalid);
    });
  });
});
