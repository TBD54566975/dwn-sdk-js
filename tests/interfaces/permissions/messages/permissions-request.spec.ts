import type { PermissionsRequestMessage } from '../../../../src/interfaces/permissions/types.js';

import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';

import { expect } from 'chai';
import { GeneralJwsSigner } from '../../../../src/jose/jws/general/signer.js';
import { Secp256k1 } from '../../../../src/utils/secp256k1.js';
import { DEFAULT_CONDITIONS, PermissionsRequest } from '../../../../src/interfaces/permissions/messages/permissions-request.js';

chai.use(chaiAsPromised);

describe('PermissionsRequest', () => {
  describe('constructor', () => {
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
          scope       : { method: 'RecordsWrite' }
        }
      };

      const testVectors = [
        { input: 'dookie', expectedError: 'payload is not a JSON object' },
        { input: JSON.stringify([]), expectedError: 'signed payload must be a plain object' }
      ];
      const { privateJwk } = await Secp256k1.generateKeyPair();

      for (const vector of testVectors) {
        const payloadBytes = new TextEncoder().encode(vector.input);
        const protectedHeader = { alg: privateJwk.alg!, kid: 'did:jank:alice#key1' };

        const signer = await GeneralJwsSigner.create(payloadBytes, [{ privateJwk, protectedHeader }]);
        const jws = signer.getJws();

        jsonMessage['authorization'] = jws;

        await expect(PermissionsRequest.parse(jsonMessage as PermissionsRequestMessage))
          .to.be.rejectedWith(vector.expectedError);
      }
    });
  });

  describe('create', () => {
    it('creates a PermissionsRequest message', async () => {
      const { privateJwk } = await Secp256k1.generateKeyPair();
      const authorizationSignatureInput = {
        privateJwk,
        protectedHeader: {
          alg : privateJwk.alg as string,
          kid : 'did:jank:bob'
        }
      };

      const message = await PermissionsRequest.create({
        description : 'drugs',
        grantedBy   : 'did:jank:bob',
        grantedTo   : 'did:jank:alice',
        scope       : { method: 'RecordsWrite' },
        authorizationSignatureInput
      });

      expect(message.grantedTo).to.equal('did:jank:alice');
      expect(message.grantedBy).to.equal('did:jank:bob');
      expect(message.scope).to.eql({ method: 'RecordsWrite' });
      expect(message.conditions).to.eql(DEFAULT_CONDITIONS);
      expect(message.description).to.eql(message.description);
    });

    it('uses default conditions if none are provided', async () => {
      const { privateJwk } = await Secp256k1.generateKeyPair();
      const authorizationSignatureInput = {
        privateJwk,
        protectedHeader: {
          alg : privateJwk.alg as string,
          kid : 'did:jank:bob'
        }
      };

      const message = await PermissionsRequest.create({
        description : 'drugs',
        grantedBy   : 'did:jank:bob',
        grantedTo   : 'did:jank:alice',
        scope       : { method: 'RecordsWrite' },
        authorizationSignatureInput
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
    });
  });
});

