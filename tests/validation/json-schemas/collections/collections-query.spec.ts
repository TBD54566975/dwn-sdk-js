import { expect } from 'chai';
import { Message } from '../../../../src/core/message';

describe('CollectionsQuery schema definition', () => {
  it('should allow descriptor with only required properties', async () => {
    const validMessage = {
      descriptor: {
        method : 'CollectionsQuery',
        nonce  : 'anyNonce'
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
    expect(message.descriptor).to.not.be.undefined;
  });

  it('should throws if `authorization` is missing', () => {
    const invalidMessage = {
      descriptor: {
        method : 'CollectionsQuery',
        nonce  : 'anyNonce',
        schema : 'anySchema'
      }
    };

    expect(() => {
      Message.parse(invalidMessage);
    }).throws('must have required property \'authorization\'');
  });

  it('should throws if unknown property is given in message', () => {
    const invalidMessage = {
      descriptor: {
        method : 'CollectionsQuery',
        nonce  : 'anyNonce',
        schema : 'anySchema'
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
        method          : 'CollectionsQuery',
        nonce           : 'anyNonce',
        schema          : 'anySchema',
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

  it('should only allows string values from the spec for `dateSort`', () => {
    // test all valid values of `dateSort`
    const allowedDateSortValues = ['createdAscending', 'createdDescending', 'publishedAscending', 'publishedAscending'];
    for (const dateSortValue of allowedDateSortValues) {
      const validMessage = {
        descriptor: {
          method   : 'CollectionsQuery',
          nonce    : 'anyNonce',
          dateSort : dateSortValue
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
      expect(message.descriptor).to.not.be.undefined;
    }

    // test an invalid values of `dateSort`
    const invalidMessage = {
      descriptor: {
        method   : 'CollectionsQuery',
        nonce    : 'anyNonce',
        dateSort : 'unacceptable', // bad value
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
    }).throws('dateSort: must be equal to one of the allowed values');
  });
});
