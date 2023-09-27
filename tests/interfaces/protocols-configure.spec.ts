import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

import type { ProtocolsConfigureMessage } from '../../src/index.js';

import dexProtocolDefinition from '../vectors/protocol-definitions/dex.json' assert { type: 'json' };
import { DwnErrorCode } from '../../src/index.js';
import { getCurrentTimeInHighPrecision } from '../../src/utils/time.js';
import { Jws } from '../../src/utils/jws.js';
import { ProtocolsConfigure } from '../../src/interfaces/protocols-configure.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';

chai.use(chaiAsPromised);

describe('ProtocolsConfigure', () => {
  describe('create()', () => {
    it('should use `messageTimestamp` as is if given', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const currentTime = getCurrentTimeInHighPrecision();
      const definition = { ...dexProtocolDefinition };
      const protocolsConfigure = await ProtocolsConfigure.create({
        messageTimestamp    : currentTime,
        definition,
        authorizationSigner : Jws.createSigner(alice),
      });

      expect(protocolsConfigure.message.descriptor.messageTimestamp).to.equal(currentTime);
    });

    it('should auto-normalize protocol URI', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const definition = { ...dexProtocolDefinition, protocol: 'example.com/' };
      const options = {
        recipient           : alice.did,
        data                : TestDataGenerator.randomBytes(10),
        dataFormat          : 'application/json',
        authorizationSigner : Jws.createSigner(alice),
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
        recipient           : alice.did,
        data                : TestDataGenerator.randomBytes(10),
        dataFormat          : 'application/json',
        authorizationSigner : Jws.createSigner(alice),
        protocol            : 'example.com/',
        definition          : nonnormalizedDexProtocol
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
          authorizationSigner: Jws.createSigner(alice),
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
          authorizationSigner: Jws.createSigner(alice),
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
          authorizationSigner: Jws.createSigner(alice),
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
          authorizationSigner: Jws.createSigner(alice),
          definition
        });

        await expect(createProtocolsConfigurePromise)
          .to.be.rejectedWith(DwnErrorCode.ProtocolsConfigureInvalidAction);
      });

      it('rejects protocol definitions with actions that don\'t contain `of` and  `who` is `author` or `recipient`', async () => {
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
          authorizationSigner: Jws.createSigner(alice),
          definition
        });

        await expect(createProtocolsConfigurePromise)
          .to.be.rejectedWith(DwnErrorCode.ProtocolsConfigureInvalidAction);
      });

    });
  });
});

