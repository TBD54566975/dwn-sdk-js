import { expect } from 'chai';
import { Message } from '../../../../src/core/message.js';

describe('RecordsWrite schema definition', () => {
  it('should allow descriptor with only required properties', async () => {
    const validMessage = {
      recordId   : 'anyRecordId',
      descriptor : {
        interface    : 'Records',
        method       : 'Write',
        dataCid      : 'anyCid',
        dataFormat   : 'application/json',
        dataSize     : 123,
        dateCreated  : '2022-12-19T10:20:30.123456',
        dateModified : '2022-12-19T10:20:30.123456',
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

  it('should throw if `recordId` is missing', async () => {
    const message = {
      descriptor: {
        interface    : 'Records',
        method       : 'Write',
        dataCid      : 'anyCid',
        dataFormat   : 'application/json',
        dataSize     : 123,
        dateCreated  : '2022-12-19T10:20:30.123456',
        dateModified : '2022-12-19T10:20:30.123456'
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
    }).throws('must have required property \'recordId\'');
  });

  it('should throw if `authorization` is missing', () => {
    const invalidMessage = {
      recordId   : 'anyRecordId',
      descriptor : {
        interface    : 'Records',
        method       : 'Write',
        dataCid      : 'anyCid',
        dataFormat   : 'application/json',
        dataSize     : 123,
        dateCreated  : '2022-12-19T10:20:30.123456',
        dateModified : '2022-12-19T10:20:30.123456'
      }
    };

    expect(() => {
      Message.validateJsonSchema(invalidMessage);
    }).throws('must have required property \'authorization\'');
  });

  it('should throw if unknown property is given in message', () => {
    const invalidMessage = {
      recordId   : 'anyRecordId',
      descriptor : {
        interface    : 'Records',
        method       : 'Write',
        dataCid      : 'anyCid',
        dataFormat   : 'application/json',
        dataSize     : 123,
        dateCreated  : '2022-12-19T10:20:30.123456',
        dateModified : '2022-12-19T10:20:30.123456'
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
      recordId   : 'anyRecordId',
      descriptor : {
        interface       : 'Records',
        method          : 'Write',
        dataCid         : 'anyCid',
        dataFormat      : 'application/json',
        dataSize        : 123,
        dateCreated     : '2022-12-19T10:20:30.123456',
        dateModified    : '2022-12-19T10:20:30.123456',
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

  it('should pass if `contextId` and `protocol` are both present', () => {
    const invalidMessage = {
      recordId   : 'anyRecordId',
      contextId  : 'someContext', // protocol must exist
      descriptor : {
        interface    : 'Records',
        method       : 'Write',
        protocol     : 'someProtocolId', // contextId must exist
        dataCid      : 'anyCid',
        dataFormat   : 'application/json',
        dataSize     : 123,
        dateCreated  : '2022-12-19T10:20:30.123456',
        dateModified : '2022-12-19T10:20:30.123456'
      },
      authorization: {
        payload    : 'anyPayload',
        signatures : [{
          protected : 'anyProtectedHeader',
          signature : 'anySignature'
        }]
      }
    };

    Message.validateJsonSchema(invalidMessage);
  });

  it('should pass if `contextId` and `protocol` are both not present', () => {
    const invalidMessage = {
      recordId   : 'anyRecordId',
      descriptor : {
        interface    : 'Records',
        method       : 'Write',
        dataCid      : 'anyCid',
        dataFormat   : 'application/json',
        dataSize     : 123,
        dateCreated  : '2022-12-19T10:20:30.123456',
        dateModified : '2022-12-19T10:20:30.123456'
      },
      authorization: {
        payload    : 'anyPayload',
        signatures : [{
          protected : 'anyProtectedHeader',
          signature : 'anySignature'
        }]
      }
    };

    Message.validateJsonSchema(invalidMessage);
  });

  it('should throw if `contextId` is set but `protocol` is missing', () => {
    const invalidMessage = {
      recordId   : 'anyRecordId',
      contextId  : 'invalid', // must have `protocol` to exist
      descriptor : {
        interface    : 'Records',
        method       : 'Write',
        dataCid      : 'anyCid',
        dataFormat   : 'application/json',
        dataSize     : 123,
        dateCreated  : '2022-12-19T10:20:30.123456',
        dateModified : '2022-12-19T10:20:30.123456'
      },
      authorization: {
        payload    : 'anyPayload',
        signatures : [{
          protected : 'anyProtectedHeader',
          signature : 'anySignature'
        }]
      }
    };

    expect(() => {
      Message.validateJsonSchema(invalidMessage);
    }).throws('must have required property \'protocol\'');
  });

  it('should throw if `protocol` is set but `contextId` is missing', () => {
    const invalidMessage = {
      recordId   : 'anyRecordId',
      descriptor : {
        interface    : 'Records',
        method       : 'Write',
        protocol     : 'invalid', // must have `contextId` to exist
        dataCid      : 'anyCid',
        dataFormat   : 'application/json',
        dataSize     : 123,
        dateCreated  : '2022-12-19T10:20:30.123456',
        dateModified : '2022-12-19T10:20:30.123456'
      },
      authorization: {
        payload    : 'anyPayload',
        signatures : [{
          protected : 'anyProtectedHeader',
          signature : 'anySignature'
        }]
      }
    };

    expect(() => {
      Message.validateJsonSchema(invalidMessage);
    }).throws('must have required property \'contextId\'');
  });

  it('should throw if published is false but datePublished is present', () => {
    const invalidMessage = {
      recordId   : 'anyRecordId',
      descriptor : {
        interface     : 'Records',
        method        : 'Write',
        dataCid       : 'anyCid',
        dataFormat    : 'application/json',
        dataSize      : 123,
        dateModified  : '2022-12-19T10:20:30.123456',
        published     : false,
        dateCreated   : '2022-12-19T10:20:30.123456',
        datePublished : '2022-12-19T10:20:30.123456' // must not be present when not published
      },
      authorization: {
        payload    : 'anyPayload',
        signatures : [{
          protected : 'anyProtectedHeader',
          signature : 'anySignature'
        }]
      }
    };

    expect(() => {
      Message.validateJsonSchema(invalidMessage);
    }).throws('published: must be equal to one of the allowed values');
  });

  it('should throw if published is true but datePublished is missing', () => {
    const invalidMessage = {
      recordId   : 'anyRecordId',
      descriptor : {
        interface    : 'Records',
        method       : 'Write',
        dataCid      : 'anyCid',
        dataFormat   : 'application/json',
        dataSize     : 123,
        dateCreated  : '2022-12-19T10:20:30.123456',
        dateModified : '2022-12-19T10:20:30.123456',
        published    : true //datePublished must be present
      },
      authorization: {
        payload    : 'anyPayload',
        signatures : [{
          protected : 'anyProtectedHeader',
          signature : 'anySignature'
        }]
      }
    };

    expect(() => {
      Message.validateJsonSchema(invalidMessage);
    }).throws('must have required property \'datePublished\'');
  });

  it('should throw if published is missing and datePublished is present', () => {
    const invalidMessage = {
      recordId   : 'anyRecordId',
      descriptor : {
        interface     : 'Records',
        method        : 'Write',
        dataCid       : 'anyCid',
        dataFormat    : 'application/json',
        dataSize      : 123,
        dateCreated   : '2022-12-19T10:20:30.123456',
        dateModified  : '2022-12-19T10:20:30.123456',
        datePublished : '2022-12-19T10:20:30.123456' //published must be present
      },
      authorization: {
        payload    : 'anyPayload',
        signatures : [{
          protected : 'anyProtectedHeader',
          signature : 'anySignature'
        }]
      }
    };

    expect(() => {
      Message.validateJsonSchema(invalidMessage);
    }).throws('must have required property \'published\'');
  });
});
