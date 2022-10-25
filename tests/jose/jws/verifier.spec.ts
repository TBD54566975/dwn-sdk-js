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
    const buildVm = (id: string, type: string, controller: string, publicKeyJwk?: object): object => {
      return {
        id, type, controller, publicKeyJwk
      };
    };
    it('throws an exception if publicKeyJwk isn\'t present in verificationMethod', async () => {
      const resolverStub = sinon.createStubInstance(DidResolver, {
        // @ts-ignore
        resolve: sinon.stub().withArgs('did:jank:alice').resolves({
          didResolutionMetadata : {},
          didDocument           : {
            verificationMethod: [buildVm(
              'did:jank:alice#key1',
              'JsonWebKey2020',
              'did:jank:alice'
            )]
          },
          didDocumentMetadata: {}
        })
      });
      await expect(GeneralJwsVerifier.getPublicKey('did:jank:alice', 'did:jank:alice#key1', resolverStub))
        .to.eventually.be.rejectedWith('publicKeyJwk');
    });
    xit('throws an exception if DID could not be resolved', () => {});
    xit('throws an exception if appropriate key isnt present in DID Doc', () => {});
    it('throws an exception if verificationMethod type isn\'t JsonWebKey2020', async () => {
      const { publicJwk } = await secp256k1.generateKeyPair();
      const resolverStub = sinon.createStubInstance(DidResolver, {
        // @ts-ignore
        resolve: sinon.stub().withArgs('did:jank:alice').resolves({
          didResolutionMetadata : {},
          didDocument           : {
            verificationMethod: [buildVm(
              'did:jank:alice#key1',
              'JsonWebKey20202',
              'did:jank:alice',
              publicJwk
            )]
          },
          didDocumentMetadata: {}
        })
      });
      await expect(GeneralJwsVerifier.getPublicKey('did:jank:alice', 'did:jank:alice#key1', resolverStub))
        .to.eventually.be.rejectedWith('type: must be equal to constant');
    });
    xit('returns public key', () => {});
  });
  describe('verifySignature', () => {
    xit('throws an exception if signature does not match', () => {});
    xit('returns true if signature is successfully verified', () => {});
  });
  describe('extractDid', () => {});
});