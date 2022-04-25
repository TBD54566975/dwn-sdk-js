import chai, { expect } from 'chai';
import { describe, it, xit } from 'mocha';

import * as cbor from '@ipld/dag-cbor';
import * as json from 'multiformats/codecs/json';

import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';

import { CID } from 'multiformats/cid';
import { sha256, sha512 } from 'multiformats/hashes/sha2';

import { Message, validateMessage, verifyMessageSignature } from '../src/message';
import { DIDResolutionResult, DIDResolver } from '../src/did/did-resolver';
import base64url from 'base64url';

import type { SinonStub } from 'sinon';
import Jwk from '../src/crypto/Jwk';
import Jws from '../src/crypto/Jws';

// extend chai to test promises
chai.use(chaiAsPromised);

describe('Message Tests', () => {
  describe('validateMessage', () => {
    xit('throws exception if interface method isnt supported', () => {});
    xit('throws exception if message is invalid relative to interface method', () => {});
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

    it('throws an exception if attestation payload is not a valid CID',  async () => {
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
        'attestation': {
          'payload'   : 'farts',
          'protected' : 'farts',
          'signature' : 'farts'
        }
      };

      const resolverStub = sinon.createStubInstance(DIDResolver);
      await expect(verifyMessageSignature(msg, resolverStub))
        .to.eventually.be.rejectedWith('payload is not a valid CID');
    });

    it('throws an exception if CID of descriptor !== attestation payload',  async () => {
      // create a bogus CID
      const cborBytes = cbor.encode({farts: 'smell'});
      const cborHash = await sha256.digest(cborBytes);
      const cid = await CID.createV1(cbor.code, cborHash);

      // create JWS payload with bogus CID in it
      const cidBytes = Buffer.from(cid.bytes);
      const cidString = base64url.encode(cidBytes);

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
        'attestation': {
          'payload'   : cidString,
          'protected' : 'farts',
          'signature' : 'farts'
        }
      };

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
        'attestation': {
          'payload'   : undefined, // this will be set below
          'protected' : 'farts',
          'signature' : 'farts'
        }
      };

      // create JWS payload using message.descriptor
      const jsonBytes = json.encode(msg.descriptor);
      const jsonHash = await sha256.digest(jsonBytes);
      const cid = await CID.createV1(json.code, jsonHash);
      const cidBytes = Buffer.from(cid.bytes);
      const cidString = base64url.encode(cidBytes);

      msg.attestation.payload = cidString;

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
        'attestation': {
          'payload'   : undefined, // this will be set below
          'protected' : 'farts',
          'signature' : 'farts'
        }
      };

      // create JWS payload using message.descriptor
      const cborBytes = cbor.encode(msg.descriptor);
      const cborHash = await sha512.digest(cborBytes);
      const cid = await CID.createV1(cbor.code, cborHash);
      const cidBytes = Buffer.from(cid.bytes);
      const cidString = base64url.encode(cidBytes);

      msg.attestation.payload = cidString;

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
        'attestation': {
          'payload'   : undefined, // this will be set below
          'protected' : undefined, // this will be set below
          'signature' : 'farts'
        }
      };

      // create JWS payload using message.descriptor
      const cborBytes = cbor.encode(msg.descriptor);
      const cborHash = await sha256.digest(cborBytes);
      const cid = await CID.createV1(cbor.code, cborHash);
      const cidBytes = Buffer.from(cid.bytes);
      const cidString = base64url.encode(cidBytes);

      msg.attestation.payload = cidString;

      // base64url encode value of `attestation.protected
      const jwsProtected = JSON.stringify({ 'kid': 'did:jank:alice#kid1' });
      msg.attestation.protected = base64url.encode(jwsProtected);

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
        'attestation': {
          'payload'   : undefined, // this will be set below
          'protected' : undefined, // this will be set below
          'signature' : 'farts'
        }
      };

      // create JWS payload using message.descriptor
      const cborBytes = cbor.encode(msg.descriptor);
      const cborHash = await sha256.digest(cborBytes);
      const cid = await CID.createV1(cbor.code, cborHash);
      const cidBytes = Buffer.from(cid.bytes);
      const cidString = base64url.encode(cidBytes);

      msg.attestation.payload = cidString;

      // base64url encode value of `attestation.protected
      const jwsProtected = JSON.stringify({ 'kid': 'did:jank:alice#kid1' });
      msg.attestation.protected = base64url.encode(jwsProtected);

      const mockResolutionResult = {
        didResolutionMetadata : {},
        didDocument           : {},
        didDocumentMetadata   : {}
      };

      const resolveStub : SinonStub<any, Promise<DIDResolutionResult>> =
        sinon.stub().withArgs('did:jank:alice').resolves(mockResolutionResult);

      const resolverStub = sinon.createStubInstance(DIDResolver, {
        resolve: resolveStub
      });

      await expect(verifyMessageSignature(msg, resolverStub))
        .to.eventually.be
        .rejectedWith('failed to find respective public key to verify signature');

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
        attestation: undefined // this will be set below
      };

      // create CID of descriptor
      const cborBytes = cbor.encode(msg.descriptor);
      const cborHash = await sha256.digest(cborBytes);
      const cid = await CID.createV1(cbor.code, cborHash);

      // create signature
      const actualKeyPair = await Jwk.generateEd25519KeyPair();
      const protectedHeader = { alg: 'EdDSA', 'kid': 'did:jank:alice#key1' };
      const jws = await Jws.sign(protectedHeader, Buffer.from(cid.bytes), actualKeyPair.privateKeyJwk);

      msg.attestation = jws;

      // add a different key with the same kid to DID Doc
      const wrongKeyPair = await Jwk.generateEd25519KeyPair();

      const mockResolutionResult = {
        didResolutionMetadata : {},
        didDocument           : {
          verificationMethod: [{
            id           : 'did:jank:alice#key1',
            publicKeyJwk : wrongKeyPair.publicKeyJwk
          }]
        },
        didDocumentMetadata: {}
      };

      const resolveStub : SinonStub<any, Promise<DIDResolutionResult>> =
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
        attestation: undefined // this will be set below
      };

      // create CID of descriptor
      const cborBytes = cbor.encode(msg.descriptor);
      const cborHash = await sha256.digest(cborBytes);
      const cid = await CID.createV1(cbor.code, cborHash);

      // create signature
      // const signingKey = await jose.generateKeyPair('EdDSA');
      const { publicKeyJwk, privateKeyJwk } = await Jwk.generateEd25519KeyPair();


      // const jws = await new jose.FlattenedSign(cid.bytes)
      //   .setProtectedHeader({ alg: 'EdDSA', 'kid': 'did:jank:alice#key1' })
      //   .sign(signingKey.privateKey);
      const protectedHeader = { alg: 'EdDSA', 'kid': 'did:jank:alice#key1' };
      const jws = await Jws.sign(protectedHeader, Buffer.from(cid.bytes), privateKeyJwk);

      msg.attestation = jws;

      // const jwkPrivate = await jose.exportJWK(signingKey.privateKey);
      // const jwk = await jose.exportJWK(signingKey.publicKey);

      const mockResolutionResult = {
        didResolutionMetadata : {},
        didDocument           : {
          verificationMethod: [{
            id: 'did:jank:alice#key1',
            publicKeyJwk
          }]
        },
        didDocumentMetadata: {}
      };

      const resolveStub : SinonStub<any, Promise<DIDResolutionResult>> =
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