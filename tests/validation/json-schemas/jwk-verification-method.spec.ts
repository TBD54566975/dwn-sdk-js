import { expect } from 'chai';
import { signers } from '../../../src/jose/algorithms';
import { validate } from '../../../src/validator';

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
    ).to.not.throw();
  });

  it('should not throw if `id` does not have the DID as prefix', () => {
    expect(
      () => validate('JwkVerificationMethod', {
        id           : '#key1',
        type         : 'JsonWebKey2020',
        controller   : 'did:jank:alice',
        publicKeyJwk : publicJwk
      })
    ).to.not.throw();
  });

  it('should throw an exception if id isn\'t a string', () => {
    expect(
      () => validate('JwkVerificationMethod', {
        id           : { },
        type         : 'JsonWebKey2020',
        controller   : 'did:jank:alice',
        publicKeyJwk : publicJwk
      })
    ).to.throw('id: must be string');
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
