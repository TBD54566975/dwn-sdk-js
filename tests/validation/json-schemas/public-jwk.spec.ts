import { expect } from 'chai';
import { validate } from '../../../src/validation/validator';
import { signers } from '../../../src/jose/algorithms';
import { PublicJwk } from '../../../src/jose/types';

const { Ed25519, secp256k1 } = signers;

describe('PublicJwk Schema', async () => {
  const { publicJwk: publicJwkSecp256k1 } = await secp256k1.generateKeyPair();
  const { publicJwk: publicJwkEd25519 } = await Ed25519.generateKeyPair();

  [publicJwkSecp256k1, publicJwkEd25519].forEach((publicJwk): void => {
    it('should not throw an exception if properly formatted publicJwk', () => {
      expect(
        () => validate('PublicJwk', publicJwk)
      ).to.not.throw();
    });
  });

  const failureParams: Array<[PublicJwk, string]> = [
    [publicJwkSecp256k1, ''],
    [publicJwkEd25519, '']
  ];

  failureParams.forEach(([publicJwk, err]): void => {
    const invalidPublicJwk = {
      d: 'supersecret',
      ...publicJwk
    };
    it('should throw an exception if publicJwk is invalid', () => {
      expect(
        () => validate('PublicJwk', invalidPublicJwk)
      ).to.throw(err);
    });
  });

});
