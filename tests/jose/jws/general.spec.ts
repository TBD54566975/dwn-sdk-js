import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { DidResolver } from '../../../src/did/did-resolver';
import { GeneralJwsSigner } from '../../../src/jose/jws/general/signer';
import { GeneralJwsVerifier } from '../../../src/jose/jws/general/verifier';
import { signers } from '../../../src/jose/algorithms';
import sinon from 'sinon';

const { Ed25519, secp256k1 } = signers;

chai.use(chaiAsPromised);

describe('General JWS Sign/Verify', () => {
  afterEach(() => {
    // restores all fakes, stubs, spies etc. not restoring causes a memory leak.
    // more info here: https://sinonjs.org/releases/v13/general-setup/
    sinon.restore();
  });

  it('should sign and verify secp256k1 signature using a key vector correctly', async () => {
    const { privateJwk, publicJwk } = await secp256k1.generateKeyPair();
    const payloadBytes = new TextEncoder().encode('anyPayloadValue');
    const protectedHeader = { alg: 'ES256K', kid: 'did:jank:alice#key1' };

    const signer = await GeneralJwsSigner.create(payloadBytes, [{ jwkPrivate: privateJwk, protectedHeader }]);
    const jws = signer.getJws();

    const mockResolutionResult = {
      didResolutionMetadata : {},
      didDocument           : {
        verificationMethod: [{
          id           : 'did:jank:alice#key1',
          type         : 'JsonWebKey2020',
          controller   : 'did:jank:alice',
          publicKeyJwk : publicJwk
        }]
      },
      didDocumentMetadata: {}
    };

    const resolverStub = sinon.createStubInstance(DidResolver, {
      // @ts-ignore
      resolve: sinon.stub().withArgs('did:jank:alice').resolves(mockResolutionResult)
    });

    const verifier = new GeneralJwsVerifier(jws);

    const verificationResult = await verifier.verify(resolverStub);

    expect(verificationResult.signers.length).to.equal(1);
    expect(verificationResult.signers).to.include('did:jank:alice');
  });

  it('should sign and verify ed25519 signature using a key vector correctly', async () => {
    const { privateJwk, publicJwk } = await Ed25519.generateKeyPair();
    const payloadBytes = new TextEncoder().encode('anyPayloadValue');
    const protectedHeader = { alg: 'EdDSA', kid: 'did:jank:alice#key1' };

    const signer = await GeneralJwsSigner.create(payloadBytes, [{ jwkPrivate: privateJwk, protectedHeader }]);
    const jws = signer.getJws();

    const mockResolutionResult = {
      didResolutionMetadata : {},
      didDocument           : {
        verificationMethod: [{
          id           : 'did:jank:alice#key1',
          type         : 'JsonWebKey2020',
          controller   : 'did:jank:alice',
          publicKeyJwk : publicJwk
        }]
      },
      didDocumentMetadata: {}
    };

    const resolverStub = sinon.createStubInstance(DidResolver, {
      // @ts-ignore
      resolve: sinon.stub().withArgs('did:jank:alice').resolves(mockResolutionResult)
    });

    const verifier = new GeneralJwsVerifier(jws);

    const verificatonResult = await verifier.verify(resolverStub);

    expect(verificatonResult.signers.length).to.equal(1);
    expect(verificatonResult.signers).to.include('did:jank:alice');
  });

  it('should support multiple signatures using different key types', async () => {
    const secp256k1Keys = await secp256k1.generateKeyPair();
    const ed25519Keys = await Ed25519.generateKeyPair();

    const alice = {
      did                  : 'did:jank:alice',
      jwkPrivate           : secp256k1Keys.privateJwk,
      jwkPublic            : secp256k1Keys.publicJwk,
      protectedHeader      : { alg: 'ES256K', kid: 'did:jank:alice#key1' },
      mockResolutionResult : {
        didResolutionMetadata : {},
        didDocument           : {
          verificationMethod: [{
            id           : 'did:jank:alice#key1',
            type         : 'JsonWebKey2020',
            controller   : 'did:jank:alice',
            publicKeyJwk : secp256k1Keys.publicJwk
          }]
        },
        didDocumentMetadata: {}
      }
    };

    const bob = {
      did                  : 'did:jank:bob',
      jwkPrivate           : ed25519Keys.privateJwk,
      jwkPublic            : ed25519Keys.publicJwk,
      protectedHeader      : { alg: 'EdDSA', kid: 'did:jank:bob#key1' },
      mockResolutionResult : {
        didResolutionMetadata : {},
        didDocument           : {
          verificationMethod: [{
            id           : 'did:jank:bob#key1',
            type         : 'JsonWebKey2020',
            controller   : 'did:jank:bob',
            publicKeyJwk : ed25519Keys.publicJwk,
          }]
        },
        didDocumentMetadata: {}
      }
    };

    const signatureInputs = [
      { jwkPrivate: alice.jwkPrivate, protectedHeader: alice.protectedHeader },
      { jwkPrivate: bob.jwkPrivate, protectedHeader: bob.protectedHeader },
    ];

    const payloadBytes = new TextEncoder().encode('anyPayloadValue');
    const signer = await GeneralJwsSigner.create(payloadBytes, signatureInputs);
    const jws = signer.getJws();

    const resolveStub = sinon.stub();
    resolveStub.withArgs('did:jank:alice').resolves(alice.mockResolutionResult);
    resolveStub.withArgs('did:jank:bob').resolves(bob.mockResolutionResult);

    const resolverStub = sinon.createStubInstance(DidResolver, {
      // @ts-ignore
      resolve: resolveStub
    });

    const verifier = new GeneralJwsVerifier(jws);
    const verificatonResult = await verifier.verify(resolverStub);

    expect(verificatonResult.signers.length).to.equal(2);
    expect(verificatonResult.signers).to.include(alice.did);
    expect(verificatonResult.signers).to.include(bob.did);
  });
});