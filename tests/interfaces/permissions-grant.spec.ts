import { expect } from 'chai';

import type { CreateFromPermissionsRequestOverrides } from '../../src/interfaces/permissions-grant.js';
import type { PermissionScope } from '../../src/index.js';
import type { RecordsPermissionScope } from '../../src/types/permissions-grant-descriptor.js';

import { Message } from '../../src/core/message.js';
import { PermissionsConditionPublication } from '../../src/types/permissions-grant-descriptor.js';
import { PermissionsGrant } from '../../src/interfaces/permissions-grant.js';
import { Secp256k1 } from '../../src/utils/secp256k1.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { Time } from '../../src/utils/time.js';
import { DwnErrorCode, DwnInterfaceName, DwnMethodName, Jws, PrivateKeySigner } from '../../src/index.js';

describe('PermissionsGrant', () => {
  describe('create()', async () => {
    it('creates a PermissionsGrant message', async () => {
      const { privateJwk } = await Secp256k1.generateKeyPair();
      const signer = new PrivateKeySigner({ privateJwk, keyId: 'did:jank:bob' });

      const { message } = await PermissionsGrant.create({
        dateExpires : Time.getCurrentTimestamp(),
        description : 'drugs',
        grantedBy   : 'did:jank:bob',
        grantedTo   : 'did:jank:alice',
        grantedFor  : 'did:jank:bob',
        scope       : { interface: DwnInterfaceName.Records, method: DwnMethodName.Write },
        signer
      });

      expect(message.descriptor.grantedTo).to.equal('did:jank:alice');
      expect(message.descriptor.grantedBy).to.equal('did:jank:bob');
      expect(message.descriptor.scope).to.eql({ interface: DwnInterfaceName.Records, method: DwnMethodName.Write });
      expect(message.descriptor.conditions).to.be.undefined;
      expect(message.descriptor.description).to.eql('drugs');
    });

    describe('scope property normalizations', async () => {
      it('ensures that `schema` is normalized', async () => {
        const { privateJwk } = await Secp256k1.generateKeyPair();
        const signer = new PrivateKeySigner({ privateJwk, keyId: 'did:jank:bob' });

        const scope: PermissionScope = {
          interface : DwnInterfaceName.Records,
          method    : DwnMethodName.Write,
          schema    : 'example.com/',
        };

        const { message } = await PermissionsGrant.create({
          dateExpires : Time.getCurrentTimestamp(),
          description : 'schema normalization test',
          grantedBy   : 'did:jank:bob',
          grantedTo   : 'did:jank:alice',
          grantedFor  : 'did:jank:bob',
          scope       : scope,
          signer
        });


        expect((message.descriptor.scope as RecordsPermissionScope).schema).to.equal('http://example.com');
      });

      it('ensures that `protocol` is normalized', async () => {
        const { privateJwk } = await Secp256k1.generateKeyPair();
        const signer = new PrivateKeySigner({ privateJwk, keyId: 'did:jank:bob' });

        const scope: PermissionScope = {
          interface : DwnInterfaceName.Records,
          method    : DwnMethodName.Write,
          protocol  : 'example.com/',
        };

        const { message } = await PermissionsGrant.create({
          dateExpires : Time.getCurrentTimestamp(),
          description : 'protocol normalization test',
          grantedBy   : 'did:jank:bob',
          grantedTo   : 'did:jank:alice',
          grantedFor  : 'did:jank:bob',
          scope       : scope,
          signer
        });


        expect((message.descriptor.scope as RecordsPermissionScope).protocol).to.equal('http://example.com');
      });
    });

    describe('scope validations', () => {
      it('ensures that `schema` and protocol related fields `protocol`, `contextId` or `protocolPath`', async () => {
        const { privateJwk } = await Secp256k1.generateKeyPair();
        const signer = new PrivateKeySigner({ privateJwk, keyId: 'did:jank:bob' });

        const permissionsGrantOptions = {
          dateExpires : Time.getCurrentTimestamp(),
          grantedBy   : 'did:jank:bob',
          grantedTo   : 'did:jank:alice',
          grantedFor  : 'did:jank:bob',
          signer
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
        const signer = new PrivateKeySigner({ privateJwk, keyId: 'did:jank:bob' });

        const permissionsGrantOptions = {
          dateExpires : Time.getCurrentTimestamp(),
          grantedBy   : 'did:jank:bob',
          grantedTo   : 'did:jank:alice',
          grantedFor  : 'did:jank:bob',
          signer
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

  describe('asDelegatedGrant()', async () => {
    it('should throw if the `delegated` property is not `true`', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const { message } = await PermissionsGrant.create({
        dateExpires : Time.getCurrentTimestamp(),
        grantedBy   : alice.did,
        grantedTo   : 'did:example:bob',
        grantedFor  : alice.did,
        scope       : { interface: DwnInterfaceName.Records, method: DwnMethodName.Write },
        signer      : Jws.createSigner(alice)
      });

      expect(() => PermissionsGrant.asDelegatedGrant(message)).to.throw(DwnErrorCode.PermissionsGrantNotADelegatedGrant);
    });
  });
});
