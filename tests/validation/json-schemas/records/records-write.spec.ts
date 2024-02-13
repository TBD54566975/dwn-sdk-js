import { expect } from 'chai';
import { Message } from '../../../../src/core/message.js';
import { TestDataGenerator } from '../../../utils/test-data-generator.js';

describe('RecordsWrite schema definition', () => {
  it('should allow descriptor with only required properties', async () => {
    const validMessage = {
      recordId   : 'anyRecordId',
      descriptor : {
        interface        : 'Records',
        method           : 'Write',
        dataCid          : 'anyCid',
        dataFormat       : 'application/json',
        dataSize         : 123,
        dateCreated      : '2022-12-19T10:20:30.123456Z',
        messageTimestamp : '2022-12-19T10:20:30.123456Z',
      },
      authorization: TestDataGenerator.generateAuthorization()
    };
    Message.validateJsonSchema(validMessage);
  });

  it('should throw if `recordId` is missing', async () => {
    const message = {
      descriptor: {
        interface        : 'Records',
        method           : 'Write',
        dataCid          : 'anyCid',
        dataFormat       : 'application/json',
        dataSize         : 123,
        dateCreated      : '2022-12-19T10:20:30.123456Z',
        messageTimestamp : '2022-12-19T10:20:30.123456Z'
      },
      authorization: TestDataGenerator.generateAuthorization()
    };

    expect(() => {
      Message.validateJsonSchema(message);
    }).throws('must have required property \'recordId\'');
  });

  it('should throw if `authorization` is missing', () => {
    const invalidMessage = {
      recordId   : 'anyRecordId',
      descriptor : {
        interface        : 'Records',
        method           : 'Write',
        dataCid          : 'anyCid',
        dataFormat       : 'application/json',
        dataSize         : 123,
        dateCreated      : '2022-12-19T10:20:30.123456Z',
        messageTimestamp : '2022-12-19T10:20:30.123456Z'
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
        interface        : 'Records',
        method           : 'Write',
        dataCid          : 'anyCid',
        dataFormat       : 'application/json',
        dataSize         : 123,
        dateCreated      : '2022-12-19T10:20:30.123456Z',
        messageTimestamp : '2022-12-19T10:20:30.123456Z'
      },
      authorization   : TestDataGenerator.generateAuthorization(),
      unknownProperty : 'unknownProperty' // unknown property
    };

    expect(() => {
      Message.validateJsonSchema(invalidMessage);
    }).throws('must NOT have additional properties');
  });

  it('should throw if unknown property is given in the `descriptor`', () => {
    const invalidMessage = {
      recordId   : 'anyRecordId',
      descriptor : {
        interface        : 'Records',
        method           : 'Write',
        dataCid          : 'anyCid',
        dataFormat       : 'application/json',
        dataSize         : 123,
        dateCreated      : '2022-12-19T10:20:30.123456Z',
        messageTimestamp : '2022-12-19T10:20:30.123456Z',
        unknownProperty  : 'unknownProperty' // unknown property
      },
      authorization: TestDataGenerator.generateAuthorization()
    };

    expect(() => {
      Message.validateJsonSchema(invalidMessage);
    }).throws('must NOT have additional properties');
  });

  it('should pass if `protocol` exists and its related properties are all present', () => {
    const validMessage = {
      recordId   : 'anyRecordId',
      contextId  : 'someContext', // must exist because `protocol` exists
      descriptor : {
        interface        : 'Records',
        method           : 'Write',
        protocol         : 'someProtocolId',
        protocolPath     : 'foo/bar', // must exist because `protocol` exists
        schema           : 'http://foo.bar/schema', // must exist because `protocol` exists
        dataCid          : 'anyCid',
        dataFormat       : 'application/json',
        dataSize         : 123,
        dateCreated      : '2022-12-19T10:20:30.123456Z',
        messageTimestamp : '2022-12-19T10:20:30.123456Z'
      },
      authorization: TestDataGenerator.generateAuthorization()
    };

    Message.validateJsonSchema(validMessage);
  });

  it('should throw if `protocolPath` contains invalid characters', () => {
    const invalidMessage = {
      recordId   : 'anyRecordId',
      contextId  : 'someContext',
      descriptor : {
        interface        : 'Records',
        method           : 'Write',
        protocol         : 'http://foo.bar',
        protocolPath     : 'invalid:path', // `:` is not a valid char in `protocolPath`
        schema           : 'http://foo.bar/schema',
        dataCid          : 'anyCid',
        dataFormat       : 'application/json',
        dataSize         : 123,
        dateCreated      : '2022-12-19T10:20:30.123456Z',
        messageTimestamp : '2022-12-19T10:20:30.123456Z'
      },
      authorization: TestDataGenerator.generateAuthorization()
    };

    expect(() => {
      Message.validateJsonSchema(invalidMessage);
    }).throws('protocolPath: must match pattern "^[a-zA-Z]+(/[a-zA-Z]+)*$');
  });

  it('should throw if `contextId` is malformed', () => {
    const validMessage = {
      recordId   : 'anyRecordId',
      contextId  : 'invalid:path', // `:` is not a valid char in `contextId`
      descriptor : {
        interface        : 'Records',
        method           : 'Write',
        protocol         : 'http://foo.bar',
        protocolPath     : 'A/B/C',
        schema           : 'http://foo.bar/schema',
        dataCid          : 'anyCid',
        dataFormat       : 'application/json',
        dataSize         : 123,
        dateCreated      : '2022-12-19T10:20:30.123456Z',
        messageTimestamp : '2022-12-19T10:20:30.123456Z'
      },
      authorization: TestDataGenerator.generateAuthorization()
    };

    const expectedErrorMessage = 'contextId: must match pattern "^[a-zA-Z0-9]+(/[a-zA-Z0-9]+)*$';

    const invalidMessage1 = { ...validMessage };
    invalidMessage1.contextId = 'invalid:path', // `:` is not a valid char in `contextId`
    expect(() => {
      Message.validateJsonSchema(invalidMessage1);
    }).throws(expectedErrorMessage);

    const invalidMessage2 = { ...validMessage };
    invalidMessage2.contextId = '/invalid/context'; // not allowed to start with `/`
    expect(() => {
      Message.validateJsonSchema(invalidMessage2);
    }).throws(expectedErrorMessage);

    const invalidMessage3 = { ...validMessage };
    invalidMessage3.contextId = 'invalid/context/'; // not allowed to end with `/`
    expect(() => {
      Message.validateJsonSchema(invalidMessage3);
    }).throws(expectedErrorMessage);
  });

  it('should pass if none of `protocol` related properties are present', () => {
    const invalidMessage = {
      recordId   : 'anyRecordId',
      descriptor : {
        interface        : 'Records',
        method           : 'Write',
        dataCid          : 'anyCid',
        dataFormat       : 'application/json',
        dataSize         : 123,
        dateCreated      : '2022-12-19T10:20:30.123456Z',
        messageTimestamp : '2022-12-19T10:20:30.123456Z'
      },
      authorization: TestDataGenerator.generateAuthorization()
    };

    Message.validateJsonSchema(invalidMessage);
  });

  it('should throw if `contextId` is defined but `protocol` is missing', () => {
    const invalidMessage = {
      recordId   : 'anyRecordId',
      contextId  : 'invalid', // must have `protocol` to exist
      descriptor : {
        interface        : 'Records',
        method           : 'Write',
        dataCid          : 'anyCid',
        dataFormat       : 'application/json',
        dataSize         : 123,
        dateCreated      : '2022-12-19T10:20:30.123456Z',
        messageTimestamp : '2022-12-19T10:20:30.123456Z'
      },
      authorization: TestDataGenerator.generateAuthorization()
    };

    expect(() => {
      Message.validateJsonSchema(invalidMessage);
    }).throws('must have required property \'protocol\'');
  });

  it('should throw if `protocol` is defined but `contextId` is missing', () => {
    const invalidMessage = {
      recordId   : 'anyRecordId',
      descriptor : {
        interface        : 'Records',
        method           : 'Write',
        protocol         : 'invalid', // must have `contextId` to exist
        dataCid          : 'anyCid',
        dataFormat       : 'application/json',
        dataSize         : 123,
        dateCreated      : '2022-12-19T10:20:30.123456Z',
        messageTimestamp : '2022-12-19T10:20:30.123456Z'
      },
      authorization: TestDataGenerator.generateAuthorization()
    };

    expect(() => {
      Message.validateJsonSchema(invalidMessage);
    }).throws('must have required property \'contextId\'');
  });

  it('#434 - should throw if `parentId` is defined without other protocol related properties', () => {
    const invalidMessage = {
      recordId   : 'anyRecordId',
      // contextId  : 'anyContextId', // intentionally missing
      descriptor : {
        interface        : 'Records',
        method           : 'Write',
        // protocol         : 'http://foo.bar', // intentionally missing
        // protocolPath     : 'foo/bar', // intentionally missing
        parentId         : 'anyParentId',
        dataCid          : 'anyCid',
        dataFormat       : 'application/json',
        dataSize         : 123,
        dateCreated      : '2022-12-19T10:20:30.123456Z',
        messageTimestamp : '2022-12-19T10:20:30.123456Z'
      },
      authorization: TestDataGenerator.generateAuthorization()
    };

    expect(() => {
      Message.validateJsonSchema(invalidMessage);
    }).throws('must have property protocol when property parentId is present');
  });

  it('should throw if `protocol` is defined but `protocolPath` is missing', () => {
    const invalidMessage = {
      recordId   : 'anyRecordId',
      contextId  : 'anyContextId', // required by protocol-based message
      descriptor : {
        interface        : 'Records',
        method           : 'Write',
        protocol         : 'http://foo.bar',
        // protocolPath : 'foo/bar', // intentionally missing
        dataCid          : 'anyCid',
        dataFormat       : 'application/json',
        dataSize         : 123,
        dateCreated      : '2022-12-19T10:20:30.123456Z',
        messageTimestamp : '2022-12-19T10:20:30.123456Z'
      },
      authorization: TestDataGenerator.generateAuthorization()
    };

    expect(() => {
      Message.validateJsonSchema(invalidMessage);
    }).throws('descriptor: must have required property \'protocolPath\'');
  });

  it('should throw if `protocolPath` is defined but `protocol` is missing', () => {
    const invalidMessage = {
      recordId   : 'anyRecordId',
      contextId  : 'anyContextId',
      descriptor : {
        interface        : 'Records',
        method           : 'Write',
        // protocol     : 'http://foo.bar', // intentionally missing
        protocolPath     : 'foo/bar',
        dataCid          : 'anyCid',
        dataFormat       : 'application/json',
        dataSize         : 123,
        dateCreated      : '2022-12-19T10:20:30.123456Z',
        messageTimestamp : '2022-12-19T10:20:30.123456Z'
      },
      authorization: TestDataGenerator.generateAuthorization()
    };

    expect(() => {
      Message.validateJsonSchema(invalidMessage);
    }).throws('descriptor: must have required property \'protocol\'');
  });

  it('should throw if `protocol` is undefined but `recipient` is defined', () => {
    const invalidMessage = {
      recordId   : 'anyRecordId',
      contextId  : 'anyContextId',
      descriptor : {
        interface        : 'Records',
        method           : 'Write',
        // protocol     : 'http://foo.bar', // intentionally missing
        recipient        : 'did:example:anyone',
        // protocolPath : 'foo/bar', // intentionally missing
        schema           : 'http://foo.bar/schema',
        dataCid          : 'anyCid',
        dataFormat       : 'application/json',
        dataSize         : 123,
        dateCreated      : '2022-12-19T10:20:30.123456Z',
        messageTimestamp : '2022-12-19T10:20:30.123456Z'
      },
      authorization: TestDataGenerator.generateAuthorization()
    };

    expect(() => {
      Message.validateJsonSchema(invalidMessage);
    }).throws('descriptor: must have required property \'protocol\'');
  });

  it('should pass if `protocol` is defined but `recipient` undefined', () => {
    const invalidMessage = {
      recordId   : 'anyRecordId',
      contextId  : 'anyContextId',
      descriptor : {
        interface        : 'Records',
        method           : 'Write',
        protocol         : 'http://foo.bar',
        // recipient    : 'did:example:anyone', // intentionally missing
        protocolPath     : 'foo/bar',
        schema           : 'http://foo.bar/schema',
        dataCid          : 'anyCid',
        dataFormat       : 'application/json',
        dataSize         : 123,
        dateCreated      : '2022-12-19T10:20:30.123456Z',
        messageTimestamp : '2022-12-19T10:20:30.123456Z'
      },
      authorization: TestDataGenerator.generateAuthorization()
    };

    Message.validateJsonSchema(invalidMessage);
  });

  it('should pass if `protocol` and `recipient` are both defined', () => {
    const invalidMessage = {
      recordId   : 'anyRecordId',
      contextId  : 'anyContextId',
      descriptor : {
        interface        : 'Records',
        method           : 'Write',
        protocol         : 'http://foo.bar',
        recipient        : 'did:example:anyone',
        protocolPath     : 'foo/bar',
        schema           : 'http://foo.bar/schema',
        dataCid          : 'anyCid',
        dataFormat       : 'application/json',
        dataSize         : 123,
        dateCreated      : '2022-12-19T10:20:30.123456Z',
        messageTimestamp : '2022-12-19T10:20:30.123456Z'
      },
      authorization: TestDataGenerator.generateAuthorization()
    };

    Message.validateJsonSchema(invalidMessage);
  });

  it('should throw if published is false but datePublished is present', () => {
    const invalidMessage = {
      recordId   : 'anyRecordId',
      descriptor : {
        interface        : 'Records',
        method           : 'Write',
        dataCid          : 'anyCid',
        dataFormat       : 'application/json',
        dataSize         : 123,
        messageTimestamp : '2022-12-19T10:20:30.123456Z',
        published        : false,
        dateCreated      : '2022-12-19T10:20:30.123456Z',
        datePublished    : '2022-12-19T10:20:30.123456Z' // must not be present when not published
      },
      authorization: TestDataGenerator.generateAuthorization()
    };

    expect(() => {
      Message.validateJsonSchema(invalidMessage);
    }).throws('published: must be equal to one of the allowed values');
  });

  it('should throw if published is true but datePublished is missing', () => {
    const invalidMessage = {
      recordId   : 'anyRecordId',
      descriptor : {
        interface        : 'Records',
        method           : 'Write',
        dataCid          : 'anyCid',
        dataFormat       : 'application/json',
        dataSize         : 123,
        dateCreated      : '2022-12-19T10:20:30.123456Z',
        messageTimestamp : '2022-12-19T10:20:30.123456Z',
        published        : true //datePublished must be present
      },
      authorization: TestDataGenerator.generateAuthorization()
    };

    expect(() => {
      Message.validateJsonSchema(invalidMessage);
    }).throws('must have required property \'datePublished\'');
  });

  it('should throw if published is missing and datePublished is present', () => {
    const invalidMessage = {
      recordId   : 'anyRecordId',
      descriptor : {
        interface        : 'Records',
        method           : 'Write',
        dataCid          : 'anyCid',
        dataFormat       : 'application/json',
        dataSize         : 123,
        dateCreated      : '2022-12-19T10:20:30.123456Z',
        messageTimestamp : '2022-12-19T10:20:30.123456Z',
        datePublished    : '2022-12-19T10:20:30.123456Z' //published must be present
      },
      authorization: TestDataGenerator.generateAuthorization()
    };

    expect(() => {
      Message.validateJsonSchema(invalidMessage);
    }).throws('must have required property \'published\'');
  });
});
