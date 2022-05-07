import * as jwk from '../../src/jose/jwk';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';

// extend chai to test promises
chai.use(chaiAsPromised);

describe('Jwk', () => {
  describe('validateJwkPublic', () => {
    it('should throw error if JWK is missing a required property',  async () => {
      const invalidPublicKeyJwk = {
        // kty : 'EC', // intentionally missing `kty` property
        crv : 'secp256k1',
        x   : 'tXSKB_rubXS7sCjXqupVJEzTcW3MsjmEvq1YpXn96Zg',
        y   : 'dOicXqbjFxoGJ-K0-GJ1kHYJqic_D_OMuUwkQ7Ol6nk'
      };
      expect(() => jwk.validateJwkPublic(invalidPublicKeyJwk)).to.throw('invalid or unsupported JWK public key');
    });
  });
});
