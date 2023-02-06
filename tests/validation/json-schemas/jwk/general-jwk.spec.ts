import { expect } from 'chai';
import { signers } from '../../../../src/jose/algorithms/signing/signers.js';
import { validateJsonSchema } from '../../../../src/schema-validator.js';

const { Ed25519, secp256k1 } = signers;

describe('GeneralJwk Schema', async () => {
  const jwkSecp256k1 = await secp256k1.generateKeyPair();
  const jwkEd25519 = await Ed25519.generateKeyPair();

  const jwkRsa = {
    publicJwk: {
      'kty' : 'RSA',
      'e'   : 'AQAB',
      'use' : 'sig',
      'alg' : 'RS256',
      'n'   : 'abcd1234'
    },
    privateJwk: {
      'p'   : 'pProp',
      'kty' : 'RSA',
      'q'   : 'qProp',
      'd'   : 'dProp',
      'e'   : 'eProp',
      'use' : 'sig',
      'qi'  : 'qiProp',
      'dp'  : 'dpProp',
      'alg' : 'RS256',
      'dq'  : 'dqProp',
      'n'   : 'nProp'
    }
  };

  [
    jwkEd25519,
    jwkSecp256k1,
    jwkRsa
  ].forEach((jwk): void => {
    it('should not throw an exception if properly formatted jwk', () => {
      expect(
        () => validateJsonSchema('GeneralJwk', jwk.publicJwk)
      ).to.not.throw();
      expect(
        () => validateJsonSchema('GeneralJwk', jwk.privateJwk)
      ).to.not.throw();
    });
  });
});
