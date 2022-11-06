import { expect } from 'chai';
import { Message } from '../../../../src/core/message';
import { v4 as uuidv4 } from 'uuid';

describe('CollectionsWrite schema definition', () => {
  it('should allow descriptor with only required properties', async () => {
    const validMessage = {
      descriptor: {
        target      : 'did:example:anyDid',
        method      : 'CollectionsWrite',
        dataCid     : 'anyCid',
        dataFormat  : 'application/json',
        dateCreated : 123,
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
    Message.validateJsonSchema(validMessage);
  });

  it('should throws if `authorization` is missing', () => {
    const invalidMessage = {
      descriptor: {
        target      : 'did:example:anyDid',
        method      : 'CollectionsWrite',
        dataCid     : 'anyCid',
        dataFormat  : 'application/json',
        dateCreated : 123,
        recordId    : uuidv4(),
      }
    };

    expect(() => {
      Message.validateJsonSchema(invalidMessage);
    }).throws('must have required property \'authorization\'');
  });

  it('should throws if unknown property is given in message', () => {
    const invalidMessage = {
      descriptor: {
        target      : 'did:example:anyDid',
        method      : 'CollectionsWrite',
        dataCid     : 'anyCid',
        dataFormat  : 'application/json',
        dateCreated : 123,
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
      Message.validateJsonSchema(invalidMessage);
    }).throws('must NOT have additional properties');
  });

  it('should throws if unknown property is given in the `descriptor`', () => {
    const invalidMessage = {
      descriptor: {
        target          : 'did:example:anyDid',
        method          : 'CollectionsWrite',
        dataCid         : 'anyCid',
        dataFormat      : 'application/json',
        dateCreated     : 123,
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
      Message.validateJsonSchema(invalidMessage);
    }).throws('must NOT have additional properties');
  });

  it('should throws if `encodedData` is not using base64url character set', () => {
    const invalidMessage = {
      descriptor: {
        target      : 'did:example:anyDid',
        method      : 'CollectionsWrite',
        dataCid     : 'anyCid',
        dataFormat  : 'application/json',
        dateCreated : 123,
        recordId    : uuidv4(),
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

  it('should throw if contextId is set but parentId is missing', () => {
    const invalidMessage = {
      descriptor: {
        target      : 'did:example:anyDid',
        method      : 'CollectionsWrite',
        contextId   : 'invalid', // must have `parentId` to exist
        dataCid     : 'anyCid',
        dataFormat  : 'application/json',
        dateCreated : 123,
        recordId    : uuidv4(),
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
    }).throws('must have required property \'parentId\'');
  });

  it('should throw if parentId is set but contextId is missing', () => {
    const invalidMessage = {
      descriptor: {
        target      : 'did:example:anyDid',
        method      : 'CollectionsWrite',
        parentId    : 'invalid', // must have `contextId` to exist
        dataCid     : 'anyCid',
        dataFormat  : 'application/json',
        dateCreated : 123,
        recordId    : uuidv4(),
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
      descriptor: {
        target        : 'did:example:anyDid',
        method        : 'CollectionsWrite',
        dataCid       : 'anyCid',
        dataFormat    : 'application/json',
        dateCreated   : 123,
        recordId      : uuidv4(),
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
      descriptor: {
        target      : 'did:example:anyDid',
        method      : 'CollectionsWrite',
        dataCid     : 'anyCid',
        dataFormat  : 'application/json',
        dateCreated : 123,
        recordId    : uuidv4(),
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
});
