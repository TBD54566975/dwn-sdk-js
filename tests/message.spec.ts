import chai, { expect } from 'chai';

import * as cbor from '@ipld/dag-cbor';
import * as ed25519 from '../src/jose/algorithms/ed25519';
import * as json from 'multiformats/codecs/json';
import * as jws from '../src/jose/jws';

import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';

import { CID } from 'multiformats/cid';
import { generateEd25519Jwk, generateSecp256k1Jwk } from '../src/jose/jwk';
import { verifyMessageSignature } from '../src/message';
import { sha256, sha512 } from 'multiformats/hashes/sha2';

import { DIDResolver } from '../src/did/did-resolver';

import type { DIDResolutionResult } from '../src/did/did-resolver';
import type { SinonStub } from 'sinon';

// extend chai to test promises
chai.use(chaiAsPromised);

describe('Message Tests', () => {
  describe('validateMessage', () => {
    xit('throws exception if interface method isnt supported', () => { });
    xit('throws exception if message is invalid relative to interface method', () => { });
  });

  describe('verifyMessageSignature', () => {
    afterEach(() => {
      // restores all fakes, stubs, spies etc. not restoring causes a memory leak.
      // more info here: https://sinonjs.org/releases/v13/general-setup/
      sinon.restore();
    });

    // NOTE: can't write this test until there's a Message type that doesnt
    // necessitate the presence of `attestation`
    xit('throws an exception if attestation property is missing');

    it('throws an exception if attestation payload is not a valid CID', async () => {
      const msg = {
        'descriptor': {
          'ability': {
            'description' : 'some description',
            'method'      : 'CollectionsWrite',
            'schema'      : 'https://schema.org/MusicPlaylist'
          },
          'method'    : 'PermissionsRequest' as const,
          'objectId'  : '03754d75-c6b9-4fdd-891f-7eb2ad4bbd21',
          'requester' : 'did:jank:alice'
        },
        'attestation': undefined as any
      };

      const { privateKeyJwk } = await generateSecp256k1Jwk('whatever');
      const bogusPayload = new TextEncoder().encode('dingdong');
      msg.attestation = await jws.sign(bogusPayload, privateKeyJwk);

      const resolverStub = sinon.createStubInstance(DIDResolver);
      await expect(verifyMessageSignature(msg, resolverStub))
        .to.eventually.be.rejectedWith('payload is not a valid CID');
    });

    it('throws an exception if CID of descriptor !== attestation payload', async () => {
      const msg = {
        'descriptor': {
          'ability': {
            'description' : 'some description',
            'method'      : 'CollectionsWrite',
            'schema'      : 'https://schema.org/MusicPlaylist'
          },
          'method'    : 'PermissionsRequest' as const,
          'objectId'  : '03754d75-c6b9-4fdd-891f-7eb2ad4bbd21',
          'requester' : 'did:jank:alice'
        },
        'attestation': undefined as any
      };

      const { privateKeyJwk } = await generateSecp256k1Jwk('whatever');

      // create a bogus CID
      const cborBytes = cbor.encode({ farts: 'smell' });
      const cborHash = await sha256.digest(cborBytes);
      const cid = await CID.createV1(cbor.code, cborHash);
      msg.attestation = await jws.sign(cid.bytes, privateKeyJwk);

      const resolverStub = sinon.createStubInstance(DIDResolver);
      await expect(verifyMessageSignature(msg, resolverStub))
        .to.eventually.be.rejectedWith('provided CID does not match expected CID of descriptor');
    });

    it('throws an exception if provided CID doesnt utilize cbor codec', async () => {
      const msg = {
        'descriptor': {
          'ability': {
            'description' : 'some description',
            'method'      : 'CollectionsWrite',
            'schema'      : 'https://schema.org/MusicPlaylist'
          },
          'method'    : 'PermissionsRequest' as const,
          'objectId'  : '03754d75-c6b9-4fdd-891f-7eb2ad4bbd21',
          'requester' : 'did:jank:alice'
        },
        'attestation': undefined as any
      };

      // create JWS payload using message.descriptor
      const jsonBytes = json.encode(msg.descriptor);
      const jsonHash = await sha256.digest(jsonBytes);
      const cid = await CID.createV1(json.code, jsonHash);

      const { privateKeyJwk } = await generateSecp256k1Jwk('whatever');
      msg.attestation = await jws.sign(cid.bytes, privateKeyJwk);

      const resolverStub = sinon.createStubInstance(DIDResolver);
      await expect(verifyMessageSignature(msg, resolverStub))
        .to.eventually.be.rejectedWith('CID of descriptor must be CBOR encoded');

    });

    it('throws an exception if provided CID uses unsupported hashing algo', async () => {
      const msg = {
        'descriptor': {
          'ability': {
            'description' : 'some description',
            'method'      : 'CollectionsWrite',
            'schema'      : 'https://schema.org/MusicPlaylist'
          },
          'method'    : 'PermissionsRequest' as const,
          'objectId'  : '03754d75-c6b9-4fdd-891f-7eb2ad4bbd21',
          'requester' : 'did:jank:alice'
        },
        'attestation': undefined as any
      };

      // create JWS payload using message.descriptor
      const cborBytes = cbor.encode(msg.descriptor);
      const cborHash = await sha512.digest(cborBytes);
      const cid = await CID.createV1(cbor.code, cborHash);

      const { privateKeyJwk } = await generateSecp256k1Jwk('whatever');
      msg.attestation = await jws.sign(cid.bytes, privateKeyJwk);

      const resolverStub = sinon.createStubInstance(DIDResolver);
      await expect(verifyMessageSignature(msg, resolverStub))
        .to.eventually.be
        .rejectedWith(`multihash code [${sha512.code}] not supported`);
    });

    it('throws an exception if DID could not be resolved', async () => {
      const msg = {
        'descriptor': {
          'ability': {
            'description' : 'some description',
            'method'      : 'CollectionsWrite',
            'schema'      : 'https://schema.org/MusicPlaylist'
          },
          'method'    : 'PermissionsRequest' as const,
          'objectId'  : '03754d75-c6b9-4fdd-891f-7eb2ad4bbd21',
          'requester' : 'did:jank:alice'
        },
        'attestation': undefined as any
      };

      // create JWS payload using message.descriptor
      const cborBytes = cbor.encode(msg.descriptor);
      const cborHash = await sha256.digest(cborBytes);
      const cid = await CID.createV1(cbor.code, cborHash);

      const { privateKeyJwk } = await generateEd25519Jwk('did:jank:alice#kid1');

      msg.attestation = await jws.sign(cid.bytes, privateKeyJwk);

      const expectedError = new Error('did:jank:alice is not a valid DID');

      const resolverStub = sinon.createStubInstance(DIDResolver, {
        // @ts-ignore
        resolve: sinon.stub().withArgs('did:jank:alice').rejects(expectedError)
      });

      await expect(verifyMessageSignature(msg, resolverStub))
        .to.eventually.be
        .rejectedWith(expectedError.message);

      expect(resolverStub.resolve.called).to.be.true;
    });

    it('throws an exception if appropriate key isnt present in DID Doc', async () => {
      const msg = {
        'descriptor': {
          'ability': {
            'description' : 'some description',
            'method'      : 'CollectionsWrite',
            'schema'      : 'https://schema.org/MusicPlaylist'
          },
          'method'    : 'PermissionsRequest' as const,
          'objectId'  : '03754d75-c6b9-4fdd-891f-7eb2ad4bbd21',
          'requester' : 'did:jank:alice'
        },
        'attestation': undefined as any
      };

      // create JWS payload using message.descriptor
      const cborBytes = cbor.encode(msg.descriptor);
      const cborHash = await sha256.digest(cborBytes);
      const cid = await CID.createV1(cbor.code, cborHash);

      const { privateKeyJwk } = await generateEd25519Jwk('did:jank:alice#kid1');

      msg.attestation = await jws.sign(cid.bytes, privateKeyJwk);

      const mockResolutionResult = {
        didResolutionMetadata : {},
        didDocument           : {},
        didDocumentMetadata   : {}
      };

      const resolveStub: SinonStub<any, Promise<DIDResolutionResult>> =
        sinon.stub().withArgs('did:jank:alice').resolves(mockResolutionResult);

      const resolverStub = sinon.createStubInstance(DIDResolver, {
        resolve: resolveStub
      });

      await expect(verifyMessageSignature(msg, resolverStub))
        .to.eventually.be
        .rejectedWith('public key needed to verify signature not found in DID Document');

      expect(resolverStub.resolve.called).to.be.true;
    });

    it('throws an exception if verificationMethod type isn\'t JsonWebKey2020', async () => {
      const msg = {
        'descriptor': {
          'ability': {
            'description' : 'some description',
            'method'      : 'CollectionsWrite',
            'schema'      : 'https://schema.org/MusicPlaylist'
          },
          'method'    : 'PermissionsRequest' as const,
          'objectId'  : '03754d75-c6b9-4fdd-891f-7eb2ad4bbd21',
          'requester' : 'did:jank:alice'
        },
        'attestation': undefined as any
      };

      // create JWS payload using message.descriptor
      const cborBytes = cbor.encode(msg.descriptor);
      const cborHash = await sha256.digest(cborBytes);
      const cid = await CID.createV1(cbor.code, cborHash);

      const { privateKeyJwk } = await generateEd25519Jwk('did:jank:alice#kid1');

      msg.attestation = await jws.sign(cid.bytes, privateKeyJwk);

      const mockResolutionResult = {
        didResolutionMetadata : {},
        didDocument           : {
          verificationMethod: [{
            id   : 'did:jank:alice#kid1',
            type : 'EcdsaSecp256k1VerificationKey2019'
          }]
        },
        didDocumentMetadata: {}
      };

      const resolveStub: SinonStub<any, Promise<DIDResolutionResult>> =
        sinon.stub().withArgs('did:jank:alice').resolves(mockResolutionResult);

      const resolverStub = sinon.createStubInstance(DIDResolver, {
        resolve: resolveStub
      });

      await expect(verifyMessageSignature(msg, resolverStub))
        .to.eventually.be
        .rejectedWith('JsonWebKey2020');

      expect(resolverStub.resolve.called).to.be.true;
    });

    it('throws an exception if publicKeyJwk isn\'t present in verificationMethod', async () => {
      const msg = {
        'descriptor': {
          'ability': {
            'description' : 'some description',
            'method'      : 'CollectionsWrite',
            'schema'      : 'https://schema.org/MusicPlaylist'
          },
          'method'    : 'PermissionsRequest' as const,
          'objectId'  : '03754d75-c6b9-4fdd-891f-7eb2ad4bbd21',
          'requester' : 'did:jank:alice'
        },
        'attestation': undefined as any
      };

      // create JWS payload using message.descriptor
      const cborBytes = cbor.encode(msg.descriptor);
      const cborHash = await sha256.digest(cborBytes);
      const cid = await CID.createV1(cbor.code, cborHash);

      const { privateKeyJwk } = await generateEd25519Jwk('did:jank:alice#kid1');

      msg.attestation = await jws.sign(cid.bytes, privateKeyJwk);

      const mockResolutionResult = {
        didResolutionMetadata : {},
        didDocument           : {
          verificationMethod: [{
            id   : 'did:jank:alice#kid1',
            type : 'JsonWebKey2020'
          }]
        },
        didDocumentMetadata: {}
      };

      const resolveStub: SinonStub<any, Promise<DIDResolutionResult>> =
        sinon.stub().withArgs('did:jank:alice').resolves(mockResolutionResult);

      const resolverStub = sinon.createStubInstance(DIDResolver, {
        resolve: resolveStub
      });

      await expect(verifyMessageSignature(msg, resolverStub))
        .to.eventually.be
        .rejectedWith('publicKeyJwk');

      expect(resolverStub.resolve.called).to.be.true;
    });

    it('throws an exception if signature does not match', async () => {
      const msg = {
        'descriptor': {
          'ability': {
            'description' : 'some description',
            'method'      : 'CollectionsWrite',
            'schema'      : 'https://schema.org/MusicPlaylist'
          },
          'method'    : 'PermissionsRequest' as const,
          'objectId'  : '03754d75-c6b9-4fdd-891f-7eb2ad4bbd21',
          'requester' : 'did:jank:alice'
        },
        attestation: undefined as any // this will be set below
      };

      // create CID of descriptor
      const cborBytes = cbor.encode(msg.descriptor);
      const cborHash = await sha256.digest(cborBytes);
      const cid = await CID.createV1(cbor.code, cborHash);

      // create signature
      const actualKeyPair = await ed25519.generateKeyPair('did:jank:alice#key1');
      const jwsObject = await jws.sign(cid.bytes, actualKeyPair.privateKeyJwk);

      msg.attestation = jwsObject;

      // add a different key with the same kid to DID Doc
      const wrongKeyPair = await ed25519.generateKeyPair('did:jank:alice#key1');

      const mockResolutionResult = {
        didResolutionMetadata : {},
        didDocument           : {
          verificationMethod: [{
            id           : 'did:jank:alice#key1',
            type         : 'JsonWebKey2020',
            publicKeyJwk : wrongKeyPair.publicKeyJwk
          }]
        },
        didDocumentMetadata: {}
      };

      const resolveStub: SinonStub<any, Promise<DIDResolutionResult>> =
        sinon.stub().withArgs('did:jank:alice').resolves(mockResolutionResult);

      const resolverStub = sinon.createStubInstance(DIDResolver, {
        resolve: resolveStub
      });

      await expect(verifyMessageSignature(msg, resolverStub))
        .to.eventually.be.rejectedWith('signature verification failed');

      expect(resolverStub.resolve.called).to.be.true;
    });

    it('resolves if signature is successfully verified', async () => {
      const msg = {
        'descriptor': {
          'ability': {
            'description' : 'some description',
            'method'      : 'CollectionsWrite',
            'schema'      : 'https://schema.org/MusicPlaylist'
          },
          'method'    : 'PermissionsRequest' as const,
          'objectId'  : '03754d75-c6b9-4fdd-891f-7eb2ad4bbd21',
          'requester' : 'did:jank:alice'
        },
        attestation: undefined as any // this will be set below
      };

      // create CID of descriptor
      const cborBytes = cbor.encode(msg.descriptor);
      const cborHash = await sha256.digest(cborBytes);
      const cid = await CID.createV1(cbor.code, cborHash);

      // create signature
      const { publicKeyJwk, privateKeyJwk } = await ed25519.generateKeyPair('did:jank:alice#key1');
      const jwsObject = await jws.sign(cid.bytes, privateKeyJwk);

      msg.attestation = jwsObject;

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

      const resolveStub: SinonStub<any, Promise<DIDResolutionResult>> =
        sinon.stub().withArgs('did:jank:alice').resolves(mockResolutionResult);

      const resolverStub = sinon.createStubInstance(DIDResolver, {
        resolve: resolveStub
      });

      await expect(verifyMessageSignature(msg, resolverStub))
        .to.eventually.be.fulfilled;

      expect(resolverStub.resolve.called).to.be.true;
    });
  });
});