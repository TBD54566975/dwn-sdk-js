import { expect } from 'chai';
import * as jws from '../../src/jose/jws';
import * as jwkSecp256k1Private from './vectors/jwk-secp256k1-private.json';

describe('Jws', () => {
  it('should sign and verify SECP256K1 signature using a key vector correctly',  async () => {
    const publicKeyJwk = Object.assign({ }, jwkSecp256k1Private); // Clone private key.
    delete publicKeyJwk.d; // Remove the private key portion.

    const protectedHeader = { anyHeader: 'anyHeaderValue' };
    const payloadBuffer = Buffer.from('anyPayloadValue');
    const jwsObject = await jws.sign(protectedHeader, payloadBuffer, jwkSecp256k1Private);

    const verificationResult = await jws.verify(jwsObject, publicKeyJwk);

    expect(verificationResult).to.be.true;
  });
});
