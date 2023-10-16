import { ArrayUtility } from '../../src/utils/array.js';
import { base64url } from 'multiformats/bases/base64';
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

      expect(base64url.baseEncode(Secp256k1.publicJwkToBytes(publicJwk1, true))).to.equal(compressedPublicKeyBase64UrlString);
      expect(base64url.baseEncode(Secp256k1.publicJwkToBytes(publicJwk2, false))).to.equal(uncompressedPublicKeyBase64UrlString);
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

  describe('generateKeyPairRaw()', () => {
    it('should generate compressed and uncompressed publicKey', async ()=>{
      const { publicKey:uncompressed } = await Secp256k1.generateKeyPairRaw(false);
      expect(uncompressed.length).to.equal(65);
      const { publicKey:compressed } = await Secp256k1.generateKeyPairRaw(true);
      expect(compressed.length).to.equal(33);
    })
  });

  describe('derivePublic/PrivateKey()', () => {
    it('should be able to derive same key using different ancestor along the chain path', async () => {
      const { privateKey } = await Secp256k1.generateKeyPairRaw();

      const fullPathToG = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
      const fullPathToD = ['a', 'b', 'c', 'd'];
      const relativePathFromDToG = ['e', 'f', 'g'];

      // testing private key derivation from different ancestor in the same chain
      const privateKeyG = await Secp256k1.derivePrivateKey(privateKey, fullPathToG);
      const privateKeyD = await Secp256k1.derivePrivateKey(privateKey, fullPathToD);
      const privateKeyGFromD = await Secp256k1.derivePrivateKey(privateKeyD, relativePathFromDToG);
      expect(ArrayUtility.byteArraysEqual(privateKeyG, privateKeyGFromD)).to.be.true;

      // testing public key derivation from different ancestor private key in the same chain
      const publicKeyG = await Secp256k1.derivePublicKey(privateKey, fullPathToG);
      const publicKeyGFromD = await Secp256k1.derivePublicKey(privateKeyD, relativePathFromDToG);
      expect(ArrayUtility.byteArraysEqual(publicKeyG, publicKeyGFromD)).to.be.true;
    });

    it('should throw if derivation path is invalid', async () => {
      for(const compressed of [true, false]){
        const { publicKey, privateKey } = await Secp256k1.generateKeyPairRaw(compressed);

        const invalidPath = ['should not have segment with empty string', ''];

        await expect(Secp256k1.derivePublicKey(publicKey, invalidPath)).to.be.rejectedWith(DwnErrorCode.HdKeyDerivationPathInvalid);
        await expect(Secp256k1.derivePrivateKey(privateKey, invalidPath)).to.be.rejectedWith(DwnErrorCode.HdKeyDerivationPathInvalid);
      }
    });
  });
});
