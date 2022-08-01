import { expect } from 'chai';
import { Message } from '../../../../src/core/message';
import { v4 as uuidv4 } from 'uuid';

describe('CollectionsWrite schema definition', () => {
  it('should allow descriptor with only required properties', async () => {
    const validMessage = {
      descriptor: {
        method      : 'CollectionsWrite',
        dataCid     : 'anyCid',
        dataFormat  : 'application/json',
        dateCreated : 123,
        nonce       : 'anyNonce',
        recordId    : uuidv4(),
      },
      authorization: {
        payload    : 'anyPayload',
        signatures : [{
          protected : 'anyProtectedHeader',
          signature : 'anySignature'
        }]
      },
    };
    const message = Message.parse(validMessage);

    expect(message).to.not.be.undefined;
    expect(message.authorization).to.not.be.undefined;
  });

  it('should throws if `authorization` is missing', () => {
    const invalidMessage = {
      descriptor: {
        method      : 'CollectionsWrite',
        dataCid     : 'anyCid',
        dataFormat  : 'application/json',
        dateCreated : 123,
        nonce       : 'anyNonce',
        recordId    : uuidv4(),
      }
    };

    expect(() => {
      Message.parse(invalidMessage);
    }).throws('must have required property \'authorization\'');
  });

  it('should throws if unknown property is given in message', () => {
    const invalidMessage = {
      descriptor: {
        method      : 'CollectionsWrite',
        dataCid     : 'anyCid',
        dataFormat  : 'application/json',
        dateCreated : 123,
        nonce       : 'anyNonce',
        recordId    : uuidv4(),
      },
      authorization: {
        payload    : 'anyPayload',
        signatures : [{
          protected : 'anyProtectedHeader',
          signature : 'anySignature'
        }]
      },
      unknownProperty: 'unknownProperty' // unknown property
    };

    expect(() => {
      Message.parse(invalidMessage);
    }).throws('must NOT have additional properties');
  });

  it('should throws if unknown property is given in the `descriptor`', () => {
    const invalidMessage = {
      descriptor: {
        method          : 'CollectionsWrite',
        dataCid         : 'anyCid',
        dataFormat      : 'application/json',
        dateCreated     : 123,
        nonce           : 'anyNonce',
        recordId        : uuidv4(),
        unknownProperty : 'unknownProperty' // unknown property
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
      Message.parse(invalidMessage);
    }).throws('must NOT have additional properties');
  });
});
