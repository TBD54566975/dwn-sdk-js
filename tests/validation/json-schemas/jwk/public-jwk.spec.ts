import { expect } from 'chai';
import { signers } from '../../../../src/jose/algorithms/signing/signers.js';
import { validateJsonSchema } from '../../../../src/schema-validator.js';

const { Ed25519, secp256k1 } = signers;

describe('PublicJwk Schema', async () => {
  const { publicJwk: publicJwkSecp256k1 } = await secp256k1.generateKeyPair();
  const { publicJwk: publicJwkEd25519 } = await Ed25519.generateKeyPair();

  const publicJwkRsa = {
    'kty' : 'RSA',
    'e'   : 'AQAB',
    'use' : 'sig',
    'alg' : 'RS256',
    'n'   : 'abcd1234'
  };
  it('should not throw an exception if properly formatted publicJwk', () => {
    expect(
      () => validateJsonSchema('PublicJwk', publicJwkSecp256k1)
    ).to.not.throw();
    expect(
      () => validateJsonSchema('PublicJwk', publicJwkEd25519)
    ).to.not.throw();
    expect(
      () => validateJsonSchema('PublicJwk', publicJwkRsa)
    ).to.not.throw();
  });

  it('should throw an exception if publicJwk has private property', () => {
    expect(
      () => validateJsonSchema('PublicJwk', { ...publicJwkSecp256k1, d: 'supersecret' })
    ).to.throw();
    expect(
      () => validateJsonSchema('PublicJwk', { ...publicJwkEd25519, d: 'supersecret' })
    ).to.throw();
    expect(
      () => validateJsonSchema('PublicJwk', { ...publicJwkRsa, oth: {} })
    ).to.throw();
    expect(
      () => validateJsonSchema('PublicJwk', { ...publicJwkRsa, d: 'supersecret', oth: {} })
    ).to.throw();
  });

});
