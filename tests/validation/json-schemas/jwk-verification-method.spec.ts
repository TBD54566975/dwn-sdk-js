import { expect } from 'chai';
import { validate } from '../../../src/validation/validator';
import { signers } from '../../../src/jose/algorithms';

const { secp256k1 } = signers;

describe('JwkVerificationMethod', async () => {
  const { publicJwk } = await secp256k1.generateKeyPair();
  it('should not throw an exception if properly formatted verificationMethod', () => {
    expect(
      () => validate('JwkVerificationMethod', {
        id           : 'did:jank:alice#key1',
        type         : 'JsonWebKey2020',
        controller   : 'did:jank:alice',
        publicKeyJwk : publicJwk
      })
    ).to.not.throw('publicKeyJwk');
  });

  it('should throw an exception if id isn\'t a did', () => {
    expect(
      () => validate('JwkVerificationMethod', {
        id           : 'notadid:jank:alice#key1',
        type         : 'JsonWebKey2020',
        controller   : 'did:jank:alice',
        publicKeyJwk : publicJwk
      })
    ).to.throw('id: must match pattern');
  });

  it('should throw an exception if controller isn\'t a did', () => {
    expect(
      () => validate('JwkVerificationMethod', {
        id           : 'did:jank:alice#key1',
        type         : 'JsonWebKey2020',
        controller   : 'notadid:jank:alice',
        publicKeyJwk : publicJwk
      })
    ).to.throw('controller: must match pattern');
  });

  it('should throw an exception if publicKeyJwk isn\'t present in verificationMethod', () => {
    expect(
      () => validate('JwkVerificationMethod', {
        id         : 'did:jank:alice#key1',
        type       : 'JsonWebKey2020',
        controller : 'did:jank:alice'
      })
    ).to.throw('publicKeyJwk');
  });

  it('should throw an exception if publicKeyJwk isn\'t an object', () => {
    expect(
      () => validate('JwkVerificationMethod', {
        id           : 'did:jank:alice#key1',
        type         : 'JsonWebKey2020',
        controller   : 'did:jank:alice',
        publicKeyJwk : 'notAnObject'
      })
    ).to.throw('publicKeyJwk');
  });
});
