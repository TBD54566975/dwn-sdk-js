import { expect } from 'chai';

import type { CreateFromPermissionsRequestOverrides } from '../../src/interfaces/permissions-grant.js';
import type { PermissionScope } from '../../src/index.js';

import { getCurrentTimeInHighPrecision } from '../../src/utils/time.js';
import { PermissionsConditionPublication } from '../../src/types/permissions-types.js';
import { PermissionsGrant } from '../../src/interfaces/permissions-grant.js';
import { Secp256k1 } from '../../src/utils/secp256k1.js';
import { Temporal } from '@js-temporal/polyfill';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { DidKeyResolver, DwnErrorCode, PrivateKeySigner } from '../../src/index.js';
import { DwnInterfaceName, DwnMethodName, Message } from '../../src/core/message.js';

describe('PermissionsGrant', () => {
  describe('create()', async () => {
    it('creates a PermissionsGrant message', async () => {
      const { privateJwk } = await Secp256k1.generateKeyPair();
      const authorizationSignatureInput = {
        signer          : new PrivateKeySigner(privateJwk),
        protectedHeader : {
          alg : privateJwk.alg as string,
          kid : 'did:jank:bob'
        }
      };

      const { message } = await PermissionsGrant.create({
        dateExpires : getCurrentTimeInHighPrecision(),
        description : 'drugs',
        grantedBy   : 'did:jank:bob',
        grantedTo   : 'did:jank:alice',
        grantedFor  : 'did:jank:bob',
        scope       : { interface: DwnInterfaceName.Records, method: DwnMethodName.Write },
        authorizationSignatureInput
      });

      expect(message.descriptor.grantedTo).to.equal('did:jank:alice');
      expect(message.descriptor.grantedBy).to.equal('did:jank:bob');
      expect(message.descriptor.scope).to.eql({ interface: DwnInterfaceName.Records, method: DwnMethodName.Write });
      expect(message.descriptor.conditions).to.be.undefined;
      expect(message.descriptor.description).to.eql('drugs');
    });

    describe('scope validations', () => {
      it('ensures that `schema` and protocol related fields `protocol`, `contextId` or `protocolPath`', async () => {
        const { privateJwk } = await Secp256k1.generateKeyPair();
        const authorizationSignatureInput = {
          signer          : new PrivateKeySigner(privateJwk),
          protectedHeader : {
            alg : privateJwk.alg as string,
            kid : 'did:jank:bob'
          }
        };

        const permissionsGrantOptions = {
          dateExpires : getCurrentTimeInHighPrecision(),
          grantedBy   : 'did:jank:bob',
          grantedTo   : 'did:jank:alice',
          grantedFor  : 'did:jank:bob',
          authorizationSignatureInput
        };

        // Reject when `schema` and `protocol` are both present
        let scope: PermissionScope = {
          interface : DwnInterfaceName.Records,
          method    : DwnMethodName.Write,
          schema    : 'some-schema',
          protocol  : 'some-protocol'
        };
        expect(PermissionsGrant.create({ ...permissionsGrantOptions, scope }))
          .to.be.rejectedWith(DwnErrorCode.PermissionsGrantScopeSchemaProhibitedFields);

        // Reject when `schema` and `contextId` are both present
        scope = {
          interface : DwnInterfaceName.Records,
          method    : DwnMethodName.Write,
          schema    : 'some-schema',
          contextId : 'some-contextId'
        };
        expect(PermissionsGrant.create({ ...permissionsGrantOptions, scope }))
          .to.be.rejectedWith(DwnErrorCode.PermissionsGrantScopeSchemaProhibitedFields);

        // Reject when `schema` and `protocolPath` are both present
        scope = {
          interface    : DwnInterfaceName.Records,
          method       : DwnMethodName.Write,
          schema       : 'some-schema',
          protocolPath : 'some-protocol-path'
        };
        expect(PermissionsGrant.create({ ...permissionsGrantOptions, scope }))
          .to.be.rejectedWith(DwnErrorCode.PermissionsGrantScopeSchemaProhibitedFields);
      });

      it('ensures that `contextId` and `protocolPath` are not both present', async () => {
        const { privateJwk } = await Secp256k1.generateKeyPair();
        const authorizationSignatureInput = {
          signer          : new PrivateKeySigner(privateJwk),
          protectedHeader : {
            alg : privateJwk.alg as string,
            kid : 'did:jank:bob'
          }
        };

        const permissionsGrantOptions = {
          dateExpires : getCurrentTimeInHighPrecision(),
          grantedBy   : 'did:jank:bob',
          grantedTo   : 'did:jank:alice',
          grantedFor  : 'did:jank:bob',
          authorizationSignatureInput
        };

        // Allow when `context to be present ` and `protocol` are both present
        const scope = {
          interface    : DwnInterfaceName.Records,
          method       : DwnMethodName.Write,
          protocol     : 'some-protocol',
          contextId    : 'some-contextId',
          protocolPath : 'some-protocol-path',
        };
        expect(PermissionsGrant.create({ ...permissionsGrantOptions, scope }))
          .to.be.rejectedWith(DwnErrorCode.PermissionsGrantScopeContextIdAndProtocolPath);
      });
    });
  });

  describe('createFromPermissionsRequest()', async () => {
    it('should create a PermissionsGrant from a PermissionsRequest with the same properties', async () => {
      const alice = await TestDataGenerator.generatePersona();
      const bob = await TestDataGenerator.generatePersona();

      const { privateJwk } = await Secp256k1.generateKeyPair();
      const authorizationSignatureInput = {
        signer          : new PrivateKeySigner(privateJwk),
        protectedHeader : {
          alg : privateJwk.alg as string,
          kid : alice.did
        }
      };

      const { permissionsRequest } = await TestDataGenerator.generatePermissionsRequest({
        author      : bob,
        description : 'friendship',
        grantedBy   : alice.did,
        grantedFor  : alice.did,
        grantedTo   : bob.did,
      });

      const dateExpires = Temporal.Now.instant().add({ hours: 24 }).toString({ smallestUnit: 'microseconds' });
      const permissionsGrant = await PermissionsGrant.createFromPermissionsRequest(permissionsRequest, authorizationSignatureInput, { dateExpires });

      expect(permissionsGrant.author).to.eq(alice.did);
      expect(permissionsGrant.message.descriptor.description).to.eq(permissionsRequest.message.descriptor.description);
      expect(permissionsGrant.message.descriptor.grantedBy).to.eq(permissionsRequest.message.descriptor.grantedBy);
      expect(permissionsGrant.message.descriptor.grantedTo).to.eq(permissionsRequest.message.descriptor.grantedTo);
      expect(permissionsGrant.message.descriptor.grantedFor).to.eq(permissionsRequest.message.descriptor.grantedFor);
      expect(permissionsGrant.message.descriptor.scope).to.eq(permissionsRequest.message.descriptor.scope);
      expect(permissionsGrant.message.descriptor.conditions).to.eq(permissionsRequest.message.descriptor.conditions);
      expect(permissionsGrant.message.descriptor.permissionsRequestId).to.eq(await Message.getCid(permissionsRequest.message));
    });

    it('should create a PermissionsGrant from a PermissionsRequest and overrides', async () => {
      const alice = await DidKeyResolver.generate();
      const bob = await DidKeyResolver.generate();
      const carol = await DidKeyResolver.generate();

      const { privateJwk } = await Secp256k1.generateKeyPair();
      const authorizationSignatureInput = {
        signer          : new PrivateKeySigner(privateJwk),
        protectedHeader : {
          alg : privateJwk.alg as string,
          kid : alice.did
        }
      };

      const { permissionsRequest } = await TestDataGenerator.generatePermissionsRequest();

      const description = 'friendship';
      const dateExpires = getCurrentTimeInHighPrecision();
      const overrides: CreateFromPermissionsRequestOverrides = {
        dateExpires,
        description,
        grantedBy  : alice.did,
        grantedTo  : bob.did,
        grantedFor : carol.did,
        scope      : {
          interface : DwnInterfaceName.Protocols,
          method    : DwnMethodName.Query,
        },
        conditions: {
          publication: PermissionsConditionPublication.Required,
        }
      };

      const permissionsGrant = await PermissionsGrant.createFromPermissionsRequest(permissionsRequest, authorizationSignatureInput, overrides);

      expect(permissionsGrant.author).to.eq(alice.did);
      expect(permissionsGrant.message.descriptor.description).to.eq(description);
      expect(permissionsGrant.message.descriptor.grantedBy).to.eq(overrides.grantedBy);
      expect(permissionsGrant.message.descriptor.grantedTo).to.eq(overrides.grantedTo);
      expect(permissionsGrant.message.descriptor.grantedFor).to.eq(overrides.grantedFor);
      expect(permissionsGrant.message.descriptor.scope).to.eq(overrides.scope);
      expect(permissionsGrant.message.descriptor.conditions).to.eq(overrides.conditions);
      expect(permissionsGrant.message.descriptor.permissionsRequestId).to.eq(await Message.getCid(permissionsRequest.message));
    });
  });
});
