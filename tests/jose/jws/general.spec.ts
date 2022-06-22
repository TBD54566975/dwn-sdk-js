import type { DIDResolutionResult } from '../../../src/did/did-resolver';
import type { SinonStub } from 'sinon';

import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { DIDResolver } from '../../../src/did/did-resolver';
import { GeneralJwsSigner } from '../../../src/jose/jws/general/signer';
import { GeneralJwsVerifier } from '../../../src/jose/jws/general/verifier';
import { generateSecp256k1Jwk, generateEd25519Jwk } from '../../../src/jose/jwk';
import sinon from 'sinon';

chai.use(chaiAsPromised);

describe('General JWS Sign/Verify', () => {
  afterEach(() => {
    // restores all fakes, stubs, spies etc. not restoring causes a memory leak.
    // more info here: https://sinonjs.org/releases/v13/general-setup/
    sinon.restore();
  });


  it('should sign and verify secp256k1 signature using a key vector correctly',  async () => {
    const { privateKeyJwk, publicKeyJwk } = await generateSecp256k1Jwk();
    const payloadBytes = new TextEncoder().encode('anyPayloadValue');
    const protectedHeader = { alg: 'ES256K', kid: 'did:jank:alice#key1' };

    const signer = await GeneralJwsSigner.create(payloadBytes, [{ jwkPrivate: privateKeyJwk, protectedHeader }]);
    const jws = signer.getJws();

    const mockResolutionResult = {
      didResolutionMetadata : {},
      didDocument           : {
        verificationMethod: [{
          id   : 'did:jank:alice#key1',
          type : 'JsonWebKey2020',
          publicKeyJwk
        }]
      },
      didDocumentMetadata: {}
    };

    const resolverStub = sinon.createStubInstance(DIDResolver, {
      // @ts-ignore
      resolve: sinon.stub().withArgs('did:jank:alice').resolves(mockResolutionResult)
    });

    const verifier = new GeneralJwsVerifier(jws);

    const verificatonResult = await verifier.verify(resolverStub);

    expect(verificatonResult.signers.length).to.equal(1);
    expect(verificatonResult.signers).to.include('did:jank:alice');

  });
});