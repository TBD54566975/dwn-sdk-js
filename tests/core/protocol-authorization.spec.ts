import { expect } from 'chai';
import { ProtocolRuleSet } from '../../src';
import { verifyAllowedActions, verifyAllowedRequester } from '../../src/core/protocol-authorization';
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
        verifyAllowedRequester(did, did, ruleSet as any, [], new Map());
      }).throws('no matching allow requester condition');
    });
  });

  describe('verifyAllowedActions()', async () => {
    it('should throw if requester DID is not the target DWN owner when no allow rule defined', async () => {
      const aliceDid = 'did:example:alice';
      const bobDid = 'did:example:bob';
      const collectionsWriteData = await TestDataGenerator.generateCollectionsWriteMessage({ requesterDid: bobDid, targetDid: aliceDid });
      const ruleSet: ProtocolRuleSet = { };

      expect(() => {
        verifyAllowedActions(bobDid, collectionsWriteData.message, ruleSet);
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
        verifyAllowedActions(did, collectionsWriteData.message, ruleSet);
      }).throws('not in list of allowed actions');
    });
  });
});