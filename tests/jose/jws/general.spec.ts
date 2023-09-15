import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

import { DidResolver } from '../../../src/did/did-resolver.js';
import { GeneralJwsBuilder } from '../../../src/jose/jws/general/builder.js';
import { GeneralJwsVerifier } from '../../../src/jose/jws/general/verifier.js';
import { Jws } from '../../../src/utils/jws.js';
import { PrivateKeySigner } from '../../../src/index.js';
import { signatureAlgorithms } from '../../../src/jose/algorithms/signing/signature-algorithms.js';
import sinon from 'sinon';

const { Ed25519, secp256k1 } = signatureAlgorithms;

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

    const jwsBuilder = await GeneralJwsBuilder.create(payloadBytes, [{ signer: new PrivateKeySigner(privateJwk), protectedHeader }]);
    const jws = jwsBuilder.getJws();

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

    const jwsBuilder = await GeneralJwsBuilder.create(payloadBytes, [{ signer: new PrivateKeySigner(privateJwk), protectedHeader }]);
    const jws = jwsBuilder.getJws();

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
      privateJwk           : secp256k1Keys.privateJwk,
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
      privateJwk           : ed25519Keys.privateJwk,
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
      { signer: new PrivateKeySigner(alice.privateJwk), protectedHeader: alice.protectedHeader },
      { signer: new PrivateKeySigner(bob.privateJwk), protectedHeader: bob.protectedHeader },
    ];

    const payloadBytes = new TextEncoder().encode('anyPayloadValue');
    const jwsBuilder = await GeneralJwsBuilder.create(payloadBytes, signatureInputs);
    const jws = jwsBuilder.getJws();

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

  it('should not verify the same signature more than once', async () => {
    const { privateJwk: privateJwkEd25519, publicJwk: publicJwkEd25519 } = await Ed25519.generateKeyPair();
    const { privateJwk: privateJwkSecp256k1, publicJwk: publicJwkSecp256k1 } = await secp256k1.generateKeyPair();
    const payloadBytes = new TextEncoder().encode('anyPayloadValue');
    const protectedHeaderEd25519 = { alg: 'EdDSA', kid: 'did:jank:alice#key1' };
    const protectedHeaderSecp256k1 = { alg: 'ES256K', kid: 'did:jank:alice#key2' };

    const jwsBuilder = await GeneralJwsBuilder.create(
      payloadBytes,
      [
        { signer: new PrivateKeySigner(privateJwkEd25519), protectedHeader: protectedHeaderEd25519 },
        { signer: new PrivateKeySigner(privateJwkSecp256k1), protectedHeader: protectedHeaderSecp256k1 }
      ]
    );
    const jws = jwsBuilder.getJws();

    const mockResolutionResult = {
      didResolutionMetadata : {},
      didDocument           : {
        verificationMethod: [{
          id           : 'did:jank:alice#key1',
          type         : 'JsonWebKey2020',
          controller   : 'did:jank:alice',
          publicKeyJwk : publicJwkEd25519
        }, {
          id           : 'did:jank:alice#key2',
          type         : 'JsonWebKey2020',
          controller   : 'did:jank:alice',
          publicKeyJwk : publicJwkSecp256k1
        }]
      },
      didDocumentMetadata: {}
    };

    const resolverStub = sinon.createStubInstance(DidResolver, {
      // @ts-ignore
      resolve: sinon.stub().withArgs('did:jank:alice').resolves(mockResolutionResult)
    });

    const verifier = new GeneralJwsVerifier(jws);

    const verifySignatureSpy = sinon.spy(Jws, 'verifySignature');
    const cacheSetSpy = sinon.spy(verifier.cache, 'set');

    await verifier.verify(resolverStub);
    await verifier.verify(resolverStub);

    sinon.assert.calledTwice(cacheSetSpy);
    sinon.assert.calledTwice(verifySignatureSpy);
  });

});
