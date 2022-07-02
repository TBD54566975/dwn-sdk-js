import type { PermissionsRequestSchema } from '../../../../src/interfaces/permissions/types';

import { DIDResolver } from '../../../../src/did/did-resolver';
import { generateKeyPair } from '../../../../src/jose/algorithms/secp256k1';
import { GeneralJwsSigner } from '../../../../src/jose/jws/general';
import { PermissionsRequest, DEFAULT_CONDITIONS } from '../../../../src/interfaces/permissions/messages/permissions-request';
import { validate } from '../../../../src/validation/validator';

import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';

chai.use(chaiAsPromised);

describe('PermissionsRequest', () => {
  describe('getType', () => {
    it('returns PermissionsRequest', () => {
      expect(PermissionsRequest.getType()).to.equal('PermissionsRequest');
    });
  });

  describe('getInterface', () => {
    it('returns Permissions', () => {
      expect(PermissionsRequest.getInterface()).to.equal('Permissions');
    });
  });

  describe('create', () => {
    it('creates a PermissionsRequest message', async () => {
      const { privateJwk } = await generateKeyPair();
      const signatureInput = {
        jwkPrivate      : privateJwk,
        protectedHeader : {
          alg : privateJwk.alg as string,
          kid : 'did:jank:bob'
        }
      };

      const message = await PermissionsRequest.create({
        description : 'drugs',
        grantedBy   : 'did:jank:bob',
        grantedTo   : 'did:jank:alice',
        scope       : { method: 'CollectionsWrite' },
        signatureInput
      });

      // this would throw an exception if the underlying message was invalid
      validate('PermissionsRequest', message.toObject());

      expect(message.grantedTo).to.equal('did:jank:alice');
      expect(message.grantedBy).to.equal('did:jank:bob');
      expect(message.scope).to.eql({ method: 'CollectionsWrite' });
      expect(message.conditions).to.eql(DEFAULT_CONDITIONS);
      expect(message.description).to.eql(message.description);
    });

    it('uses default conditions if none are provided', async () => {
      const { privateJwk } = await generateKeyPair();
      const signatureInput = {
        jwkPrivate      : privateJwk,
        protectedHeader : {
          alg : privateJwk.alg as string,
          kid : 'did:jank:bob'
        }
      };

      const message = await PermissionsRequest.create({
        description : 'drugs',
        grantedBy   : 'did:jank:bob',
        grantedTo   : 'did:jank:alice',
        scope       : { method: 'CollectionsWrite' },
        signatureInput
      });

      const { conditions } = message;

      for (const conditionName in DEFAULT_CONDITIONS) {
        expect(conditions[conditionName]).to.equal(DEFAULT_CONDITIONS[conditionName]);
      }

      const numConditions = Object.keys(conditions).length;
      const numExpectedConditions = Object.keys(DEFAULT_CONDITIONS).length;

      expect(numConditions).to.equal(numExpectedConditions);
    });

    describe('verifyAuth', () => {
      afterEach(() => {
        // restores all fakes, stubs, spies etc. not restoring causes a memory leak.
        // more info here: https://sinonjs.org/releases/v13/general-setup/
        sinon.restore();
      });

      it('returns signer DID if verification succeeds', async () => {
        const { privateJwk, publicJwk } = await generateKeyPair();

        const alice = {
          did                  : 'did:jank:alice',
          privateJwk           : privateJwk,
          publicJwk            : publicJwk,
          protectedHeader      : { alg: 'ES256K', kid: 'did:jank:alice#key1' },
          mockResolutionResult : {
            didResolutionMetadata : {},
            didDocument           : {
              verificationMethod: [{
                id           : 'did:jank:alice#key1',
                type         : 'JsonWebKey2020',
                publicKeyJwk : publicJwk
              }]
            },
            didDocumentMetadata: {}
          }
        };

        const message = await PermissionsRequest.create({
          description    : 'drugs',
          grantedBy      : 'did:jank:bob',
          grantedTo      : 'did:jank:alice',
          scope          : { method: 'CollectionsWrite' },
          signatureInput : { jwkPrivate: alice.privateJwk, protectedHeader: alice.protectedHeader }
        });

        const resolveStub = sinon.stub();
        resolveStub.withArgs('did:jank:alice').resolves(alice.mockResolutionResult);

        // @ts-ignore
        const resolverStub = sinon.createStubInstance(DIDResolver, { resolve: resolveStub });

        const { signers } = await message.verifyAuth(resolverStub);

        expect(signers.length).to.equal(1);
        expect(signers).to.include('did:jank:alice');
      });

      it('throws an exception if payload is not valid JSON', async () => {
        const jsonMessage = {
          descriptor: {
            conditions: {
              attestation  : 'optional',
              delegation   : false,
              encryption   : 'optional',
              publication  : false,
              sharedAccess : false
            },
            description : 'drugs',
            grantedTo   : 'did:jank:alice',
            grantedBy   : 'did:jank:bob',
            method      : 'PermissionsRequest',
            objectId    : '331806c4-ce15-4759-b1c3-0f742312aae9',
            scope       : { method: 'CollectionsWrite' }
          }
        };

        const testVectors = [ 'dookie', JSON.stringify([])];
        const { privateJwk } = await generateKeyPair();

        for (const vector of testVectors) {
          const payloadBytes = new TextEncoder().encode(vector);
          const protectedHeader = { alg: privateJwk.alg, kid: 'did:jank:alice#key1' };

          const signer = await GeneralJwsSigner.create(payloadBytes, [{ jwkPrivate: privateJwk, protectedHeader }]);
          const jws = signer.getJws();

          jsonMessage['authorization'] = jws;

          const message = new PermissionsRequest(jsonMessage as PermissionsRequestSchema);
          const resolverStub = sinon.createStubInstance(DIDResolver);

          await expect(message.verifyAuth(resolverStub))
            .to.eventually.be.rejectedWith('must be a valid JSON object');
        }
      });
    });
  });
});

