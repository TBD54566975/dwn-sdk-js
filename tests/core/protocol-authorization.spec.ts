import { expect } from 'chai';
import { ProtocolRuleSet } from '../../src';
import { ProtocolAuthorization } from '../../src/core/protocol-authorization';
import { TestDataGenerator } from '../utils/test-data-generator';

describe('Protocol-Based Authorization', async () => {
  describe('verifyAllowedRequester()', async () => {
    it('should throw if action performed is not in an allowed action list', async () => {
      const did = 'did:example:alice';
      const ruleSet = {
        allow: {
          maliciousActor: { // unknown requester rule
            to: ['delete']
          }
        }
      };

      expect(() => {
        ProtocolAuthorization['verifyAllowedRequester'](did, did, ruleSet as any, [], new Map());
      }).throws('no matching allow requester condition');
    });
  });

  describe('verifyAllowedActions()', async () => {
    it('should throw if requester DID is not the target DWN owner when no allow rule defined', async () => {
      const alice = await TestDataGenerator.generatePersona();
      const bob = await TestDataGenerator.generatePersona();
      const collectionsWriteData = await TestDataGenerator.generateCollectionsWriteMessage({ requester: bob, target: alice });
      const ruleSet: ProtocolRuleSet = { };

      expect(() => {
        ProtocolAuthorization['verifyAllowedActions'](bob.did, collectionsWriteData.message, ruleSet);
      }).throws('no allow rule defined for CollectionsWrite');
    });

    it('should throw if action performed is not in an allowed action list', async () => {
      const did = 'did:example:alice';
      const collectionsWriteData = await TestDataGenerator.generateCollectionsWriteMessage();
      const ruleSet: ProtocolRuleSet = {
        allow: {
          anyone: {
            to: ['delete'] // does not include 'write' which is needed for CollectionsWrite messages
          }
        }
      };

      expect(() => {
        ProtocolAuthorization['verifyAllowedActions'](did, collectionsWriteData.message, ruleSet);
      }).throws('not in list of allowed actions');
    });
  });
});