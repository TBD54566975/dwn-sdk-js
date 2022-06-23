import type { JsonPermissionsRequest } from '../../src/interfaces/permissions/request/types';

import { expect } from 'chai';
import { generateKeyPair } from '../../src/jose/algorithms/secp256k1';
import { Message } from '../../src/messages/message';
import { PermissionsRequest } from '../../src/interfaces/permissions/request/message';


describe('Message', () => {
  describe('unmarshal', () => {
    it('throws an exception if raw message is missing descriptor', () => {
      expect(() => {
        Message.unmarshal({});
      }).throws('descriptor');
    });

    it('throws an exception if descriptor is not an object', () => {
      expect(() => {
        const tests = [[], 'descriptor', 1, true, null];

        for (let t of tests) {
          expect(() => {
            const m = { descriptor: t };
            Message.unmarshal(m);
          }).to.throw('array');
        }
      }).to.throw('object');
    });

    it('throws an exception if raw message descriptor is missing method', () => {
      expect(() => {
        const m = { descriptor: {} };
        Message.unmarshal(m);
      }).throws('descriptor');
    });

    it('throws an exception if schema doesnt exist for message type', () => {
      expect(() => {
        const m = { descriptor: { method: 'KakaRequest' } };
        Message.unmarshal(m);
      }).throws('not found.');
    });

    it('throws an exception if validation fails', () => {
      expect(() => {
        const m = {
          descriptor: { method: 'PermissionsRequest' }
        };
        Message.unmarshal(m);
      }).throws('required property');
    });

    it('returns unmarshalled message if validation succeeds', async () => {
      const { privateKeyJwk } = await generateKeyPair();
      const signingMaterial = {
        jwkPrivate      : privateKeyJwk,
        protectedHeader : {
          alg : privateKeyJwk.alg,
          kid : 'did:jank:bob'
        }
      };

      const creator = await PermissionsRequest.create({
        description : 'drugs',
        grantedBy   : 'did:jank:bob',
        grantedTo   : 'did:jank:alice',
        scope       : { method: 'CollectionsWrite' },
        signingMaterial
      });

      const jsonMessage = Message.unmarshal(creator.toObject());

      expect(jsonMessage).to.not.be.undefined;
      expect((jsonMessage as JsonPermissionsRequest).authorization).to.not.be.undefined;
    });
  });
});