import chai, { expect } from 'chai';
import { describe, it, xit } from 'mocha';

import * as cbor from '@ipld/dag-cbor';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';

import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';

import { Message, validateMessage, verifyMessageSignature } from '../src/message';
import { DIDResolver } from '../src/did/did-resolver';

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

    xit('throws an exception if attestation property is missing',  () => {
      // NOTE: can't write this test until there's a Message type that doesnt
      // necessitate the presence of `attestation`
    });

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
          'header': {
            'alg' : 'farts',
            'kid' : 'farts'
          },
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
      const jwsPayload = Buffer.from(cid.bytes).toString('base64url');

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
          'header': {
            'alg' : 'farts',
            'kid' : 'farts'
          },
          'payload'   : jwsPayload,
          'protected' : 'farts',
          'signature' : 'farts'
        }
      };

      const resolverStub = sinon.createStubInstance(DIDResolver);
      await expect(verifyMessageSignature(msg, resolverStub))
        .to.eventually.be.rejectedWith('provided CID does not match expected CID of descriptor');

    });
    xit('throws an exception if DID could not be resolved', () => {});
    xit('throws an exception if appropriate key isnt present in DID Doc', () => {});
    xit('throws an exception if signature does not match', () => {});
  });
});