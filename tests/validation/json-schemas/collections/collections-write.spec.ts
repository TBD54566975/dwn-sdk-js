import { expect } from 'chai';
import { Message } from '../../../../src/core/message';

describe('CollectionsWrite schema definition', () => {
  it('should allow descriptor with only required properties', async () => {
    const validMessage = {
      recordId   : 'anyRecordId',
      descriptor : {
        target      : 'did:example:anyDid',
        method      : 'CollectionsWrite',
        dataCid     : 'anyCid',
        dataFormat  : 'application/json',
        dateCreated : '123',
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
        target      : 'did:example:anyDid',
        method      : 'CollectionsWrite',
        dataCid     : 'anyCid',
        dataFormat  : 'application/json',
        dateCreated : '123'
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
        target      : 'did:example:anyDid',
        method      : 'CollectionsWrite',
        dataCid     : 'anyCid',
        dataFormat  : 'application/json',
        dateCreated : '123'
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
        target      : 'did:example:anyDid',
        method      : 'CollectionsWrite',
        dataCid     : 'anyCid',
        dataFormat  : 'application/json',
        dateCreated : '123'
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
        target          : 'did:example:anyDid',
        method          : 'CollectionsWrite',
        dataCid         : 'anyCid',
        dataFormat      : 'application/json',
        dateCreated     : '123',
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

  it('should throw if `encodedData` is not using base64url character set', () => {
    const invalidMessage = {
      recordId   : 'anyRecordId',
      descriptor : {
        target      : 'did:example:anyDid',
        method      : 'CollectionsWrite',
        dataCid     : 'anyCid',
        dataFormat  : 'application/json',
        dateCreated : '123'
      },
      authorization: {
        payload    : 'anyPayload',
        signatures : [{
          protected : 'anyProtectedHeader',
          signature : 'anySignature'
        }]
      },
      encodedData: 'not-base64url-string!!' // incorrect value
    };

    expect(() => {
      Message.validateJsonSchema(invalidMessage);
    }).throws('must match pattern "^[A-Za-z0-9_-]+$"');
  });

  it('should pass if `contextId` and `protocol` are both present', () => {
    const invalidMessage = {
      recordId   : 'anyRecordId',
      contextId  : 'someContext', // protocol must exist
      descriptor : {
        target      : 'did:example:anyDid',
        method      : 'CollectionsWrite',
        protocol    : 'someProtocolId', // contextId must exist
        dataCid     : 'anyCid',
        dataFormat  : 'application/json',
        dateCreated : '123'
      },
      authorization: {
        payload    : 'anyPayload',
        signatures : [{
          protected : 'anyProtectedHeader',
          signature : 'anySignature'
        }]
      },
      encodedData: 'anything'
    };

    Message.validateJsonSchema(invalidMessage);
  });

  it('should pass if `contextId` and `protocol` are both not present', () => {
    const invalidMessage = {
      recordId   : 'anyRecordId',
      descriptor : {
        target      : 'did:example:anyDid',
        method      : 'CollectionsWrite',
        dataCid     : 'anyCid',
        dataFormat  : 'application/json',
        dateCreated : '123'
      },
      authorization: {
        payload    : 'anyPayload',
        signatures : [{
          protected : 'anyProtectedHeader',
          signature : 'anySignature'
        }]
      },
      encodedData: 'anything'
    };

    Message.validateJsonSchema(invalidMessage);
  });

  it('should throw if `contextId` is set but `protocol` is missing', () => {
    const invalidMessage = {
      recordId   : 'anyRecordId',
      contextId  : 'invalid', // must have `protocol` to exist
      descriptor : {
        target      : 'did:example:anyDid',
        method      : 'CollectionsWrite',
        dataCid     : 'anyCid',
        dataFormat  : 'application/json',
        dateCreated : '123'
      },
      authorization: {
        payload    : 'anyPayload',
        signatures : [{
          protected : 'anyProtectedHeader',
          signature : 'anySignature'
        }]
      },
      encodedData: 'anything'
    };

    expect(() => {
      Message.validateJsonSchema(invalidMessage);
    }).throws('must have required property \'protocol\'');
  });

  it('should throw if `protocol` is set but `contextId` is missing', () => {
    const invalidMessage = {
      recordId   : 'anyRecordId',
      descriptor : {
        target      : 'did:example:anyDid',
        method      : 'CollectionsWrite',
        protocol    : 'invalid', // must have `contextId` to exist
        dataCid     : 'anyCid',
        dataFormat  : 'application/json',
        dateCreated : '123'
      },
      authorization: {
        payload    : 'anyPayload',
        signatures : [{
          protected : 'anyProtectedHeader',
          signature : 'anySignature'
        }]
      },
      encodedData: 'anything'
    };

    expect(() => {
      Message.validateJsonSchema(invalidMessage);
    }).throws('must have required property \'contextId\'');
  });

  it('should throw if published is false and datePublished is present', () => {
    const invalidMessage = {
      recordId   : 'anyRecordId',
      descriptor : {
        target        : 'did:example:anyDid',
        method        : 'CollectionsWrite',
        dataCid       : 'anyCid',
        dataFormat    : 'application/json',
        dateCreated   : 123,
        published     : false,
        datePublished : 123 // must not be present when not published
      },
      authorization: {
        payload    : 'anyPayload',
        signatures : [{
          protected : 'anyProtectedHeader',
          signature : 'anySignature'
        }]
      },
      encodedData: 'anything'
    };

    expect(() => {
      Message.validateJsonSchema(invalidMessage);
    }).throws('published: must be equal to one of the allowed values');
  });

  it('should throw if published is true and datePublished is missing', () => {
    const invalidMessage = {
      recordId   : 'anyRecordId',
      descriptor : {
        target      : 'did:example:anyDid',
        method      : 'CollectionsWrite',
        dataCid     : 'anyCid',
        dataFormat  : 'application/json',
        dateCreated : 123,
        published   : true //datePublished must be present
      },
      authorization: {
        payload    : 'anyPayload',
        signatures : [{
          protected : 'anyProtectedHeader',
          signature : 'anySignature'
        }]
      },
      encodedData: 'anything'
    };

    expect(() => {
      Message.validateJsonSchema(invalidMessage);
    }).throws('must have required property \'datePublished\'');
  });

  it('should throw if published is missing and datePublished is present', () => {
    const invalidMessage = {
      recordId   : 'anyRecordId',
      descriptor : {
        target        : 'did:example:anyDid',
        method        : 'CollectionsWrite',
        dataCid       : 'anyCid',
        dataFormat    : 'application/json',
        dateCreated   : 123,
        datePublished : 123 //published must be present
      },
      authorization: {
        payload    : 'anyPayload',
        signatures : [{
          protected : 'anyProtectedHeader',
          signature : 'anySignature'
        }]
      },
      encodedData: 'anything'
    };

    expect(() => {
      Message.validateJsonSchema(invalidMessage);
    }).throws('must have required property \'published\'');
  });
});
