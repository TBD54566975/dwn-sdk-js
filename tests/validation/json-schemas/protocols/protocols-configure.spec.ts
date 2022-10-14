import { expect } from 'chai';
import { Message } from '../../../../src/core/message';

describe('ProtocolsConfigure schema definition', () => {
  it('should throw if when unknown allow rule is encountered', async () => {
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
        target      : 'did:example:anyDid',
        method      : 'ProtocolsConfigure',
        dateCreated : 123,
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
      Message.parse(message);
    }).throws('must NOT have additional properties');
  });
});
