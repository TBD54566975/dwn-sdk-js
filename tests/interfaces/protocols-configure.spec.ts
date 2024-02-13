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

      // we need to manually created an invalid protocol definition SDK `create()` method will not allow us to create an invalid definition
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

      const nonnormalizedDexProtocol = { ...dexProtocolDefinition };
      nonnormalizedDexProtocol.types.ask.schema = 'ask';

      const options = {
        recipient  : alice.did,
        data       : TestDataGenerator.randomBytes(10),
        dataFormat : 'application/json',
        signer     : Jws.createSigner(alice),
        protocol   : 'example.com/',
        definition : nonnormalizedDexProtocol
      };
      const protocolsConfig = await ProtocolsConfigure.create(options);

      const message = protocolsConfig.message as ProtocolsConfigureMessage;
      expect(message.descriptor.definition.types.ask.schema).to.eq('http://ask');
    });

    describe('protocol definition validations', () => {
      it('allows `role` actions that have protocol path to valid $globalRole records', async () => {
        const definition = {
          published : true,
          protocol  : 'http://example.com',
          types     : {
            rootRole    : {},
            secondLevel : {},
            otherRoot   : {}
          },
          structure: {
            rootRole: {
              $globalRole : true,
              secondLevel : {
                $actions: [{
                  role : 'rootRole', // valid because 'rootRole` has $globalRole: true
                  can  : 'write'
                }]
              }
            },
            otherRole: {
              $actions: [{
                role : 'rootRole', // valid because 'rootRole` has $globalRole: true
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

      it('allows `role` actions that have protocol path to valid $contextRole records', async () => {
        const definition = {
          published : true,
          protocol  : 'http://example.com',
          types     : {
            rootRole    : {},
            secondLevel : {},
            otherRoot   : {}
          },
          structure: {
            thread: {
              participant: {
                $contextRole: true,
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

      it('rejects protocol definitions with $globalRole at records that are not root records', async () => {
        const definition = {
          published : true,
          protocol  : 'http://example.com',
          types     : {
            root        : {},
            secondLevel : {}
          },
          structure: {
            root: {
              secondLevel: {
                // $globalRole may only be set on root records, not nested records
                $globalRole: true
              }
            }
          }
        };

        const alice = await TestDataGenerator.generatePersona();

        const createProtocolsConfigurePromise = ProtocolsConfigure.create({
          signer: Jws.createSigner(alice),
          definition
        });

        await expect(createProtocolsConfigurePromise)
          .to.be.rejectedWith(DwnErrorCode.ProtocolsConfigureGlobalRoleAtProhibitedProtocolPath);
      });

      it('rejects protocol definitions with `role` actions that contain invalid roles', async () => {
        const definition = {
          published : true,
          protocol  : 'http://example.com',
          types     : {
            rootRole  : {},
            otherRoot : {},
          },
          structure: {
            rootRole: {
              // $globalRole: true // deliberated omitted
            },
            otherRoot: {
              $actions: [{
                role : 'rootRole', // Not a valid role
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
          .to.be.rejectedWith(DwnErrorCode.ProtocolsConfigureInvalidRole);
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
    });
  });
});

