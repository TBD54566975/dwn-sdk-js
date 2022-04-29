import { expect } from 'chai';
import Jws from '../../src/jose/Jws';
import * as JwkSecp256k1Private from './vectors/JwkSecp256k1Private.json';

describe('Jws', () => {
  it('should sign and verify SECP256K1 signature using a key vector correctly',  async () => {
    const privateKeyJwk = JwkSecp256k1Private;
    const publicKeyJwk = Object.assign({ }, privateKeyJwk); // Clone private key.
    delete publicKeyJwk.d; // Remove the private key portion.

    const protectedHeader = { anyHeader: 'anyHeaderValue' };
    const payloadBuffer = Buffer.from('anyPayloadValue');
    const jws = await Jws.sign(protectedHeader, payloadBuffer, privateKeyJwk);

    const verificationResult = await Jws.verify(jws, publicKeyJwk);

    expect(verificationResult).to.be.true;
  });
});
