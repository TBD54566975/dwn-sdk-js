import { expect } from 'chai';

import { validateJsonSchema } from '../../../../src/schema-validator.js';
import { DwnInterfaceName, DwnMethodName, Message } from '../../../../src/core/message.js';
import type { ProtocolDefinition, ProtocolsConfigureMessage } from '../../../../src/interfaces/protocols/types.js';

describe('ProtocolsConfigure schema definition', () => {
  it('should throw if unknown actor is encountered in allow rule', async () => {
    const protocolDefinition: ProtocolDefinition = {
      recordDefinitions: [{
        id     : 'email',
        schema : 'email'
      }],
      records: {
        email: {
          $actions: [
            {
              actor : 'unknown',
              can   : 'write'
            }
          ]
        }
      }
    };

    const message: ProtocolsConfigureMessage = {
      descriptor: {
        interface   : DwnInterfaceName.Protocols,
        method      : DwnMethodName.Configure,
        dateCreated : '2022-10-14T10:20:30.405060Z',
        protocol    : 'anyProtocolUri',
        definition  : protocolDefinition
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
    }).throws('actor: must be equal to one of the allowed values');
  });

  describe('rule-set tests', () => {
    it('#183 - should throw if required `to` is missing in rule-set', async () => {
      const invalidRuleSet1 = {
        allow: {
          anyone: {
          // to: ['write'] // intentionally missing
          }
        }
      };

      const invalidRuleSet2 = {
        allow: {
          recipient: {
            of: 'thread'
          // to: ['write'] // intentionally missing
          }
        }
      };

      for (const ruleSet of [invalidRuleSet1, invalidRuleSet2]) {
        expect(() => {
          validateJsonSchema('ProtocolRuleSet', ruleSet);
        }).throws(); // error message is misleading thus not checking explicitly
      }
    });

    it('#183 - should throw if required `of` is missing in rule-set', async () => {
      const invalidRuleSet = {
        allow: {
          recipient: {
          // of : 'thread', // intentionally missing
            to: ['write']
          }
        }
      };

      expect(() => {
        validateJsonSchema('ProtocolRuleSet', invalidRuleSet);
      }).throws(); // error message is misleading thus not checking explicitly
    });
  });
});
