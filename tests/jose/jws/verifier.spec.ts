import { expect } from 'chai';
import { DidResolver } from '../../../src/did/did-resolver';
import { GeneralJwsVerifier } from '../../../src/jose/jws/general/verifier';
import { signers } from '../../../src/jose/algorithms';
import sinon from 'sinon';

const { secp256k1 } = signers;

describe('GeneralJwsVerifier', () => {
  afterEach(() => {
    // restores all fakes, stubs, spies etc. not restoring causes a memory leak.
    // more info here: https://sinonjs.org/releases/v13/general-setup/
    sinon.restore();
  });
  describe('getPublicKey', () => {
    const buildDidResolutionResult = (
      id: string,
      type: string,
      controller: string,
      publicKeyJwk?: object
    ): object => {
      return {
        didResolutionMetadata : {},
        didDocument           : {
          verificationMethod: [{ id, type, controller, publicKeyJwk }],
        },
        didDocumentMetadata: {},
      };
    };
    it('throws an exception if publicKeyJwk isn\'t present in verificationMethod', async () => {
      const resolverStub = sinon.createStubInstance(DidResolver, {
        // @ts-ignore
        resolve: sinon
          .stub()
          .withArgs('did:jank:alice')
          .resolves(
            buildDidResolutionResult(
              'did:jank:alice#key1',
              'JsonWebKey2020',
              'did:jank:alice'
            )
          ),
      });
      await expect(
        GeneralJwsVerifier.getPublicKey(
          'did:jank:alice',
          'did:jank:alice#key1',
          resolverStub
        )
      ).to.eventually.be.rejectedWith('publicKeyJwk');
    });
    xit('throws an exception if DID could not be resolved', () => { });
    xit('throws an exception if appropriate key isnt present in DID Doc', () => { });
    it('throws an exception if verificationMethod type isn\'t JsonWebKey2020', async () => {
      const { publicJwk } = await secp256k1.generateKeyPair();
      const resolverStub = sinon.createStubInstance(DidResolver, {
        // @ts-ignore
        resolve: sinon
          .stub()
          .withArgs('did:jank:alice')
          .resolves(
            buildDidResolutionResult(
              'did:jank:alice#key1',
              'JsonWebKey20202',
              'did:jank:alice',
              publicJwk
            )
          ),
      });
      await expect(
        GeneralJwsVerifier.getPublicKey(
          'did:jank:alice',
          'did:jank:alice#key1',
          resolverStub
        )
      ).to.eventually.be.rejectedWith('type: must be equal to constant');
    });
    it('throws an exception if id is not a did', async () => {
      const { publicJwk } = await secp256k1.generateKeyPair();
      const resolverStub = sinon.createStubInstance(DidResolver, {
        // @ts-ignore
        resolve: sinon
          .stub()
          .withArgs('did:jank:alice')
          .resolves(
            buildDidResolutionResult(
              'nodid:jank:alice#key1',
              'JsonWebKey2020',
              'did:jank:alice',
              publicJwk
            )
          ),
      });
      await expect(
        GeneralJwsVerifier.getPublicKey(
          'did:jank:alice',
          'nodid:jank:alice#key1',
          resolverStub
        )
      ).to.eventually.be.rejectedWith('id: must match pattern');
    });
    it('doesn\'t throw an exception if verificationMethod is valid', async () => {
      const { publicJwk } = await secp256k1.generateKeyPair();
      const resolverStub = sinon.createStubInstance(DidResolver, {
        // @ts-ignore
        resolve: sinon
          .stub()
          .withArgs('did:jank:alice')
          .resolves(
            buildDidResolutionResult(
              'did:jank:alice#key1',
              'JsonWebKey2020',
              'did:jank:alice',
              publicJwk
            )
          ),
      });
      await expect(
        GeneralJwsVerifier.getPublicKey(
          'did:jank:alice',
          'did:jank:alice#key1',
          resolverStub
        )
      ).to.eventually.not.be.rejectedWith();
    });
    xit('returns public key', () => { });
  });
  describe('verifySignature', () => {
    xit('throws an exception if signature does not match', () => { });
    xit('returns true if signature is successfully verified', () => { });
  });
  describe('extractDid', () => { });
});
