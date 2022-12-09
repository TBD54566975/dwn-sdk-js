import { expect } from 'chai';
import { signers } from '../../../../src/jose/algorithms/index.js';
import { validate } from '../../../../src/validator.js';

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
      () => validate('PublicJwk', publicJwkSecp256k1)
    ).to.not.throw();
    expect(
      () => validate('PublicJwk', publicJwkEd25519)
    ).to.not.throw();
    expect(
      () => validate('PublicJwk', publicJwkRsa)
    ).to.not.throw();
  });

  it('should throw an exception if publicJwk has private property', () => {
    expect(
      () => validate('PublicJwk', { ...publicJwkSecp256k1, d: 'supersecret' })
    ).to.throw();
    expect(
      () => validate('PublicJwk', { ...publicJwkEd25519, d: 'supersecret' })
    ).to.throw();
    expect(
      () => validate('PublicJwk', { ...publicJwkRsa, oth: {} })
    ).to.throw();
    expect(
      () => validate('PublicJwk', { ...publicJwkRsa, d: 'supersecret', oth: {} })
    ).to.throw();
  });

});
