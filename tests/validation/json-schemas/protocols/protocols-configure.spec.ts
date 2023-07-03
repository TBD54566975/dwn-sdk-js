import { expect } from 'chai';

import { validateJsonSchema } from '../../../../src/schema-validator.js';
import { DwnInterfaceName, DwnMethodName, Message } from '../../../../src/core/message.js';
import type { ProtocolDefinition, ProtocolsConfigureMessage } from '../../../../src/types/protocols-types.js';

describe('ProtocolsConfigure schema definition', () => {
  it('should throw if unknown actor is encountered in action rule', async () => {
    const protocolDefinition: ProtocolDefinition = {
      protocol : 'email',
      types    : {
        email: {
          schema      : 'email',
          dataFormats : ['text/plain']
        }
      },
      structure: {
        email: {
          $actions: [
            {
              who : 'unknown',
              can : 'write'
            }
          ]
        }
      }
    };

    const message: ProtocolsConfigureMessage = {
      descriptor: {
        interface        : DwnInterfaceName.Protocols,
        method           : DwnMethodName.Configure,
        messageTimestamp : '2022-10-14T10:20:30.405060Z',
        definition       : protocolDefinition
      },
      authorization: {
        payload    : 'anyPayload',
        signatures : [{
          protected : 'anyProtectedHeader',
          signature : 'anySignature'
        }]
      },
    };

    expect(() => {
      Message.validateJsonSchema(message);
    }).throws('/$actions/0');
  });

  describe('rule-set tests', () => {
    it('#183 - should throw if required `can` is missing in rule-set', async () => {
      const invalidRuleSet1 = {
        $actions: [{
          who : 'author',
          of  : 'thread',
          // can: 'read'  // intentionally missing
        }]
      };

      const invalidRuleSet2 = {
        $actions: [{
          who : 'recipient',
          of  : 'thread',
          // can: 'read'  // intentionally missing
        }]
      };

      for (const ruleSet of [invalidRuleSet1, invalidRuleSet2]) {
        expect(() => {
          validateJsonSchema('ProtocolRuleSet', ruleSet);
        }).throws('/$actions/0');
      }
    });

    it('#183 - should throw if required `of` is missing in rule-set', async () => {
      const invalidRuleSet = {
        $actions: [{
          who : 'author',
          // of: 'thread', // intentionally missing
          can : 'read'
        }]
      };

      expect(() => {
        validateJsonSchema('ProtocolRuleSet', invalidRuleSet);
      }).throws('/$actions/0');
    });

    it('#183 - should throw if `of` is present in `anyone` rule-set', async () => {
      const invalidRuleSet = {
        $actions: [{
          who : 'anyone',
          of  : 'thread', // intentionally present
          can : 'read'
        }]
      };

      expect(() => {
        validateJsonSchema('ProtocolRuleSet', invalidRuleSet);
      }).throws('/$actions/0');
    });
  });
});
