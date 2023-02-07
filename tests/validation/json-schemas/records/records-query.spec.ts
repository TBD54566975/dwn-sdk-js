import { expect } from 'chai';
import { Message } from '../../../../src/core/message.js';

describe('RecordsQuery schema validation', () => {
  it('should allow descriptor with only required properties', async () => {
    const validMessage = {
      descriptor: {
        interface   : 'Records',
        method      : 'Query',
        dateCreated : '123',
        filter      : { schema: 'anySchema' }
      },
      authorization: {
        payload    : 'anyPayload',
        signatures : [{
          protected : 'anyProtectedHeader',
          signature : 'anySignature'
        }]
      },
    };
    Message.validateJsonSchema(validMessage);
  });

  it('should throw if `authorization` is missing', () => {
    const invalidMessage = {
      descriptor: {
        interface   : 'Records',
        method      : 'Query',
        dateCreated : '123',
        filter      : { schema: 'anySchema' }
      }
    };

    expect(() => {
      Message.validateJsonSchema(invalidMessage);
    }).throws('must have required property \'authorization\'');
  });

  it('should throw if unknown property is given in message', () => {
    const invalidMessage = {
      descriptor: {
        interface   : 'Records',
        method      : 'Query',
        dateCreated : '123',
        filter      : { schema: 'anySchema' }
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
      Message.validateJsonSchema(invalidMessage);
    }).throws('must NOT have additional properties');
  });

  it('should throw if unknown property is given in the `descriptor`', () => {
    const invalidMessage = {
      descriptor: {
        interface       : 'Records',
        method          : 'Query',
        dateCreated     : '123',
        filter          : { schema: 'anySchema' },
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
      Message.validateJsonSchema(invalidMessage);
    }).throws('must NOT have additional properties');
  });

  it('should only allows string values from the spec for `dateSort`', () => {
    // test all valid values of `dateSort`
    const allowedDateSortValues = ['createdAscending', 'createdDescending', 'publishedAscending', 'publishedAscending'];
    for (const dateSortValue of allowedDateSortValues) {
      const validMessage = {
        descriptor: {
          interface   : 'Records',
          method      : 'Query',
          dateCreated : '123',
          filter      : { schema: 'anySchema' },
          dateSort    : dateSortValue
        },
        authorization: {
          payload    : 'anyPayload',
          signatures : [{
            protected : 'anyProtectedHeader',
            signature : 'anySignature'
          }]
        },
      };

      Message.validateJsonSchema(validMessage);
    }

    // test an invalid values of `dateSort`
    const invalidMessage = {
      descriptor: {
        interface   : 'Records',
        method      : 'Query',
        dateCreated : '123',
        filter      : { schema: 'anySchema' },
        dateSort    : 'unacceptable', // bad value
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
      Message.validateJsonSchema(invalidMessage);
    }).throws('dateSort: must be equal to one of the allowed values');
  });

  describe('`filter` property validation', () => {
    it('should throw if empty `filter` property is given in the `descriptor`', () => {
      const invalidMessage = {
        descriptor: {
          interface   : 'Records',
          method      : 'Query',
          dateCreated : '123',
          filter      : { }
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
        Message.validateJsonSchema(invalidMessage);
      }).throws('/descriptor/filter: must NOT have fewer than 1 properties');
    });

    it('should throw if `dateCreated` criteria given is an empty object', () => {
      const invalidMessage = {
        descriptor: {
          interface   : 'Records',
          method      : 'Query',
          dateCreated : '123',
          filter      : { dateCreated: { } } // empty `dateCreated` criteria
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
        Message.validateJsonSchema(invalidMessage);
      }).throws('dateCreated: must NOT have fewer than 1 properties');
    });

    it('should throw if `dateCreated` criteria has unexpected properties', () => {
      const invalidMessage = {
        descriptor: {
          interface   : 'Records',
          method      : 'Query',
          dateCreated : '123',
          filter      : { dateCreated: { unexpectedProperty: 'anyValue' } } // unexpected property in `dateCreated` criteria
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
        Message.validateJsonSchema(invalidMessage);
      }).throws('must NOT have additional properties');
    });
  });
});
