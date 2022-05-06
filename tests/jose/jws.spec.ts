import * as jws from '../../src/jose/jws';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import jwkSecp256k1Private from './vectors/jwk-secp256k1-private.json';

// extend chai to test promises
chai.use(chaiAsPromised);

describe('Jws', () => {
  it('should sign and verify SECP256K1 signature using a key vector correctly',  async () => {
    const publicKeyJwk = Object.assign({ }, jwkSecp256k1Private); // Clone private key.ㄣ
    delete publicKeyJwk.d; // Remove the private key portion.

    const protectedHeader = { anyHeader: 'anyHeaderValue' };
    const payloadBuffer = Buffer.from('anyPayloadValue');
    const jwsObject = await jws.sign(protectedHeader, payloadBuffer, jwkSecp256k1Private);

    const verificationResult = await jws.verify(jwsObject, publicKeyJwk);

    expect(verificationResult).to.be.true;
  });

  it('should throw error if attempting to sign using an unsupported JWK',  async () => {
    const unsupportedJwk = Object.assign({ randomUnsupportedProperty: 'anyValue' }, jwkSecp256k1Private); // Clone private key.

    const protectedHeader = { anyHeader: 'anyHeaderValue' };
    const payloadBuffer = Buffer.from('anyPayloadValue');
    const signingPromise = jws.sign(protectedHeader, payloadBuffer, unsupportedJwk);

    await expect(signingPromise).to.be.rejectedWith('invalid or unsupported JWK private key');
  });

  it('should throw error if attempting to verify using an unsupported/private JWK',  async () => {
    const protectedHeader = { anyHeader: 'anyHeaderValue' };
    const payloadBuffer = Buffer.from('anyPayloadValue');
    const jwsObject = await jws.sign(protectedHeader, payloadBuffer, jwkSecp256k1Private);

    const verificationPromise = jws.verify(jwsObject, jwkSecp256k1Private);
    await expect(verificationPromise).to.be.rejectedWith('invalid or unsupported JWK public key');
  });
});
