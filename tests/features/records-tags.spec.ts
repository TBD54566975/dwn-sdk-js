import type { DidResolver } from '@web5/dids';
import type { EventStream } from '../../src/types/subscriptions.js';
import type { DataStore, EventLog, MessageStore, ProtocolDefinition, ProtocolsConfigureDescriptor } from '../../src/index.js';


import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import chai, { expect } from 'chai';

import { DidKey } from '@web5/dids';
import { Dwn } from '../../src/dwn.js';
import { DwnErrorCode } from '../../src/core/dwn-error.js';
import { Jws } from '../../src/utils/jws.js';
import { RecordsRead } from '../../src/interfaces/records-read.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestEventStream } from '../test-event-stream.js';
import { TestStores } from '../test-stores.js';
import { UniversalResolver } from '@web5/dids';
import { DwnInterfaceName, DwnMethodName, Message, Time } from '../../src/index.js';


chai.use(chaiAsPromised);

export function testRecordsTags(): void {
  describe('Records Tags', () => {
    let didResolver: DidResolver;
    let messageStore: MessageStore;
    let dataStore: DataStore;
    let eventLog: EventLog;
    let eventStream: EventStream;
    let dwn: Dwn;

    // important to follow the `before` and `after` pattern to initialize and clean the stores in tests
    // so that different test suites can reuse the same backend store for testing
    before(async () => {
      didResolver = new UniversalResolver({ didResolvers: [DidKey] });

      const stores = TestStores.get();
      messageStore = stores.messageStore;
      dataStore = stores.dataStore;
      eventLog = stores.eventLog;
      eventStream = TestEventStream.get();

      dwn = await Dwn.create({ didResolver, messageStore, dataStore, eventLog, eventStream });
    });

    beforeEach(async () => {
      sinon.restore(); // wipe all previous stubs/spies/mocks/fakes

      // clean up before each test rather than after so that a test does not depend on other tests to do the clean up
      await messageStore.clear();
      await dataStore.clear();
      await eventLog.clear();
    });

    after(async () => {
      await dwn.close();
    });

    describe('RecordsWrite with tags', () => {
      describe('protocol rules', () => {
        describe('ProtocolsConfigure', () => {
          it('should support protocol tag types of string, number, boolean and array types of numbers and strings', async () => {
            const alice = await TestDataGenerator.generateDidKeyPersona();

            // configure a protocol with tags of string, number, boolean and array types of numbers and strings
            const protocolDefinition: ProtocolDefinition = {
              protocol  : 'http://example.com/protocol/withTags',
              published : true,
              types     : {
                foo: {}
              },
              structure: {
                foo: {
                  $tags: {
                    stringTag: {
                      type: 'string',
                    },
                    numberType: {
                      type: 'number',
                    },
                    booleanType: {
                      type: 'boolean',
                    },
                    stringArray: {
                      type  : 'array',
                      items : {
                        type: 'string',
                      }
                    },
                    numberArray: {
                      type  : 'array',
                      items : {
                        type: 'number',
                      }
                    },
                  }
                }
              },
            };

            const protocolConfigure = await TestDataGenerator.generateProtocolsConfigure({
              author: alice,
              protocolDefinition,
            });

            const configureReply = await dwn.processMessage(alice.did, protocolConfigure.message);
            expect(configureReply.status.code).to.equal(202);
          });

          describe('should not support tag types', () => {
            it('object', async () => {
              const alice = await TestDataGenerator.generateDidKeyPersona();

              // protocol definition with unsupported tag type of object
              const objectTagsType: ProtocolDefinition = {
                protocol  : 'http://example.com/protocol/withTags',
                published : true,
                types     : {
                  foo: {}
                },
                structure: {
                  foo: {
                    $tags: {
                      objectTag: {
                        type: 'object',
                      },
                    }
                  }
                },
              }
              ;
              // manually craft the invalid ProtocolsConfigure message because our library will not let you create an invalid definition
              const descriptor: ProtocolsConfigureDescriptor = {
                interface        : DwnInterfaceName.Protocols,
                method           : DwnMethodName.Configure,
                messageTimestamp : Time.getCurrentTimestamp(),
                definition       : objectTagsType
              };

              const authorization = await Message.createAuthorization({
                descriptor,
                signer: Jws.createSigner(alice)
              });

              const protocolsConfigureMessage = { descriptor, authorization };
              const objectTagsTypeConfigureReply = await dwn.processMessage(alice.did, protocolsConfigureMessage);
              expect(objectTagsTypeConfigureReply.status.code).to.equal(400);
            });

            it('array of objects', async () => {
              const alice = await TestDataGenerator.generateDidKeyPersona();

              // protocol definition with unsupported tag type array of objects
              const objectArrayTagsType: ProtocolDefinition = {
                protocol  : 'http://example.com/protocol/withTags',
                published : true,
                types     : {
                  foo: {}
                },
                structure: {
                  foo: {
                    $tags: {
                      objectArrayTag: {
                        type  : 'array',
                        items : {
                          type: 'object',
                        }
                      },
                    }
                  }
                },
              };

              // manually craft the invalid ProtocolsConfigure message because our library will not let you create an invalid definition
              const descriptor = {
                interface        : DwnInterfaceName.Protocols,
                method           : DwnMethodName.Configure,
                messageTimestamp : Time.getCurrentTimestamp(),
                definition       : objectArrayTagsType
              };
              const authorization = await Message.createAuthorization({
                descriptor,
                signer: Jws.createSigner(alice)
              });
              const protocolsConfigureMessage = { descriptor, authorization };

              const objectArrayTagsTypeConfigureReply = await dwn.processMessage(alice.did, protocolsConfigureMessage);
              expect(objectArrayTagsTypeConfigureReply.status.code).to.equal(400);
            });

            it('array of booleans', async () => {
              const alice = await TestDataGenerator.generateDidKeyPersona();

              // protocol definition with unsupported tag type array of booleans
              const booleanArrayTagsType: ProtocolDefinition = {
                protocol  : 'http://example.com/protocol/withTags',
                published : true,
                types     : {
                  foo: {}
                },
                structure: {
                  foo: {
                    $tags: {
                      booleanArrayTag: {
                        type  : 'array',
                        items : {
                          type: 'boolean',
                        }
                      },
                    }
                  }
                },
              };

              const descriptor = {
                interface        : DwnInterfaceName.Protocols,
                method           : DwnMethodName.Configure,
                messageTimestamp : Time.getCurrentTimestamp(),
                definition       : booleanArrayTagsType
              };

              const authorization = await Message.createAuthorization({
                descriptor,
                signer: Jws.createSigner(alice)
              });
              const protocolsConfigureMessage = { descriptor, authorization };

              const booleanArrayTagsTypeConfigureReply = await dwn.processMessage(alice.did, protocolsConfigureMessage);
              expect(booleanArrayTagsTypeConfigureReply.status.code).to.equal(400);
            });
          });
        });

        it('should reject a record with a tag property that does not match the protocol definition tags', async () => {
          const alice = await TestDataGenerator.generateDidKeyPersona();

          // has a `knownTag` tag in the protocol definition
          const protocolDefinition = {
            protocol  : 'http://example.com/protocol/withTags',
            published : true,
            types     : {
              foo: {}
            },
            structure: {
              foo: {
                $tags: {
                  knownTag: {
                    type: 'string',
                  },
                }
              }
            },
          };

          // configure tags protocol
          const protocolConfigure = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition,
          });

          const configureReply = await dwn.processMessage(alice.did, protocolConfigure.message);
          expect(configureReply.status.code).to.equal(202);

          // write a foo record with an `unknownTag` tag.
          const fooRecord = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            published    : true,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'foo',
            tags         : {
              unknownTag: 'some-value'
            }
          });

          const fooRecordReply = await dwn.processMessage(alice.did, fooRecord.message, { dataStream: fooRecord.dataStream });
          expect(fooRecordReply.status.code).to.equal(400);
          expect(fooRecordReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationTagsInvalidSchema);

          // ensure the correct tag descriptor is in the error message
          expect(fooRecordReply.status.detail).to.contain(`${protocolDefinition.protocol}/foo/$tags must NOT have additional properties`);

          // write a foo record with a `knownTag` tag.
          const validFooRecord = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            published    : true,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'foo',
            tags         : {
              knownTag: 'some-value'
            }
          });

          // should pass
          const validFooRecordReply = await dwn.processMessage(alice.did, validFooRecord.message, { dataStream: validFooRecord.dataStream });
          expect(validFooRecordReply.status.code).to.equal(202);
        });

        it('should reject a tag value that does not match the boolean type', async () => {
          const alice = await TestDataGenerator.generateDidKeyPersona();

          // protocol with a boolean type for a tag
          const protocolDefinition = {
            protocol  : 'http://example.com/protocol/withTags',
            published : true,
            types     : {
              foo: {}
            },
            structure: {
              foo: {
                $tags: {
                  draft: {
                    type: 'boolean'
                  }
                }
              }
            },
          };

          // configure tags protocol
          const protocolConfigure = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition
          });

          const configureReply = await dwn.processMessage(alice.did, protocolConfigure.message);
          expect(configureReply.status.code).to.equal(202);

          // `draft` should be a boolean type, but we are passing a string
          const fooRecord = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            published    : true,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'foo',
            tags         : {
              draft: 'true'
            }
          });

          const fooRecordReply = await dwn.processMessage(alice.did, fooRecord.message, { dataStream: fooRecord.dataStream });
          expect(fooRecordReply.status.code).to.equal(400);
          expect(fooRecordReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationTagsInvalidSchema);
          expect(fooRecordReply.status.detail).to.contain(`${protocolDefinition.protocol}/foo/$tags/draft must be boolean`);

          // positive test with a boolean
          const fooRecord2 = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            published    : true,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'foo',
            tags         : {
              draft: true
            }
          });

          const fooRecord2Reply = await dwn.processMessage(alice.did, fooRecord2.message, { dataStream: fooRecord2.dataStream });
          expect(fooRecord2Reply.status.code).to.equal(202);
        });

        it('should reject a record with a tag value that does not match a given enum in the protocol definition', async () => {
          const alice = await TestDataGenerator.generateDidKeyPersona();

          // protocol with an enum for a tag
          const protocolDefinition = {
            protocol  : 'http://example.com/protocol/withTags',
            published : true,
            types     : {
              foo: {}
            },
            structure: {
              foo: {
                $tags: {
                  status: {
                    type : 'string',
                    enum : [ 'draft', 'published', 'archived' ]
                  },
                }
              }
            },
          };

          // configure tags protocol
          const protocolConfigure = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition,
          });

          const configureReply = await dwn.processMessage(alice.did, protocolConfigure.message);
          expect(configureReply.status.code).to.equal(202);

          // write a foo record with an `unknown_status` tag value.
          const fooRecord = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            published    : true,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'foo',
            tags         : {
              status: 'unknown_status'
            }
          });

          const fooRecordReply = await dwn.processMessage(alice.did, fooRecord.message, { dataStream: fooRecord.dataStream });
          expect(fooRecordReply.status.code).to.equal(400);
          expect(fooRecordReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationTagsInvalidSchema);
          expect(fooRecordReply.status.detail).to
            .contain(`${protocolDefinition.protocol}/foo/$tags/status must be equal to one of the allowed values`);

          // ensure the correct tag descriptor path is in the error message
          expect(fooRecordReply.status.detail).to.contain(`${protocolDefinition.protocol}/foo/$tags/status`);

          // write a foo record with a valid `status` tag value.
          const validFooRecord = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            published    : true,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'foo',
            tags         : {
              status: 'draft'
            }
          });

          // should pass
          const validFooRecordReply = await dwn.processMessage(alice.did, validFooRecord.message, { dataStream: validFooRecord.dataStream });
          expect(validFooRecordReply.status.code).to.equal(202);
        });

        it('should reject a record with a tag value that is not within the `minimum` and `maximum` range', async () => {
          const alice = await TestDataGenerator.generateDidKeyPersona();

          // protocol with minimum and maximum for a number
          const protocolDefinition: ProtocolDefinition = {
            protocol  : 'http://example.com/protocol/withTags',
            published : true,
            types     : {
              foo: {}
            },
            structure: {
              foo: {
                $tags: {
                  score: {
                    type    : 'number',
                    minimum : 0,
                    maximum : 100
                  },
                }
              }
            },
          };

          // configure tags protocol
          const protocolConfigure = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition,
          });

          const configureReply = await dwn.processMessage(alice.did, protocolConfigure.message);
          expect(configureReply.status.code).to.equal(202);

          // write a foo record with an `score` value less than 0.
          const fooRecord = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            published    : true,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'foo',
            tags         : {
              score: -1,
            }
          });

          // should fail
          const fooRecordReply = await dwn.processMessage(alice.did, fooRecord.message, { dataStream: fooRecord.dataStream });
          expect(fooRecordReply.status.code).to.equal(400);
          expect(fooRecordReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationTagsInvalidSchema);
          expect(fooRecordReply.status.detail).to.contain(`${protocolDefinition.protocol}/foo/$tags/score must be >= 0`);

          // write a foo record with an `score` value greater than 100.
          const fooRecord2 = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            published    : true,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'foo',
            tags         : {
              score: 101,
            }
          });

          // should fail
          const fooRecord2Reply = await dwn.processMessage(alice.did, fooRecord2.message, { dataStream: fooRecord2.dataStream });
          expect(fooRecord2Reply.status.code).to.equal(400);
          expect(fooRecord2Reply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationTagsInvalidSchema);
          expect(fooRecord2Reply.status.detail).to.contain(`${protocolDefinition.protocol}/foo/$tags/score must be <= 100`);

          // write a foo record with a maximum `score` of 100.
          const validFooMaxRecord = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            published    : true,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'foo',
            tags         : {
              score: 100,
            }
          });

          // should pass
          const validFooMaxRecordReply = await dwn.processMessage(alice.did, validFooMaxRecord.message, { dataStream: validFooMaxRecord.dataStream });
          expect(validFooMaxRecordReply.status.code).to.equal(202);

          // write a foo record with a maximum `score` of 0.
          const validFooMinRecord = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            published    : true,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'foo',
            tags         : {
              score: 0,
            }
          });
          // should pass
          const validFooMinRecordReply = await dwn.processMessage(alice.did, validFooMinRecord.message, { dataStream: validFooMinRecord.dataStream });
          expect(validFooMinRecordReply.status.code).to.equal(202);

          // write a foo record within the range
          const validFooRecord = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            published    : true,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'foo',
            tags         : {
              score: 50,
            }
          });
          // should pass
          const validFooRecordReply = await dwn.processMessage(alice.did, validFooRecord.message, { dataStream: validFooRecord.dataStream });
          expect(validFooRecordReply.status.code).to.equal(202);
        });

        it('should reject a record with a tag value that is not within the `exclusiveMinimum` and `exclusiveMaximum` range', async () => {
          const alice = await TestDataGenerator.generateDidKeyPersona();

          // protocol with exclusiveMinimum and exclusiveMaximum for a number
          const protocolDefinition: ProtocolDefinition = {
            protocol  : 'http://example.com/protocol/withTags',
            published : true,
            types     : {
              foo: {}
            },
            structure: {
              foo: {
                $tags: {
                  hours: {
                    type             : 'number',
                    exclusiveMinimum : 0,
                    exclusiveMaximum : 24
                  },
                }
              }
            },
          };

          // configure tags protocol
          const protocolConfigure = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition,
          });

          const configureReply = await dwn.processMessage(alice.did, protocolConfigure.message);
          expect(configureReply.status.code).to.equal(202);

          // write a foo record with an hour at the exclusiveMaximum
          const exclusiveMaxRecord = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            published    : true,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'foo',
            tags         : {
              hours: 24,
            }
          });

          // should fail
          const exclusiveMaxReply = await dwn.processMessage(alice.did, exclusiveMaxRecord.message, { dataStream: exclusiveMaxRecord.dataStream });
          expect(exclusiveMaxReply.status.code).to.equal(400);
          expect(exclusiveMaxReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationTagsInvalidSchema);
          expect(exclusiveMaxReply.status.detail).to.contain(`${protocolDefinition.protocol}/foo/$tags/hours must be < 24`);

          // write a foo record with an hour at the exclusiveMinimum
          const exclusiveMinRecord = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            published    : true,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'foo',
            tags         : {
              hours: 0,
            }
          });

          // should fail
          const exclusiveMinReply = await dwn.processMessage(alice.did, exclusiveMinRecord.message, { dataStream: exclusiveMinRecord.dataStream });
          expect(exclusiveMinReply.status.code).to.equal(400);
          expect(exclusiveMinReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationTagsInvalidSchema);
          expect(exclusiveMinReply.status.detail).to.contain(`${protocolDefinition.protocol}/foo/$tags/hours must be > 0`);

          // write a foo record with an `hour` value within the range.
          const validFooRecord = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            published    : true,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'foo',
            tags         : {
              hours: 12,
            }
          });

          // should pass
          const validFooRecordReply = await dwn.processMessage(alice.did, validFooRecord.message, { dataStream: validFooRecord.dataStream });
          expect(validFooRecordReply.status.code).to.equal(202);
        });

        it('should reject tag values that are not within the `minLength` and `maxLength` values', async () => {
          const alice = await TestDataGenerator.generateDidKeyPersona();

          // protocol with minLength and maxLength for a string
          const protocolDefinition: ProtocolDefinition = {
            protocol  : 'http://example.com/protocol/withTags',
            published : true,
            types     : {
              foo: {}
            },
            structure: {
              foo: {
                $tags: {
                  stringWithLimit: {
                    type      : 'string',
                    maxLength : 10,
                    minLength : 5
                  },
                }
              }
            },
          };

          // configure tags protocol
          const protocolConfigure = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition,
          });

          const configureReply = await dwn.processMessage(alice.did, protocolConfigure.message);
          expect(configureReply.status.code).to.equal(202);


          // write a foo record with a `stringWithLimit` value less than the minimum length
          const minLengthRecord = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            published    : true,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'foo',
            tags         : {
              stringWithLimit: 'a', // less than 5
            }
          });

          // should fail
          const minLengthReply = await dwn.processMessage(alice.did, minLengthRecord.message, { dataStream: minLengthRecord.dataStream });
          expect(minLengthReply.status.code).to.equal(400);
          expect(minLengthReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationTagsInvalidSchema);
          expect(minLengthReply.status.detail).to
            .contain(`${protocolDefinition.protocol}/foo/$tags/stringWithLimit must NOT have fewer than 5 characters`);

          // write a foo record with a `stringWithLimit` value greater than the maximum length
          const maxLengthRecord = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            published    : true,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'foo',
            tags         : {
              stringWithLimit: 'abcdefghijklmnopqrstuvwxyz', //more than 10
            }
          });

          // should fail
          const maxLengthReply = await dwn.processMessage(alice.did, maxLengthRecord.message, { dataStream: maxLengthRecord.dataStream });
          expect(maxLengthReply.status.code).to.equal(400);
          expect(maxLengthReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationTagsInvalidSchema);
          expect(maxLengthReply.status.detail).to
            .contain(`${protocolDefinition.protocol}/foo/$tags/stringWithLimit must NOT have more than 10 characters`);

          // write a foo record with a `stringWithLimit` value within the range
          const validFooRecord = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            published    : true,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'foo',
            tags         : {
              stringWithLimit: 'abcdef', // more than 5 less than 10
            }
          });

          // should pass
          const validFooRecordReply = await dwn.processMessage(alice.did, validFooRecord.message, { dataStream: validFooRecord.dataStream });
          expect(validFooRecordReply.status.code).to.equal(202);
        });

        it('should reject tag values that do not contain the number of items within the `minItems` and `maxItems` values', async () => {
          const alice = await TestDataGenerator.generateDidKeyPersona();

          // protocol with minItems and maxItems for an array of numbers
          const protocolDefinition: ProtocolDefinition = {
            protocol  : 'http://example.com/protocol/withTags',
            published : true,
            types     : {
              foo: {}
            },
            structure: {
              foo: {
                $tags: {
                  numberArray: {
                    type     : 'array',
                    minItems : 2,
                    maxItems : 3,
                    items    : {
                      type: 'number',
                    }
                  },
                }
              }
            },
          };

          // configure tags protocol
          const protocolConfigure = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition,
          });

          const configureReply = await dwn.processMessage(alice.did, protocolConfigure.message);
          expect(configureReply.status.code).to.equal(202);


          // write a foo record with a `numberArray` value with only 1 item, less than the `minItems` specified of 2
          const minLengthRecord = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            published    : true,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'foo',
            tags         : {
              numberArray: [1] // less than 2
            }
          });

          // should fail
          const minLengthReply = await dwn.processMessage(alice.did, minLengthRecord.message, { dataStream: minLengthRecord.dataStream });
          expect(minLengthReply.status.code).to.equal(400);
          expect(minLengthReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationTagsInvalidSchema);
          expect(minLengthReply.status.detail).to.contain(`${protocolDefinition.protocol}/foo/$tags/numberArray must NOT have fewer than 2 items`);

          // write a foo record with a `numberArray` value with 4 items, more than the `maxItems` specified of 3
          const maxLengthRecord = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            published    : true,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'foo',
            tags         : {
              numberArray: [2,4,6,8] // more than 3
            }
          });

          // should fail
          const maxLengthReply = await dwn.processMessage(alice.did, maxLengthRecord.message, { dataStream: maxLengthRecord.dataStream });
          expect(maxLengthReply.status.code).to.equal(400);
          expect(maxLengthReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationTagsInvalidSchema);
          expect(maxLengthReply.status.detail).to.contain(`${protocolDefinition.protocol}/foo/$tags/numberArray must NOT have more than 3 items`);

          // write a foo record with a `numberArray` value with 3 items, within the range
          const validFooRecord = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            published    : true,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'foo',
            tags         : {
              numberArray: [2,3,4] // within the range
            }
          });

          // should pass
          const validFooRecordReply = await dwn.processMessage(alice.did, validFooRecord.message, { dataStream: validFooRecord.dataStream });
          expect(validFooRecordReply.status.code).to.equal(202);
        });

        it('should reject tag values that do not follow the constraints of the `uniqueItems` value', async () => {
          const alice = await TestDataGenerator.generateDidKeyPersona();

          // protocol with uniqueItems for an array of strings
          const protocolDefinition: ProtocolDefinition = {
            protocol  : 'http://example.com/protocol/withTags',
            published : true,
            types     : {
              foo: {}
            },
            structure: {
              foo: {
                $tags: {
                  uniqueStrings: {
                    type        : 'array',
                    uniqueItems : true,
                    items       : {
                      type: 'string',
                    }
                  },
                }
              }
            },
          };

          // configure tags protocol
          const protocolConfigure = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition,
          });

          const configureReply = await dwn.processMessage(alice.did, protocolConfigure.message);
          expect(configureReply.status.code).to.equal(202);

          // write a foo record with a `uniqueStrings` value with duplicate items
          const duplicateItemsRecord = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            published    : true,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'foo',
            tags         : {
              uniqueStrings: ['a', 'a'] // duplicate items
            }
          });

          // should fail
          const duplicateItemsReply =
            await dwn.processMessage(alice.did, duplicateItemsRecord.message, { dataStream: duplicateItemsRecord.dataStream });
          expect(duplicateItemsReply.status.code).to.equal(400);

          // write a foo record with a `uniqueStrings` value with unique items
          const uniqueItemsRecord = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            published    : true,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'foo',
            tags         : {
              uniqueStrings: ['a', 'b'] // unique items
            }
          });

          // should pass
          const uniqueItemsReply = await dwn.processMessage(alice.did, uniqueItemsRecord.message, { dataStream: uniqueItemsRecord.dataStream });
          expect(uniqueItemsReply.status.code).to.equal(202);
        });

        it('should reject if tags contain requiredTags but not provided', async () => {
          const alice = await TestDataGenerator.generateDidKeyPersona();

          // protocol with a required tag
          const protocolDefinition: ProtocolDefinition = {
            protocol  : 'http://example.com/protocol/withTags',
            published : true,
            types     : {
              foo: {}
            },
            structure: {
              foo: {
                $tags: {
                  requiredTags    : [ 'someRequiredTag' ],
                  someRequiredTag : {
                    type: 'string',
                  },
                }
              }
            },
          };

          // configure tags protocol
          const protocolConfigure = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition,
          });

          const configureReply = await dwn.processMessage(alice.did, protocolConfigure.message);
          expect(configureReply.status.code).to.equal(202);

          // write a foo record without the required tag
          const fooRecord = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            published    : true,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'foo',
          });

          const fooRecordReply = await dwn.processMessage(alice.did, fooRecord.message, { dataStream: fooRecord.dataStream });
          expect(fooRecordReply.status.code).to.equal(400);
          expect(fooRecordReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationTagsInvalidSchema);
          expect(fooRecordReply.status.detail).to.contain(`${protocolDefinition.protocol}/foo/$tags must have required property 'someRequiredTag'`);

          // write a foo record with the required tag
          const validFooRecord = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            published    : true,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'foo',
            tags         : {
              someRequiredTag: 'some-value'
            }
          });

          // should pass
          const validFooRecordReply = await dwn.processMessage(alice.did, validFooRecord.message, { dataStream: validFooRecord.dataStream });
          expect(validFooRecordReply.status.code).to.equal(202);
        });

        it('should accept any tag if allowUndefinedTags is set to true', async () => {
          const alice = await TestDataGenerator.generateDidKeyPersona();

          // protocol with no required tags
          const protocolDefinition: ProtocolDefinition = {
            protocol  : 'http://example.com/protocol/withTags',
            published : true,
            types     : {
              foo: {}
            },
            structure: {
              foo: {
                $tags: {
                  allowUndefinedTags : true,
                  optionalTag        : {
                    type: 'string',
                  },
                }
              }
            },
          };

          // configure tags protocol
          const protocolConfigure = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition,
          });

          const configureReply = await dwn.processMessage(alice.did, protocolConfigure.message);
          expect(configureReply.status.code).to.equal(202);

          // write a foo record without the required tag
          const fooRecord = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            published    : true,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'foo',
            tags         : {
              randomTag: 'some-value'
            }
          });

          const fooRecordReply = await dwn.processMessage(alice.did, fooRecord.message, { dataStream: fooRecord.dataStream });
          expect(fooRecordReply.status.code).to.equal(202);
        });

        xit('should reject a record with a tag value does not conform to `contains`, `minContains` and `maxContains`', async () => {
          const alice = await TestDataGenerator.generateDidKeyPersona();

          // protocol with minContains and maxContains for an array of numbers
          const protocolDefinition: ProtocolDefinition = {
            protocol  : 'http://example.com/protocol/withTags',
            published : true,
            types     : {
              foo: {}
            },
            structure: {
              foo: {
                $tags: {
                  containsNumbers: {
                    type  : 'array',
                    items : {
                      type: 'number'
                    },
                    contains: {
                      type    : 'number',
                      minimum : 80,
                      maximum : 100
                    },
                    minContains : 2,
                    maxContains : 3,
                  },
                }
              }
            },
          };

          // configure tags protocol
          const protocolConfigure = await TestDataGenerator.generateProtocolsConfigure({
            author: alice,
            protocolDefinition,
          });

          const configureReply = await dwn.processMessage(alice.did, protocolConfigure.message);
          expect(configureReply.status.code).to.equal(202);

          // write a foo record with a `containsNumbers` value that does not have the minimum number of items
          const minContainsRecord = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            published    : true,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'foo',
            tags         : {
              containsNumbers: [90] // less than 2
            }
          });

          // should fail
          const minContainsReply = await dwn.processMessage(alice.did, minContainsRecord.message, { dataStream: minContainsRecord.dataStream });
          expect(minContainsReply.status.code).to.equal(400);


          // write a foo record with a `containsNumbers` value that has more than the maximum number of items
          const maxContainsRecord = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            published    : true,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'foo',
            tags         : {
              containsNumbers: [90, 95, 99, 100] // more than 3
            }
          });

          // should fail
          const maxContainsReply = await dwn.processMessage(alice.did, maxContainsRecord.message, { dataStream: maxContainsRecord.dataStream });
          expect(maxContainsReply.status.code).to.equal(400);

          // write a foo record with a `containsNumbers` value that does not have the minimum number of items
          const validFooRecord = await TestDataGenerator.generateRecordsWrite({
            author       : alice,
            published    : true,
            protocol     : protocolDefinition.protocol,
            protocolPath : 'foo',
            tags         : {
              containsNumbers: [90, 95] // within the range
            }
          });

          // should pass
          const validFooRecordReply = await dwn.processMessage(alice.did, validFooRecord.message, { dataStream: validFooRecord.dataStream });
          expect(validFooRecordReply.status.code).to.equal(202);
        });
      });

      it('should be able to write a Record tags', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();

        // create tags that represent `string[]`, `number[]`, `string`, `number`, or `boolean` values.
        const stringTag = 'string-value';
        const stringArrayTag = [ 'string-value', 'string-value2' ];
        const numberTag = 54566975;
        const numberArrayTag = [ 0, 1 ,2 ];
        const booleanTag = false;

        const tagsRecord1 = await TestDataGenerator.generateRecordsWrite({
          author    : alice,
          published : true,
          schema    : 'post',
          tags      : {
            stringTag,
            numberTag,
            booleanTag,
            stringArrayTag,
            numberArrayTag,
          }
        });

        const tagsRecord1Reply = await dwn.processMessage(alice.did, tagsRecord1.message, { dataStream: tagsRecord1.dataStream });
        expect(tagsRecord1Reply.status.code).to.equal(202);

        // verify the record was written
        const tagsRecord1Read = await RecordsRead.create({
          filter: {
            recordId: tagsRecord1.message.recordId,
          },
          signer: Jws.createSigner(alice)
        });

        const tagsRecord1ReadReply = await dwn.processMessage(alice.did, tagsRecord1Read.message);
        expect(tagsRecord1ReadReply.status.code).to.equal(200);
        expect(tagsRecord1ReadReply.record).to.not.be.undefined;
        expect(tagsRecord1ReadReply.record!.descriptor.tags).to.deep.equal({ stringTag, numberTag, booleanTag, stringArrayTag, numberArrayTag });
      });

      it('should overwrite tags when updating a Record', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();

        const tagsRecord1 = await TestDataGenerator.generateRecordsWrite({
          author    : alice,
          published : true,
          schema    : 'post',
          tags      : {
            stringTag      : 'string-value',
            numberTag      : 54566975,
            booleanTag     : false,
            stringArrayTag : [ 'string-value', 'string-value2' ],
            numberArrayTag : [ 0, 1 ,2 ],
          }
        });

        // write the record
        const tagsRecord1Reply = await dwn.processMessage(alice.did, tagsRecord1.message, { dataStream: tagsRecord1.dataStream });
        expect(tagsRecord1Reply.status.code).to.equal(202);

        // verify the record was written
        const tagsRecord1Read = await RecordsRead.create({
          filter: {
            recordId: tagsRecord1.message.recordId,
          },
          signer: Jws.createSigner(alice)
        });

        const tagsRecord1ReadReply = await dwn.processMessage(alice.did, tagsRecord1Read.message);
        expect(tagsRecord1ReadReply.status.code).to.equal(200);
        expect(tagsRecord1ReadReply.record).to.not.be.undefined;
        expect(tagsRecord1ReadReply.record!.descriptor.tags).to.deep.equal({
          stringTag      : 'string-value',
          numberTag      : 54566975,
          booleanTag     : false,
          stringArrayTag : [ 'string-value', 'string-value2' ],
          numberArrayTag : [ 0, 1 ,2 ],
        });

        // update the record with new tags
        const updatedRecord = await TestDataGenerator.generateFromRecordsWrite({
          author        : alice,
          existingWrite : tagsRecord1.recordsWrite,
          tags          : { newTag: 'new-value' }
        });
        const updatedRecordReply = await dwn.processMessage(alice.did, updatedRecord.message, { dataStream: updatedRecord.dataStream });
        expect(updatedRecordReply.status.code).to.equal(202, updatedRecordReply.status.detail);

        const updatedRecordReadReply = await dwn.processMessage(alice.did, tagsRecord1Read.message);
        expect(updatedRecordReadReply.status.code).to.equal(200);
        expect(updatedRecordReadReply.record).to.not.be.undefined;
        expect(updatedRecordReadReply.record!.descriptor.tags).to.deep.equal({ newTag: 'new-value' });
      });
    });

    describe('RecordsQuery filter for tags', () => {
      it('should be able to filter by string match', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const stringTag = 'string-value';

        const tagsRecord1 = await TestDataGenerator.generateRecordsWrite({
          author    : alice,
          published : true,
          schema    : 'post',
          tags      : {
            stringTag,
          }
        });

        const tagsRecord1Reply = await dwn.processMessage(alice.did, tagsRecord1.message, { dataStream: tagsRecord1.dataStream });
        expect(tagsRecord1Reply.status.code).to.equal(202);

        const tagsQueryMatch = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            tags: {
              stringTag: 'string-value'
            }
          }
        });

        const tagsQueryMatchReply = await dwn.processMessage(alice.did, tagsQueryMatch.message);
        expect(tagsQueryMatchReply.status.code).to.equal(200);
        expect(tagsQueryMatchReply.entries?.length).to.equal(1);
        expect(tagsQueryMatchReply.entries![0].recordId).to.equal(tagsRecord1.message.recordId);

        // negative result same tag different value
        let tagsQueryNegative = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            tags: {
              stringTag: 'other-value'
            }
          }
        });
        let tagsQueryNegativeReply = await dwn.processMessage(alice.did, tagsQueryNegative.message);
        expect(tagsQueryNegativeReply.status.code).to.equal(200);
        expect(tagsQueryNegativeReply.entries?.length).to.equal(0);

        // negative result different tag same value
        tagsQueryNegative = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            tags: {
              otherTag: 'string-value'
            }
          }
        });
        tagsQueryNegativeReply = await dwn.processMessage(alice.did, tagsQueryNegative.message);
        expect(tagsQueryNegativeReply.status.code).to.equal(200);
        expect(tagsQueryNegativeReply.entries?.length).to.equal(0);
      });

      it('should be able to filter by number match', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const numberTag = 54566975;

        // write a record with a numerical value tag
        const tagsRecord1 = await TestDataGenerator.generateRecordsWrite({
          author    : alice,
          published : true,
          schema    : 'post',
          tags      : {
            numberTag,
          }
        });

        const tagsRecord1Reply = await dwn.processMessage(alice.did, tagsRecord1.message, { dataStream: tagsRecord1.dataStream });
        expect(tagsRecord1Reply.status.code).to.equal(202);

        // do an exact match for the tag value
        const tagsQueryMatch = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            tags: {
              numberTag: 54566975,
            }
          }
        });

        const tagsQueryMatchReply = await dwn.processMessage(alice.did, tagsQueryMatch.message);
        expect(tagsQueryMatchReply.status.code).to.equal(200);
        expect(tagsQueryMatchReply.entries?.length).to.equal(1);
        expect(tagsQueryMatchReply.entries![0].recordId).to.equal(tagsRecord1.message.recordId);

        // negative result same tag different value
        let tagsQueryNegative = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            tags: {
              numberTag: 54566974, // off by one
            }
          }
        });
        let tagsQueryNegativeReply = await dwn.processMessage(alice.did, tagsQueryNegative.message);
        expect(tagsQueryNegativeReply.status.code).to.equal(200);
        expect(tagsQueryNegativeReply.entries?.length).to.equal(0);

        // negative result different tag same value
        tagsQueryNegative = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            tags: {
              otherTag: 54566975,
            }
          }
        });
        tagsQueryNegativeReply = await dwn.processMessage(alice.did, tagsQueryNegative.message);
        expect(tagsQueryNegativeReply.status.code).to.equal(200);
        expect(tagsQueryNegativeReply.entries?.length).to.equal(0);
      });

      it('should be able to filter by boolean match', async () => {
        // 1. Write a record with a boolean tag `booleanTag` set to true
        // 2. Write a record with a boolean tag `booleanTag` set to false.
        // 3. Query for records with a `booleanTag` set to true, and validate the result.
        // 4. Query for records with a `booleanTag` set to false, and validate the result.
        // 5. Query for records with a non existent boolean tag, should not return a result.

        const alice = await TestDataGenerator.generateDidKeyPersona();

        // write a record with a true boolean value tag
        const tagsRecordTrue = await TestDataGenerator.generateRecordsWrite({
          author    : alice,
          published : true,
          schema    : 'post',
          tags      : {
            booleanTag: true,
          }
        });

        const tagsRecordTrueReply = await dwn.processMessage(alice.did, tagsRecordTrue.message, { dataStream: tagsRecordTrue.dataStream });
        expect(tagsRecordTrueReply.status.code).to.equal(202);

        // write a record with a false boolean value tag
        const tagsRecordFalse = await TestDataGenerator.generateRecordsWrite({
          author    : alice,
          published : true,
          schema    : 'post',
          tags      : {
            booleanTag: false,
          }
        });

        const tagsRecordFalseReply = await dwn.processMessage(alice.did, tagsRecordFalse.message, { dataStream: tagsRecordFalse.dataStream });
        expect(tagsRecordFalseReply.status.code).to.equal(202);

        // query for records with a `booleanTag` set to true, should return the record with the true tag
        const tagsQueryMatchTrue = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            tags: {
              booleanTag: true
            }
          }
        });

        const tagsQueryMatchTrueReply = await dwn.processMessage(alice.did, tagsQueryMatchTrue.message);
        expect(tagsQueryMatchTrueReply.status.code).to.equal(200);
        expect(tagsQueryMatchTrueReply.entries?.length).to.equal(1);
        expect(tagsQueryMatchTrueReply.entries![0].recordId).to.equal(tagsRecordTrue.message.recordId);

        // query for records with a `booleanTag` set to false, should return the record with the false tag
        const tagsQueryMatchFalse = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            tags: {
              booleanTag: false
            }
          }
        });

        const tagsQueryMatchFalseReply = await dwn.processMessage(alice.did, tagsQueryMatchFalse.message);
        expect(tagsQueryMatchFalseReply.status.code).to.equal(200);
        expect(tagsQueryMatchFalseReply.entries?.length).to.equal(1);
        expect(tagsQueryMatchFalseReply.entries![0].recordId).to.equal(tagsRecordFalse.message.recordId);

        // negative result for a non existent boolean tag.
        const tagsQueryNegative = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            tags: {
              otherTag: true,
            }
          }
        });
        const tagsQueryNegativeReply = await dwn.processMessage(alice.did, tagsQueryNegative.message);
        expect(tagsQueryNegativeReply.status.code).to.equal(200);
        expect(tagsQueryNegativeReply.entries?.length).to.equal(0);
      });

      it('should be able to range filter by string value', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();

        // create four records with different first names
        const aliceRecord = await TestDataGenerator.generateRecordsWrite({
          author    : alice,
          published : true,
          schema    : 'post',
          tags      : {
            firstName: 'alice'
          }
        });

        const bobRecord = await TestDataGenerator.generateRecordsWrite({
          author    : alice,
          published : true,
          schema    : 'post',
          tags      : {
            firstName: 'bob',
          }
        });

        const carolRecord = await TestDataGenerator.generateRecordsWrite({
          author    : alice,
          published : true,
          schema    : 'post',
          tags      : {
            firstName: 'carol',
          }
        });

        const danielRecord = await TestDataGenerator.generateRecordsWrite({
          author    : alice,
          published : true,
          schema    : 'post',
          tags      : {
            firstName: 'daniel',
          }
        });

        const aliceReply = await dwn.processMessage(alice.did, aliceRecord.message, { dataStream: aliceRecord.dataStream });
        expect(aliceReply.status.code).to.equal(202);
        const bobReply = await dwn.processMessage(alice.did, bobRecord.message, { dataStream: bobRecord.dataStream });
        expect(bobReply.status.code).to.equal(202);
        const carolReply = await dwn.processMessage(alice.did, carolRecord.message, { dataStream: carolRecord.dataStream });
        expect(carolReply.status.code).to.equal(202);
        const danielReply = await dwn.processMessage(alice.did, danielRecord.message, { dataStream: danielRecord.dataStream });
        expect(danielReply.status.code).to.equal(202);

        // sanity query for all
        const queryForAll = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            schema: 'post'
          }
        });
        const queryForAllReply = await dwn.processMessage(alice.did, queryForAll.message);
        expect(queryForAllReply.status.code).to.equal(200);
        expect(queryForAllReply.entries?.length).to.equal(4); // all 4 records


        // query for first names that begin with 'a' and 'b'
        const queryForAtoB = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            schema : 'post',
            tags   : {
              firstName: { gte: 'a', lt: 'c' }
            }
          }
        });
        const queryForAtoBReply = await dwn.processMessage(alice.did, queryForAtoB.message);
        expect(queryForAtoBReply.status.code).to.equal(200);
        expect(queryForAtoBReply.entries?.length).to.equal(2);
        const atobRecordIds = queryForAtoBReply.entries!.map(entry => entry.recordId);
        expect(atobRecordIds).to.have.members([ aliceRecord.message.recordId, bobRecord.message.recordId ]);

        // query for first names greater than 'bob'(exclusive of), and less than but inclusive of 'daniel'
        const queryForBtoD = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            schema : 'post',
            tags   : {
              firstName: { gt: 'bob', lte: 'daniel' }
            }
          }
        });
        const queryForBtoDReply = await dwn.processMessage(alice.did, queryForBtoD.message);
        expect(queryForBtoDReply.status.code).to.equal(200);
        expect(queryForBtoDReply.entries?.length).to.equal(2);
        const btodRecordIds = queryForBtoDReply.entries!.map(entry => entry.recordId);
        expect(btodRecordIds).to.have.members([ carolRecord.message.recordId, danielRecord.message.recordId ]);

        // query for first names that begin with 'carol' onward (inclusive).
        const queryForCarolOnward = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            schema : 'post',
            tags   : {
              firstName: { gte: 'carol' }
            }
          }
        });
        const queryForCarolOnwardReply = await dwn.processMessage(alice.did, queryForCarolOnward.message);
        expect(queryForCarolOnwardReply.status.code).to.equal(200);
        expect(queryForCarolOnwardReply.entries?.length).to.equal(2);
        const onwardResults = queryForCarolOnwardReply.entries!.map(entry => entry.recordId);
        expect(onwardResults).to.have.members([ carolRecord.message.recordId, danielRecord.message.recordId ]);
      });

      it('should be able to filter by string prefix', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();

        // create two records that match the prefix 'string-'
        const tagsRecord1 = await TestDataGenerator.generateRecordsWrite({
          author    : alice,
          published : true,
          schema    : 'post',
          tags      : {
            stringTag: 'string-foo',
          }
        });

        const tagsRecord2 = await TestDataGenerator.generateRecordsWrite({
          author    : alice,
          published : true,
          schema    : 'post',
          tags      : {
            stringTag: 'string-bar',
          }
        });

        const tagsRecord1Reply = await dwn.processMessage(alice.did, tagsRecord1.message, { dataStream: tagsRecord1.dataStream });
        expect(tagsRecord1Reply.status.code).to.equal(202);
        const tagsRecord2Reply = await dwn.processMessage(alice.did, tagsRecord2.message, { dataStream: tagsRecord2.dataStream });
        expect(tagsRecord2Reply.status.code).to.equal(202);

        // control record that has a different prefix
        const tagsRecord3 = await TestDataGenerator.generateRecordsWrite({
          author    : alice,
          published : true,
          schema    : 'post',
          tags      : {
            stringTag: 'zaz-string', // comes after `string-` lexicographically
          }
        });
        const tagsRecord3Reply = await dwn.processMessage(alice.did, tagsRecord3.message, { dataStream: tagsRecord3.dataStream });
        expect(tagsRecord3Reply.status.code).to.equal(202);

        // a prefix search will return only the records matching the prefix
        const tagsQueryMatch = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            tags: {
              stringTag: { startsWith: 'string-' }
            }
          }
        });

        const tagsQueryMatchReply = await dwn.processMessage(alice.did, tagsQueryMatch.message);
        expect(tagsQueryMatchReply.status.code).to.equal(200);
        expect(tagsQueryMatchReply.entries?.length).to.equal(2);
        const matchedRecords = tagsQueryMatchReply.entries!.map(entry => entry.recordId);
        expect(matchedRecords).to.have.members([ tagsRecord1.message.recordId, tagsRecord2.message.recordId ]);

        // sanity/control: a regular range query will return all
        // since `zaz-string` comes lexicographically after `string-` it will appear in the result set
        const tagsQueryRange = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            tags: {
              stringTag: { gte: 'string-' } // range query instead of prefix
            }
          }
        });

        const tagsQueryRangeReply = await dwn.processMessage(alice.did, tagsQueryRange.message);
        expect(tagsQueryRangeReply.status.code).to.equal(200);
        expect(tagsQueryRangeReply.entries?.length).to.equal(3); // returned all 3 records
      });

      it('should be able to range filter by number value', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();

        // create four records with different test scores
        const aliceRecord = await TestDataGenerator.generateRecordsWrite({
          author    : alice,
          published : true,
          schema    : 'test',
          tags      : {
            firstName : 'alice',
            score     : 75,
          }
        });

        const bobRecord = await TestDataGenerator.generateRecordsWrite({
          author    : alice,
          published : true,
          schema    : 'test',
          tags      : {
            firstName : 'bob',
            score     : 80,
          }
        });

        const carolRecord = await TestDataGenerator.generateRecordsWrite({
          author    : alice,
          published : true,
          schema    : 'test',
          tags      : {
            firstName : 'carol',
            score     : 65,
          }
        });

        const danielRecord = await TestDataGenerator.generateRecordsWrite({
          author    : alice,
          published : true,
          schema    : 'test',
          tags      : {
            firstName : 'daniel',
            score     : 100,
          }
        });

        const aliceReply = await dwn.processMessage(alice.did, aliceRecord.message, { dataStream: aliceRecord.dataStream });
        expect(aliceReply.status.code).to.equal(202);
        const bobReply = await dwn.processMessage(alice.did, bobRecord.message, { dataStream: bobRecord.dataStream });
        expect(bobReply.status.code).to.equal(202);
        const carolReply = await dwn.processMessage(alice.did, carolRecord.message, { dataStream: carolRecord.dataStream });
        expect(carolReply.status.code).to.equal(202);
        const danielReply = await dwn.processMessage(alice.did, danielRecord.message, { dataStream: danielRecord.dataStream });
        expect(danielReply.status.code).to.equal(202);

        // sanity query for all
        const queryForAll = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            schema: 'test'
          }
        });
        const queryForAllReply = await dwn.processMessage(alice.did, queryForAll.message);
        expect(queryForAllReply.status.code).to.equal(200);
        expect(queryForAllReply.entries?.length).to.equal(4); // all 4 records


        // query for all records that received higher than(not including) an 80
        // only one record should match
        const queryForHighGrade = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            schema : 'test',
            tags   : {
              score: { gt: 80 }
            }
          }
        });
        const queryForHighReply = await dwn.processMessage(alice.did, queryForHighGrade.message);
        expect(queryForHighReply.status.code).to.equal(200);
        expect(queryForHighReply.entries?.length).to.equal(1);
        expect(queryForHighReply.entries![0].recordId).to.equal(danielRecord.message.recordId);

        // query for all records that received higher (and including) a 75
        // three records should match
        const queryForPassingGrade = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            schema : 'test',
            tags   : {
              score: { gte: 75 }
            }
          }
        });
        const queryForPassingGradeReply = await dwn.processMessage(alice.did, queryForPassingGrade.message);
        expect(queryForPassingGradeReply.status.code).to.equal(200);
        expect(queryForPassingGradeReply.entries?.length).to.equal(3);
        const passingRecords = queryForPassingGradeReply.entries!.map(entry => entry.recordId);
        expect(passingRecords).to.have.members([ danielRecord.message.recordId, bobRecord.message.recordId, aliceRecord.message.recordId ]);

        // query for poorly performing grades (65 and below, inclusive)
        const queryForPoorGrades = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            schema : 'test',
            tags   : {
              score: { lte: 65 }
            }
          }
        });
        const queryForPoorGradesReply = await dwn.processMessage(alice.did, queryForPoorGrades.message);
        expect(queryForPoorGradesReply.status.code).to.equal(200);
        expect(queryForPoorGradesReply.entries?.length).to.equal(1);
        expect(queryForPoorGradesReply.entries![0].recordId).to.equal(carolRecord.message.recordId);

        // query for passing grades that were not perfect scores
        const queryForRange = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            schema : 'test',
            tags   : {
              score: { lt: 100, gte: 75 }
            }
          }
        });
        const queryForRangeReply = await dwn.processMessage(alice.did, queryForRange.message);
        expect(queryForRangeReply.status.code).to.equal(200);
        expect(queryForRangeReply.entries?.length).to.equal(2);
        const rangeRecords = queryForRangeReply.entries!.map(entry => entry.recordId);
        expect(rangeRecords).to.have.members([ bobRecord.message.recordId, aliceRecord.message.recordId ]);
      });

      it('should return results based on the latest tag values', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();

        const tagsRecord1 = await TestDataGenerator.generateRecordsWrite({
          author    : alice,
          published : true,
          schema    : 'post',
          tags      : {
            stringTag: 'string-value',
          }
        });

        const tagsRecord1Reply = await dwn.processMessage(alice.did, tagsRecord1.message, { dataStream: tagsRecord1.dataStream });
        expect(tagsRecord1Reply.status.code).to.equal(202);

        const tagsQueryMatch = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            tags: {
              stringTag: 'string-value'
            }
          }
        });

        const tagsQueryMatchReply = await dwn.processMessage(alice.did, tagsQueryMatch.message);
        expect(tagsQueryMatchReply.status.code).to.equal(200);
        expect(tagsQueryMatchReply.entries?.length).to.equal(1);
        expect(tagsQueryMatchReply.entries![0].recordId).to.equal(tagsRecord1.message.recordId);


        // update the record with new tags
        const updatedRecord = await TestDataGenerator.generateFromRecordsWrite({
          author        : alice,
          existingWrite : tagsRecord1.recordsWrite,
          tags          : { otherTag: 'other-value' } // new tags
        });
        const updatedRecordReply = await dwn.processMessage(alice.did, updatedRecord.message, { dataStream: updatedRecord.dataStream });
        expect(updatedRecordReply.status.code).to.equal(202);

        // issuing the same query should return no results
        const tagsQueryMatchReply2 = await dwn.processMessage(alice.did, tagsQueryMatch.message);
        expect(tagsQueryMatchReply2.status.code).to.equal(200);
        expect(tagsQueryMatchReply2.entries?.length).to.equal(0);
      });

      it('should not return results if the record was updated with empty tags', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();

        const tagsRecord1 = await TestDataGenerator.generateRecordsWrite({
          author    : alice,
          published : true,
          schema    : 'post',
          tags      : {
            stringTag: 'string-value',
          }
        });

        const tagsRecord1Reply = await dwn.processMessage(alice.did, tagsRecord1.message, { dataStream: tagsRecord1.dataStream });
        expect(tagsRecord1Reply.status.code).to.equal(202);

        const tagsQueryMatch = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            tags: {
              stringTag: 'string-value'
            }
          }
        });

        const tagsQueryMatchReply = await dwn.processMessage(alice.did, tagsQueryMatch.message);
        expect(tagsQueryMatchReply.status.code).to.equal(200);
        expect(tagsQueryMatchReply.entries?.length).to.equal(1);
        expect(tagsQueryMatchReply.entries![0].recordId).to.equal(tagsRecord1.message.recordId);


        // update the record without any tags
        const updatedRecord = await TestDataGenerator.generateFromRecordsWrite({
          author        : alice,
          existingWrite : tagsRecord1.recordsWrite,
        });
        const updatedRecordReply = await dwn.processMessage(alice.did, updatedRecord.message, { dataStream: updatedRecord.dataStream });
        expect(updatedRecordReply.status.code).to.equal(202);

        // issuing the same query should return no results
        const tagsQueryMatchReply2 = await dwn.processMessage(alice.did, tagsQueryMatch.message);
        expect(tagsQueryMatchReply2.status.code).to.equal(200);
        expect(tagsQueryMatchReply2.entries?.length).to.equal(0);
      });
    });

    describe('RecordsDelete with tags', () => {
      it('should delete record with tags', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();

        // create a record with a tag
        const tagsRecord1 = await TestDataGenerator.generateRecordsWrite({
          author    : alice,
          published : true,
          schema    : 'post',
          tags      : {
            stringTag: 'string-value',
          }
        });

        const tagsRecord1Reply = await dwn.processMessage(alice.did, tagsRecord1.message, { dataStream: tagsRecord1.dataStream });
        expect(tagsRecord1Reply.status.code).to.equal(202);

        //sanity: query for the record
        const tagsQueryMatch = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            tags: {
              stringTag: 'string-value'
            }
          }
        });

        const tagsQueryMatchReply = await dwn.processMessage(alice.did, tagsQueryMatch.message);
        expect(tagsQueryMatchReply.status.code).to.equal(200);
        expect(tagsQueryMatchReply.entries?.length).to.equal(1);
        expect(tagsQueryMatchReply.entries![0].recordId).to.equal(tagsRecord1.message.recordId);


        // delete the record
        const recordDelete = await TestDataGenerator.generateRecordsDelete({
          author   : alice,
          recordId : tagsRecord1.message.recordId,
        });
        const recordDeleteReply = await dwn.processMessage(alice.did, recordDelete.message);
        expect(recordDeleteReply.status.code).to.equal(202);

        // issue the the same query should return no results
        const tagsQueryMatchReply2 = await dwn.processMessage(alice.did, tagsQueryMatch.message);
        expect(tagsQueryMatchReply2.status.code).to.equal(200);
        expect(tagsQueryMatchReply2.entries?.length).to.equal(0);
      });
    });

    describe('RecordsDelete with tags', () => {
      it('should delete record with tags', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();

        // create a record with a tag
        const tagsRecord1 = await TestDataGenerator.generateRecordsWrite({
          author    : alice,
          published : true,
          schema    : 'post',
          tags      : {
            stringTag: 'string-value',
          }
        });

        const tagsRecord1Reply = await dwn.processMessage(alice.did, tagsRecord1.message, { dataStream: tagsRecord1.dataStream });
        expect(tagsRecord1Reply.status.code).to.equal(202);

        //sanity: query for the record
        const tagsQueryMatch = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            tags: {
              stringTag: 'string-value'
            }
          }
        });

        const tagsQueryMatchReply = await dwn.processMessage(alice.did, tagsQueryMatch.message);
        expect(tagsQueryMatchReply.status.code).to.equal(200);
        expect(tagsQueryMatchReply.entries?.length).to.equal(1);
        expect(tagsQueryMatchReply.entries![0].recordId).to.equal(tagsRecord1.message.recordId);


        // delete the record
        const recordDelete = await TestDataGenerator.generateRecordsDelete({
          author   : alice,
          recordId : tagsRecord1.message.recordId,
        });
        const recordDeleteReply = await dwn.processMessage(alice.did, recordDelete.message);
        expect(recordDeleteReply.status.code).to.equal(202);

        // issue the the same query should return no results
        const tagsQueryMatchReply2 = await dwn.processMessage(alice.did, tagsQueryMatch.message);
        expect(tagsQueryMatchReply2.status.code).to.equal(200);
        expect(tagsQueryMatchReply2.entries?.length).to.equal(0);
      });
    });
  });
}