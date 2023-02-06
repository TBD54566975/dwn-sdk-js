import { expect } from 'chai';
import { Message } from '../../../../src/core/message.js';
import { validateJsonSchema } from '../../../../src/schema-validator.js';

describe('ProtocolsConfigure schema definition', () => {
  it('should throw if unknown allow rule is encountered', async () => {
    const protocolDefinition = {
      labels: {
        email: {
          schema: 'email'
        }
      },
      records: {
        email: {
          allow: {
            unknown: { // this will be considered an "additional property" beyond what's allowed in the `oneOf` definition
              to: ['write']
            }
          }
        }
      }
    };

    const message = {
      descriptor: {
        interface   : 'Protocols',
        method      : 'Configure',
        dateCreated : '123',
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
    }).throws('must NOT have additional properties');
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
