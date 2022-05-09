import * as jws from '../../src/jose/jws';
import { generateSecp256k1Jwk, generateEd25519Jwk } from '../../src/jose/jwk';
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import jwkSecp256k1Private from './vectors/jwk-secp256k1-private.json';

// extend chai to test promises
chai.use(chaiAsPromised);

describe('Jws', () => {
  it.only('should sign and verify secp256k1 signature using a key vector correctly',  async () => {
    // const publicKeyJwk: any = { ...jwkSecp256k1Private };
    const { publicKeyJwk, privateKeyJwk } = await generateSecp256k1Jwk();
    // console.log(publicKeyJwk);
    // console.log(privateKeyJwk);

    const protectedHeader = { anyHeader: 'anyHeaderValue' };
    const payloadBytes = new TextEncoder().encode('anyPayloadValue');
    const jwsObject = await jws.sign(protectedHeader, payloadBytes, privateKeyJwk);

    const verificationResult = await jws.verify(jwsObject, publicKeyJwk);

    expect(verificationResult).to.be.true;
  });

  it('should sign and verify ed25519 signature using an appropriate keypair', async () => {
    const { publicKeyJwk, privateKeyJwk } = await generateEd25519Jwk();

    const protectedHeader = { anyHeader: 'anyHeaderValue' };
    const payloadBytes = new TextEncoder().encode('anyPayloadValue');
    const jwsObject = await jws.sign(protectedHeader, payloadBytes, privateKeyJwk);

    const verificationResult = await jws.verify(jwsObject, publicKeyJwk);

    expect(verificationResult).to.be.true;
  });

  it('should throw error if attempting to sign using an unsupported JWK',  async () => {
    const { privateKeyJwk } = await generateEd25519Jwk();
    const unsupportedJwk = { randomUnsupportedProperty: 'anyValue', ...privateKeyJwk as any }; // Clone private key.
    unsupportedJwk.crv = 'derp';

    const protectedHeader = { anyHeader: 'anyHeaderValue' };
    const payloadBytes = new TextEncoder().encode('anyPayloadValue');
    const signingPromise = jws.sign(protectedHeader, payloadBytes, unsupportedJwk);

    await expect(signingPromise).to.be.rejectedWith('unsupported crv');
  });

  it('should throw error if attempting to verify using an unsupported JWK',  async () => {
    const jwsObject: any = {};
    const pubKey: any = { ...jwkSecp256k1Private, crv: 'derp' };

    const verificationPromise = jws.verify(jwsObject, pubKey as any);
    await expect(verificationPromise).to.be.rejectedWith('unsupported crv');
  });
});
