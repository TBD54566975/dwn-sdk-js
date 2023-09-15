import { expect } from 'chai';
import { signatureAlgorithms } from '../../../src/jose/algorithms/signing/signature-algorithms.js';
import { validateJsonSchema } from '../../../src/schema-validator.js';

const { secp256k1 } = signatureAlgorithms;

describe('JwkVerificationMethod', async () => {
  // NOTE: @noble/secp256k1 requires globalThis.crypto polyfill for
  // node.js <=18: https://github.com/paulmillr/noble-secp256k1/blob/main/README.md#usage
  // Remove when we move off of node.js v18 to v20, earliest possible time would be Oct 2023: https://github.com/nodejs/release#release-schedule
  if (parseInt(process.versions.node) <= 18) {
    const myCrypto = await import('node:crypto');
    // @ts-expect-error
    if (!globalThis.crypto) { globalThis.crypto = myCrypto; }
  }

  const { publicJwk } = await secp256k1.generateKeyPair();
  it('should not throw an exception if properly formatted verificationMethod', () => {
    expect(
      () => validateJsonSchema('JwkVerificationMethod', {
        id           : 'did:jank:alice#key1',
        type         : 'JsonWebKey2020',
        controller   : 'did:jank:alice',
        publicKeyJwk : publicJwk
      })
    ).to.not.throw();
  });

  it('should not throw if `id` does not have the DID as prefix', () => {
    expect(
      () => validateJsonSchema('JwkVerificationMethod', {
        id           : '#key1',
        type         : 'JsonWebKey2020',
        controller   : 'did:jank:alice',
        publicKeyJwk : publicJwk
      })
    ).to.not.throw();
  });

  it('should throw an exception if id isn\'t a string', () => {
    expect(
      () => validateJsonSchema('JwkVerificationMethod', {
        id           : { },
        type         : 'JsonWebKey2020',
        controller   : 'did:jank:alice',
        publicKeyJwk : publicJwk
      })
    ).to.throw('id: must be string');
  });

  it('should throw an exception if controller isn\'t a did', () => {
    expect(
      () => validateJsonSchema('JwkVerificationMethod', {
        id           : 'did:jank:alice#key1',
        type         : 'JsonWebKey2020',
        controller   : 'notadid:jank:alice',
        publicKeyJwk : publicJwk
      })
    ).to.throw('controller: must match pattern');
  });

  it('should throw an exception if publicKeyJwk isn\'t present in verificationMethod', () => {
    expect(
      () => validateJsonSchema('JwkVerificationMethod', {
        id         : 'did:jank:alice#key1',
        type       : 'JsonWebKey2020',
        controller : 'did:jank:alice'
      })
    ).to.throw('publicKeyJwk');
  });

  it('should throw an exception if publicKeyJwk isn\'t an object', () => {
    expect(
      () => validateJsonSchema('JwkVerificationMethod', {
        id           : 'did:jank:alice#key1',
        type         : 'JsonWebKey2020',
        controller   : 'did:jank:alice',
        publicKeyJwk : 'notAnObject'
      })
    ).to.throw('publicKeyJwk');
  });
});
