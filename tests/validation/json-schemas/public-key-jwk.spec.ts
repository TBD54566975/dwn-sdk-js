import { expect } from 'chai';
import { validate } from '../../../src/validation/validator';
import { signers } from '../../../src/jose/algorithms';
import { PublicJwk } from '../../../src/jose/types';

const { Ed25519, secp256k1 } = signers;

describe('PublicKeyJwk', async () => {
  const { publicJwk: publicJwkSecp256k1 } = await secp256k1.generateKeyPair();
  const { publicJwk: publicJwkEd25519 } = await Ed25519.generateKeyPair();

  [publicJwkSecp256k1, publicJwkEd25519].forEach((publicJwk): void => {
    console.log(publicJwk);
    it('should not throw an exception if properly formatted publicJwk', () => {
      expect(
        () => validate('PublicKeyJwk', publicJwk)
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
    console.log(invalidPublicJwk);
    it('should throw an exception if publicJwk is invalid', () => {
      expect(
        () => validate('PublicKeyJwk', invalidPublicJwk)
      ).to.throw(err);
    });
  });

});
