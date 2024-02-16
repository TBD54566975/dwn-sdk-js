import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

import type { ProtocolsConfigureDescriptor, ProtocolsConfigureMessage } from '../../src/index.js';

import dexProtocolDefinition from '../vectors/protocol-definitions/dex.json' assert { type: 'json' };
import { Jws } from '../../src/utils/jws.js';
import { ProtocolsConfigure } from '../../src/interfaces/protocols-configure.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { Time } from '../../src/utils/time.js';
import { DwnErrorCode, DwnInterfaceName, DwnMethodName, Message } from '../../src/index.js';

chai.use(chaiAsPromised);

describe('ProtocolsConfigure', () => {
  describe('parse()', () => {
    it('should throw if protocol definitions has record nesting more than 10 level deep', async () => {
      const definition = {
        published : true,
        protocol  : 'http://example.com',
        types     : {
          foo: {},
        },
        structure: { }
      };

      // create a record hierarchy with 11 levels of nesting
      let currentLevel: any = definition.structure;
      for (let i = 0; i < 11; i++) {
        currentLevel.foo = { };
        currentLevel = currentLevel.foo;
      }

      // we need to manually created an invalid protocol definition,
      // because the SDK `create()` method will not allow us to create an invalid definition
      const descriptor: ProtocolsConfigureDescriptor = {
        interface        : DwnInterfaceName.Protocols,
        method           : DwnMethodName.Configure,
        messageTimestamp : Time.getCurrentTimestamp(),
        definition
      };

      const alice = await TestDataGenerator.generatePersona();
      const authorization = await Message.createAuthorization({
        descriptor,
        signer: Jws.createSigner(alice)
      });
      const message = { descriptor, authorization };

      const parsePromise = ProtocolsConfigure.parse(message);
      await expect(parsePromise).to.be.rejectedWith(DwnErrorCode.ProtocolsConfigureRecordNestingDepthExceeded);
    });
  });

  describe('create()', () => {
    it('should use `messageTimestamp` as is if given', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const currentTime = Time.getCurrentTimestamp();
      const definition = { ...dexProtocolDefinition };
      const protocolsConfigure = await ProtocolsConfigure.create({
        messageTimestamp : currentTime,
        definition,
        signer           : Jws.createSigner(alice),
      });

      expect(protocolsConfigure.message.descriptor.messageTimestamp).to.equal(currentTime);
    });

    it('should auto-normalize protocol URI', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const definition = { ...dexProtocolDefinition, protocol: 'example.com/' };
      const options = {
        recipient  : alice.did,
        data       : TestDataGenerator.randomBytes(10),
        dataFormat : 'application/json',
        signer     : Jws.createSigner(alice),
        definition,
      };
      const protocolsConfig = await ProtocolsConfigure.create(options);

      const message = protocolsConfig.message as ProtocolsConfigureMessage;

      expect(message.descriptor.definition.protocol).to.eq('http://example.com');
    });

    it('should auto-normalize schema URIs', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const nonNormalizedDexProtocol = { ...dexProtocolDefinition };
      nonNormalizedDexProtocol.types.ask.schema = 'ask';

      const options = {
        recipient  : alice.did,
        data       : TestDataGenerator.randomBytes(10),
        dataFormat : 'application/json',
        signer     : Jws.createSigner(alice),
        protocol   : 'example.com/',
        definition : nonNormalizedDexProtocol
      };
      const protocolsConfig = await ProtocolsConfigure.create(options);

      const message = protocolsConfig.message as ProtocolsConfigureMessage;
      expect(message.descriptor.definition.types.ask.schema).to.eq('http://ask');
    });

    describe('protocol definition validations', () => {
      it('should not allow a record in protocol structure to reference an on-existent record type', async () => {
        const definition = {
          published : true,
          protocol  : 'http://example.com',
          types     : {
            record: {},
          },
          structure: {
            undeclaredRecord: { } // non-existent record type
          }
        };

        const alice = await TestDataGenerator.generatePersona();

        const createPromise = ProtocolsConfigure.create({
          signer: Jws.createSigner(alice),
          definition
        });

        await expect(createPromise).to.be.rejectedWith(DwnErrorCode.ProtocolsConfigureInvalidRuleSetRecordType);
      });

      it('should allow `role` property in an `action` to have protocol path to a role record.', async () => {
        const definition = {
          published : true,
          protocol  : 'http://example.com',
          types     : {
            rootRole    : {},
            firstLevel  : {},
            secondLevel : {}
          },
          structure: {
            rootRole: {
              $role       : true,
              secondLevel : {
                $actions: [{
                  role : 'rootRole', // valid because 'rootRole` has $role: true
                  can  : 'write'
                }]
              }
            },
            firstLevel: {
              $actions: [{
                role : 'rootRole', // valid because 'rootRole` has $role: true
                can  : 'write'
              }]
            }
          }
        };

        const alice = await TestDataGenerator.generatePersona();

        const protocolsConfigure = await ProtocolsConfigure.create({
          signer: Jws.createSigner(alice),
          definition
        });

        expect(protocolsConfigure.message.descriptor.definition).not.to.be.undefined;
      });

      it('should allow `role` property in an `action` that have protocol path to a role record.', async () => {
        const definition = {
          published : true,
          protocol  : 'http://example.com',
          types     : {
            thread      : {},
            participant : {},
            chat        : {}
          },
          structure: {
            thread: {
              participant: {
                $role: true,
              },
              chat: {
                $actions: [{
                  role : 'thread/participant', // valid because 'thread/participant` has $contextRole: true
                  can  : 'write'
                }]
              }
            }
          }
        };

        const alice = await TestDataGenerator.generatePersona();

        const protocolsConfigure = await ProtocolsConfigure.create({
          signer: Jws.createSigner(alice),
          definition
        });

        expect(protocolsConfigure.message.descriptor.definition).not.to.be.undefined;
      });

      it('rejects protocol definitions with `role` actions that contain invalid roles', async () => {
        const definition = {
          published : true,
          protocol  : 'http://example.com',
          types     : {
            foo : {},
            bar : {},
          },
          structure: {
            foo: {
              // $role: true // deliberated omitted
            },
            bar: {
              $actions: [{
                role : 'foo', // foo is not a role
                can  : 'read'
              }]
            }
          }
        };

        const alice = await TestDataGenerator.generatePersona();

        const createProtocolsConfigurePromise = ProtocolsConfigure.create({
          signer: Jws.createSigner(alice),
          definition
        });

        await expect(createProtocolsConfigurePromise)
          .to.be.rejectedWith(DwnErrorCode.ProtocolsConfigureRoleDoesNotExistAtGivenPath);
      });

      it('rejects protocol definitions with actions that contain `of` and  `who` is `anyone`', async () => {
        const definition = {
          published : true,
          protocol  : 'http://example.com',
          types     : {
            message: {},
          },
          structure: {
            message: {
              $actions: [{
                who : 'anyone',
                of  : 'message', // Not allowed
                can : 'read'
              }]
            }
          }
        };

        const alice = await TestDataGenerator.generatePersona();

        const createProtocolsConfigurePromise = ProtocolsConfigure.create({
          signer: Jws.createSigner(alice),
          definition
        });

        await expect(createProtocolsConfigurePromise)
          .to.be.rejectedWith(DwnErrorCode.ProtocolsConfigureInvalidActionOfNotAllowed);
      });

      it('rejects protocol definitions with actions that have direct-recipient-can rules with actions other than delete or update', async () => {
        const definition = {
          published : true,
          protocol  : 'http://example.com',
          types     : {
            message: {},
          },
          structure: {
            message: {
              $actions: [{
                who : 'recipient',
                can : 'read' // not allowed, should be either delete or update
              }]
            }
          }
        };

        const alice = await TestDataGenerator.generatePersona();

        const createProtocolsConfigurePromise = ProtocolsConfigure.create({
          signer: Jws.createSigner(alice),
          definition
        });

        await expect(createProtocolsConfigurePromise)
          .to.be.rejectedWith(DwnErrorCode.ProtocolsConfigureInvalidRecipientOfAction);
      });

      it('rejects protocol definitions with actions that don\'t contain `of` and  `who` is `author`', async () => {
        const definition = {
          published : true,
          protocol  : 'http://example.com',
          types     : {
            message: {},
          },
          structure: {
            message: {
              $actions: [{
                who : 'author',
                // of : 'message', // Intentionally missing
                can : 'read'
              }]
            }
          }
        };

        const alice = await TestDataGenerator.generatePersona();

        const createProtocolsConfigurePromise = ProtocolsConfigure.create({
          signer: Jws.createSigner(alice),
          definition
        });

        await expect(createProtocolsConfigurePromise)
          .to.be.rejectedWith(DwnErrorCode.ProtocolsConfigureInvalidActionMissingOf);
      });

      it('rejects protocol definitions with `can: query` in non-role rules', async () => {
        const definition = {
          published : true,
          protocol  : 'http://example.com',
          types     : {
            message: {},
          },
          structure: {
            message: {
              $actions: [{
                who : 'author',
                of  : 'message',
                can : 'query'
              }]
            }
          }
        };

        const alice = await TestDataGenerator.generatePersona();

        const createProtocolsConfigurePromise = ProtocolsConfigure.create({
          signer: Jws.createSigner(alice),
          definition
        });

        await expect(createProtocolsConfigurePromise)
          .to.be.rejected;
      });

      it('allows $size min and max to be set on a protocol path', async () => {
        const definition = {
          published : true,
          protocol  : 'http://example.com',
          types     : {
            message: {},
          },
          structure: {
            message: {
              $size: {
                min : 1,
                max : 1000
              }
            }
          }
        };

        const alice = await TestDataGenerator.generatePersona();

        const protocolsConfigure = await ProtocolsConfigure.create({
          signer: Jws.createSigner(alice),
          definition
        });

        expect(protocolsConfigure.message.descriptor.definition).not.to.be.undefined;
      });

      it('allows $size max to be set on a protocol path (min defaults to 0)', async () => {
        const definition = {
          published : true,
          protocol  : 'http://example.com',
          types     : {
            message: {},
          },
          structure: {
            message: {
              $size: {
                max: 1000
              }
            }
          }
        };

        const alice = await TestDataGenerator.generatePersona();

        const protocolsConfigure = await ProtocolsConfigure.create({
          signer: Jws.createSigner(alice),
          definition
        });

        expect(protocolsConfigure.message.descriptor.definition).not.to.be.undefined;
      });

      it('rejects $size when max is less than min', async () => {
        const definition = {
          published : true,
          protocol  : 'http://example.com',
          types     : {
            message: {},
          },
          structure: {
            message: {
              $size: {
                min : 1000,
                max : 1
              }
            }
          }
        };

        const alice = await TestDataGenerator.generatePersona();

        const createProtocolsConfigurePromise = ProtocolsConfigure.create({
          signer: Jws.createSigner(alice),
          definition
        });

        await expect(createProtocolsConfigurePromise).to.eventually.be.rejectedWith(DwnErrorCode.ProtocolsConfigureInvalidSize);
      });
    });
  });
});

