import type { DidResolver } from '@web5/dids';
import type { EventStream } from '../../src/types/subscriptions.js';
import type { PermissionScope } from '../../src/index.js';
import type { DataStore, EventLog, MessageStore, ResumableTaskStore } from '../../src/index.js';

import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import chai, { expect } from 'chai';

import { DataStream } from '../../src/utils/data-stream.js';
import { Dwn } from '../../src/dwn.js';
import { Jws } from '../../src/utils/jws.js';
import { PermissionGrant } from '../../src/protocols/permission-grant.js';
import { PermissionsProtocol } from '../../src/protocols/permissions.js';
import { RecordsRead } from '../../src/interfaces/records-read.js';
import { RecordsWrite } from '../../src/interfaces/records-write.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestEventStream } from '../test-event-stream.js';
import { TestStores } from '../test-stores.js';
import { DidKey, UniversalResolver } from '@web5/dids';
import { DwnErrorCode, DwnInterfaceName, DwnMethodName, Encoder, RecordsQuery, Time } from '../../src/index.js';

chai.use(chaiAsPromised);

export function testPermissions(): void {
  describe('permissions', async () => {
    let didResolver: DidResolver;
    let messageStore: MessageStore;
    let dataStore: DataStore;
    let resumableTaskStore: ResumableTaskStore;
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
      resumableTaskStore = stores.resumableTaskStore;
      eventLog = stores.eventLog;
      eventStream = TestEventStream.get();

      dwn = await Dwn.create({ didResolver, messageStore, dataStore, eventLog, eventStream, resumableTaskStore });
    });

    beforeEach(async () => {
      sinon.restore(); // wipe all previous stubs/spies/mocks/fakes

      // clean up before each test rather than after so that a test does not depend on other tests to do the clean up
      await messageStore.clear();
      await dataStore.clear();
      await resumableTaskStore.clear();
      await eventLog.clear();
    });

    after(async () => {
      sinon.restore();
      await dwn.close();
    });

    it('should include record tags using the createRequest, createGrant and createRevocation if provided', async () => {
      const alice = await TestDataGenerator.generateDidKeyPersona();

      const testProtocol = 'https://example.com/protocol/test';

      // createRequest with a protocol
      const requestWrite = await PermissionsProtocol.createRequest({
        signer      : Jws.createSigner(alice),
        description : 'Requesting to write',
        delegated   : false,
        scope       : {
          interface : DwnInterfaceName.Records,
          method    : DwnMethodName.Write,
          protocol  : testProtocol,
        }
      });
      expect(requestWrite.recordsWrite.message.descriptor.tags).to.deep.equal({ protocol: testProtocol });

      // createGrant with a protocol
      const grantWrite = await PermissionsProtocol.createGrant({
        signer      : Jws.createSigner(alice),
        dateExpires : Time.createOffsetTimestamp({ seconds: 100 }),
        description : 'Allow Bob to write',
        grantedTo   : alice.did,
        scope       : {
          interface : DwnInterfaceName.Records,
          method    : DwnMethodName.Write,
          protocol  : testProtocol,
        }
      });
      expect(grantWrite.recordsWrite.message.descriptor.tags).to.deep.equal({ protocol: testProtocol });

      // createRevocation with a protocol derived from the grant
      const revokeWrite = await PermissionsProtocol.createRevocation({
        signer      : Jws.createSigner(alice),
        grant       : new PermissionGrant(grantWrite.dataEncodedMessage),
        dateRevoked : Time.getCurrentTimestamp()
      });
      expect(revokeWrite.recordsWrite.message.descriptor.tags).to.deep.equal({ protocol: testProtocol });
    });

    it('should normalize the protocol URL in the scope of a Request, Grant, and Revocation', async () => {
      const alice = await TestDataGenerator.generateDidKeyPersona();
      const bob = await TestDataGenerator.generateDidKeyPersona();

      // createRequest with a protocol that will be normalized to `http://any-protocol`
      const requestWrite = await PermissionsProtocol.createRequest({
        signer      : Jws.createSigner(bob),
        description : 'Requesting to write',
        delegated   : false,
        scope       : {
          interface : DwnInterfaceName.Records,
          method    : DwnMethodName.Write,
          protocol  : 'any-protocol' // URL will normalize to `http://any-protocol`
        }
      });
      expect(requestWrite.recordsWrite.message.descriptor.tags).to.deep.equal({ protocol: 'http://any-protocol' });

      // createRequest with a protocol that is already normalized to `https://any-protocol`
      const requestWrite2 = await PermissionsProtocol.createRequest({
        signer      : Jws.createSigner(bob),
        description : 'Requesting to write',
        delegated   : false,
        scope       : {
          interface : DwnInterfaceName.Records,
          method    : DwnMethodName.Write,
          protocol  : 'https://any-protocol'
        }
      });
      expect(requestWrite2.recordsWrite.message.descriptor.tags).to.deep.equal({ protocol: 'https://any-protocol' });

      // createGrant with a protocol that will be normalized to `http://any-protocol`
      const grantWrite = await PermissionsProtocol.createGrant({
        signer      : Jws.createSigner(alice),
        dateExpires : Time.createOffsetTimestamp({ seconds: 100 }),
        description : 'Allow Bob to write',
        grantedTo   : bob.did,
        scope       : {
          interface : DwnInterfaceName.Records,
          method    : DwnMethodName.Write,
          protocol  : 'any-protocol' // URL will normalize to `http://any-protocol`
        }
      });
      expect(grantWrite.recordsWrite.message.descriptor.tags).to.deep.equal({ protocol: 'http://any-protocol' });

      // createGrant with a protocol that is already normalized to `https://any-protocol`
      const grantWrite2 = await PermissionsProtocol.createGrant({
        signer      : Jws.createSigner(alice),
        dateExpires : Time.createOffsetTimestamp({ seconds: 100 }),
        description : 'Allow Bob to write',
        grantedTo   : bob.did,
        scope       : {
          interface : DwnInterfaceName.Records,
          method    : DwnMethodName.Write,
          protocol  : 'https://any-protocol'
        }
      });
      expect(grantWrite2.recordsWrite.message.descriptor.tags).to.deep.equal({ protocol: 'https://any-protocol' });
    });

    it('should derive the grantId and protocol from the grant record when creating a revocation', async () => {
      const alice = await TestDataGenerator.generateDidKeyPersona();
      const bob = await TestDataGenerator.generateDidKeyPersona();

      const grantProtocol = 'https://example.com/protocol/test';

      // alice creates a grant for bob
      const grantWrite = await PermissionsProtocol.createGrant({
        signer      : Jws.createSigner(alice),
        dateExpires : Time.createOffsetTimestamp({ seconds: 100 }),
        description : 'Allow Bob to write',
        grantedTo   : bob.did,
        scope       : {
          interface : DwnInterfaceName.Records,
          method    : DwnMethodName.Write,
          protocol  : grantProtocol,
        }
      });
      const grantWriteReply = await dwn.processMessage(alice.did, grantWrite.recordsWrite.message, {
        dataStream: DataStream.fromBytes(grantWrite.permissionGrantBytes)
      });
      expect(grantWriteReply.status.code).to.equal(202);

      // derive the grantId and protocol from the grant record
      const revokeWrite = await PermissionsProtocol.createRevocation({
        signer      : Jws.createSigner(alice),
        grant       : new PermissionGrant(grantWrite.dataEncodedMessage),
        dateRevoked : Time.getCurrentTimestamp()
      });

      // check that the protocol is in the revocation record's tags
      expect(revokeWrite.recordsWrite.message.descriptor.tags).to.deep.equal({ protocol: grantProtocol });

      // check that the revocation's parentId is the grant's recordId
      expect(revokeWrite.recordsWrite.message.descriptor.parentId).to.equal(grantWrite.recordsWrite.message.recordId);
    });

    it('should support permission management through use of Request, Grants, and Revocations', async () => {
      // scenario:
      // 1. Verify anyone (Bob) can send a permission request to Alice
      // 2. Alice queries her DWN for new permission requests
      // 3. Verify a non-owner cannot create a grant for Bob in Alice's DWN
      // 4. Alice creates a permission grant for Bob in her DWN
      // 5. Verify that Bob can query the permission grant from Alice's DWN (even though Alice can also send it directly to Bob)
      // 6. Verify that any third-party can fetch revocation of the grant and find it is still active (not revoked)
      // 7. Verify that non-owner cannot revoke the grant
      // 8. Alice revokes the permission grant for Bob
      // 9. Verify that any third-party can fetch the revocation status of the permission grant

      const alice = await TestDataGenerator.generateDidKeyPersona();
      const bob = await TestDataGenerator.generateDidKeyPersona();

      // 1. Verify anyone (Bob) can send a permission request to Alice
      const permissionScope: PermissionScope = {
        interface : DwnInterfaceName.Records,
        method    : DwnMethodName.Write,
        protocol  : `any-protocol`
      };

      const requestToAlice = await PermissionsProtocol.createRequest({
        signer      : Jws.createSigner(bob),
        description : `Requesting to write to Alice's DWN`,
        delegated   : false,
        scope       : permissionScope
      });

      const requestWriteReply = await dwn.processMessage(
        alice.did,
        requestToAlice.recordsWrite.message,
        { dataStream: DataStream.fromBytes(requestToAlice.permissionRequestBytes) }
      );
      expect(requestWriteReply.status.code).to.equal(202);

      // 2. Alice queries her DWN for new permission requests
      const requestQuery = await RecordsQuery.create({
        signer : Jws.createSigner(alice),
        filter : {
          protocolPath : PermissionsProtocol.requestPath,
          protocol     : PermissionsProtocol.uri,
          dateUpdated  : { from: Time.createOffsetTimestamp({ seconds: -1 * 60 * 60 * 24 }) }// last 24 hours
        }
      });

      const requestQueryReply = await dwn.processMessage(alice.did, requestQuery.message);
      const requestFromBob = requestQueryReply.entries?.[0]!;
      expect(requestQueryReply.status.code).to.equal(200);
      expect(requestQueryReply.entries?.length).to.equal(1);
      expect(requestFromBob.recordId).to.equal(requestToAlice.recordsWrite.message.recordId);

      // 3. Verify a non-owner cannot create a grant for Bob in Alice's DWN
      const decodedRequest = PermissionsProtocol.parseRequest(requestFromBob.encodedData!);
      const unauthorizedGrantWrite = await PermissionsProtocol.createGrant({
        signer      : Jws.createSigner(bob),
        dateExpires : Time.createOffsetTimestamp({ seconds: 100 }),
        description : 'Allow Bob to write',
        grantedTo   : bob.did,
        scope       : decodedRequest.scope
      });

      const unauthorizedGrantWriteReply = await dwn.processMessage(
        alice.did,
        unauthorizedGrantWrite.recordsWrite.message,
        { dataStream: DataStream.fromBytes(unauthorizedGrantWrite.permissionGrantBytes) }
      );
      expect(unauthorizedGrantWriteReply.status.code).to.equal(401);
      expect(unauthorizedGrantWriteReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationActionNotAllowed);

      // 4. Alice creates a permission grant for Bob in her DWN
      const grantWrite = await PermissionsProtocol.createGrant({
        signer      : Jws.createSigner(alice),
        dateExpires : Time.createOffsetTimestamp({ seconds: 100 }),
        description : 'Allow Bob to write',
        grantedTo   : bob.did,
        scope       : decodedRequest.scope
      });

      const grantWriteReply = await dwn.processMessage(
        alice.did,
        grantWrite.recordsWrite.message,
        { dataStream: DataStream.fromBytes(grantWrite.permissionGrantBytes) }
      );
      expect(grantWriteReply.status.code).to.equal(202);

      // 5. Verify that Bob can query the permission grant from Alice's DWN (even though Alice can also send it directly to Bob)
      const grantQuery = await RecordsQuery.create({
        signer : Jws.createSigner(bob),
        filter : {
          protocolPath : PermissionsProtocol.grantPath,
          protocol     : PermissionsProtocol.uri,
          dateUpdated  : { from: Time.createOffsetTimestamp({ seconds: -1 * 60 * 60 * 24 }) }// last 24 hours
        }
      });

      const grantQueryReply = await dwn.processMessage(alice.did, grantQuery.message);
      const grantFromBob = grantQueryReply.entries?.[0]!;
      expect(grantQueryReply.status.code).to.equal(200);
      expect(grantQueryReply.entries?.length).to.equal(1);
      expect(grantFromBob.recordId).to.equal(grantWrite.recordsWrite.message.recordId);

      // 6. Verify that any third-party can fetch revocation of the grant and find it is still active (not revoked)
      const revocationRead = await RecordsRead.create({
        signer : Jws.createSigner(bob),
        filter : {
          contextId    : grantWrite.recordsWrite.message.contextId,
          protocolPath : PermissionsProtocol.revocationPath
        }
      });

      const revocationReadReply = await dwn.processMessage(alice.did, revocationRead.message);
      expect(revocationReadReply.status.code).to.equal(404);

      // 7. Verify that non-owner cannot revoke the grant
      const unauthorizedRevokeWrite = await PermissionsProtocol.createRevocation({
        signer      : Jws.createSigner(bob),
        grant       : new PermissionGrant(grantWrite.dataEncodedMessage),
        dateRevoked : Time.getCurrentTimestamp(),
      });

      const unauthorizedRevokeWriteReply = await dwn.processMessage(
        alice.did,
        unauthorizedRevokeWrite.recordsWrite.message,
        { dataStream: DataStream.fromBytes(unauthorizedRevokeWrite.permissionRevocationBytes) }
      );
      expect(unauthorizedRevokeWriteReply.status.code).to.equal(401);
      expect(unauthorizedGrantWriteReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationActionNotAllowed);

      // 8. Alice revokes the permission grant for Bob
      const revokeWrite = await PermissionsProtocol.createRevocation({
        signer      : Jws.createSigner(alice),
        grant       : new PermissionGrant(grantWrite.dataEncodedMessage),
        dateRevoked : Time.getCurrentTimestamp(),
      });

      const revokeWriteReply = await dwn.processMessage(
        alice.did,
        revokeWrite.recordsWrite.message,
        { dataStream: DataStream.fromBytes(revokeWrite.permissionRevocationBytes) }
      );
      expect(revokeWriteReply.status.code).to.equal(202);

      // 9. Verify that any third-party can fetch the revocation status of the permission grant
      const revocationReadReply2 = await dwn.processMessage(alice.did, revocationRead.message);
      expect(revocationReadReply2.status.code).to.equal(200);
      expect(revocationReadReply2.record?.recordId).to.equal(revokeWrite.recordsWrite.message.recordId);
    });

    it('should fail if a RecordsPermissionScope in a Request or Grant record is created without a protocol', async () => {
      const alice = await TestDataGenerator.generateDidKeyPersona();
      const bob = await TestDataGenerator.generateDidKeyPersona();

      const permissionScope = {
        interface : DwnInterfaceName.Records,
        method    : DwnMethodName.Write
      };

      const requestWrite = PermissionsProtocol.createRequest({
        signer      : Jws.createSigner(bob),
        description : `Requesting to write to Alice's DWN`,
        delegated   : false,
        scope       : permissionScope as any // explicity as any to test the validation
      });
      await expect(requestWrite).to.eventually.be.rejectedWith(DwnErrorCode.PermissionsProtocolCreateRequestRecordsScopeMissingProtocol);


      const grantWrite = PermissionsProtocol.createGrant({
        signer      : Jws.createSigner(alice),
        dateExpires : Time.createOffsetTimestamp({ seconds: 100 }),
        description : 'Allow Bob to write',
        grantedTo   : bob.did,
        scope       : permissionScope as any // explicity as any to test the validation
      });
      await expect(grantWrite).to.eventually.be.rejectedWith(DwnErrorCode.PermissionsProtocolCreateGrantRecordsScopeMissingProtocol);
    });

    it('should fail if an invalid protocolPath is used during Permissions schema validation', async () => {
      const alice = await TestDataGenerator.generateDidKeyPersona();

      const { message, dataBytes } = await TestDataGenerator.generateRecordsWrite({
        author       : alice,
        protocol     : PermissionsProtocol.uri,
        protocolPath : 'invalid/path',
        data         : Encoder.stringToBytes(JSON.stringify({}))
      });

      expect(
        () => PermissionsProtocol.validateSchema(message, dataBytes!)
      ).to.throw(DwnErrorCode.PermissionsProtocolValidateSchemaUnexpectedRecord);
    });

    it('performs additional validation to the tagged protocol in a Revocation message ensuring it matches the Grant it is revoking', async () => {
      // scenario:
      //  Alice creates a grant scoped to a protocol.
      //  Alice then tries to revoke the grant without a protocol set, it should fail.
      //  Alice then tries to revoke the grant with an invalid protocol, it should fail.
      //  Alice finally tries to revoke the grant with a valid protocol, it should succeed.

      const alice = await TestDataGenerator.generateDidKeyPersona();
      const bob = await TestDataGenerator.generateDidKeyPersona();

      const grantProtocol = 'https://example.com/protocol/test';
      const invalidProtocol = 'https://example.com/protocol/invalid';

      // alice creates a grant for bob
      const grantWrite = await PermissionsProtocol.createGrant({
        signer      : Jws.createSigner(alice),
        dateExpires : Time.createOffsetTimestamp({ seconds: 100 }),
        description : 'Allow Bob to write',
        grantedTo   : bob.did,
        scope       : {
          interface : DwnInterfaceName.Records,
          method    : DwnMethodName.Write,
          protocol  : grantProtocol,
        }
      });
      const grantWriteReply = await dwn.processMessage(alice.did, grantWrite.recordsWrite.message, {
        dataStream: DataStream.fromBytes(grantWrite.permissionGrantBytes)
      });
      expect(grantWriteReply.status.code).to.equal(202);

      // attempt to revoke the grant without a protocol set
      const permissionRevocationBytes = Encoder.objectToBytes({ description: 'Revoking the grant' });
      const revokeWithoutProtocolRecordsWrite = await RecordsWrite.create({
        signer          : Jws.createSigner(alice),
        parentContextId : grantWrite.dataEncodedMessage.recordId,
        protocol        : PermissionsProtocol.uri,
        protocolPath    : PermissionsProtocol.revocationPath,
        dataFormat      : 'application/json',
        data            : permissionRevocationBytes,
      });

      const revokeWriteWithoutProtocolReply = await dwn.processMessage(alice.did, revokeWithoutProtocolRecordsWrite.message, {
        dataStream: DataStream.fromBytes(permissionRevocationBytes)
      });
      expect(revokeWriteWithoutProtocolReply.status.code).to.equal(400);
      expect(revokeWriteWithoutProtocolReply.status.detail).to.contain(DwnErrorCode.PermissionsProtocolValidateRevocationProtocolTagMismatch);
      expect(revokeWriteWithoutProtocolReply.status.detail).to.contain(
        `Revocation protocol undefined does not match grant protocol ${grantProtocol}`
      );

      // revoke the grant with an invalid protocol
      const revokeWriteWithMissMatchedProtocol = await RecordsWrite.create({
        signer          : Jws.createSigner(alice),
        parentContextId : grantWrite.dataEncodedMessage.recordId,
        protocol        : PermissionsProtocol.uri,
        protocolPath    : PermissionsProtocol.revocationPath,
        dataFormat      : 'application/json',
        data            : permissionRevocationBytes,
        tags            : { protocol: invalidProtocol }
      });

      const revokeWriteWithMissMatchedProtocolReply = await dwn.processMessage(alice.did, revokeWriteWithMissMatchedProtocol.message, {
        dataStream: DataStream.fromBytes(permissionRevocationBytes)
      });
      expect(revokeWriteWithMissMatchedProtocolReply.status.code).to.equal(400);
      expect(revokeWriteWithMissMatchedProtocolReply.status.detail).to.contain(DwnErrorCode.PermissionsProtocolValidateRevocationProtocolTagMismatch);
      expect(revokeWriteWithMissMatchedProtocolReply.status.detail).to.contain(
        `Revocation protocol ${invalidProtocol} does not match grant protocol ${grantProtocol}`
      );

      // revoke the grant with a valid protocol
      const revokeWrite = await RecordsWrite.create({
        signer          : Jws.createSigner(alice),
        parentContextId : grantWrite.dataEncodedMessage.recordId,
        protocol        : PermissionsProtocol.uri,
        protocolPath    : PermissionsProtocol.revocationPath,
        dataFormat      : 'application/json',
        data            : permissionRevocationBytes,
        tags            : { protocol: grantProtocol }
      });

      const revokeWriteReply = await dwn.processMessage(alice.did, revokeWrite.message, {
        dataStream: DataStream.fromBytes(permissionRevocationBytes)
      });
      expect(revokeWriteReply.status.code).to.equal(202);
    });

    // These set of tets are primarily to ensure SchemaValidation passes for the various permission request and grant messages and their scopes
    describe('ensure loaded scope properties for permission requests are processed', () => {
      it('MessagesQuery', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const bob = await TestDataGenerator.generateDidKeyPersona();

        // create a permission grant with protocol
        const messagesQueryPermissions = await PermissionsProtocol.createGrant({
          signer      : Jws.createSigner(alice),
          grantedTo   : bob.did,
          dateExpires : Time.createOffsetTimestamp({ seconds: 100 }),
          description : 'Requesting to query from Alice test-context',
          scope       : {
            interface : DwnInterfaceName.Messages,
            method    : DwnMethodName.Query,
            protocol  : 'https://example.com/protocol/test',
          }
        });

        const messagesQueryPermissionsReply = await dwn.processMessage(alice.did, messagesQueryPermissions.recordsWrite.message, {
          dataStream: DataStream.fromBytes(messagesQueryPermissions.permissionGrantBytes)
        });
        expect(messagesQueryPermissionsReply.status.code).to.equal(202);
      });

      it('MessagesRead', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const bob = await TestDataGenerator.generateDidKeyPersona();

        // create a permission grant with protocol
        const messagesReadPermissions = await PermissionsProtocol.createGrant({
          signer      : Jws.createSigner(alice),
          grantedTo   : bob.did,
          dateExpires : Time.createOffsetTimestamp({ seconds: 100 }),
          description : 'Requesting to read from Alice test-context',
          scope       : {
            interface : DwnInterfaceName.Messages,
            method    : DwnMethodName.Read,
            protocol  : 'https://example.com/protocol/test',
          }
        });

        const messagesReadPermissionsReply = await dwn.processMessage(alice.did, messagesReadPermissions.recordsWrite.message, {
          dataStream: DataStream.fromBytes(messagesReadPermissions.permissionGrantBytes)
        });
        expect(messagesReadPermissionsReply.status.code).to.equal(202);
      });

      it('MessagesSubscribe', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const bob = await TestDataGenerator.generateDidKeyPersona();

        // create a permission grant with protocol
        const messagesSubscribePermissions = await PermissionsProtocol.createGrant({
          signer      : Jws.createSigner(alice),
          grantedTo   : bob.did,
          dateExpires : Time.createOffsetTimestamp({ seconds: 100 }),
          description : 'Requesting to subscribe from Alice test-context',
          scope       : {
            interface : DwnInterfaceName.Messages,
            method    : DwnMethodName.Subscribe,
            protocol  : 'https://example.com/protocol/test',
          }
        });

        const messagesSubscribePermissionsReply = await dwn.processMessage(alice.did, messagesSubscribePermissions.recordsWrite.message, {
          dataStream: DataStream.fromBytes(messagesSubscribePermissions.permissionGrantBytes)
        });
        expect(messagesSubscribePermissionsReply.status.code).to.equal(202);
      });

      it('RecordsDelete', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const bob = await TestDataGenerator.generateDidKeyPersona();

        // create a permission grant with protocol and contextId
        const withContextId = await PermissionsProtocol.createGrant({
          signer      : Jws.createSigner(alice),
          grantedTo   : bob.did,
          dateExpires : Time.createOffsetTimestamp({ seconds: 100 }),
          description : 'Requesting to delete from Alice test-context',
          scope       : {
            interface : DwnInterfaceName.Records,
            method    : DwnMethodName.Delete,
            protocol  : 'https://example.com/protocol/test',
            contextId : 'test-context'
          }
        });

        const withContextIdReply = await dwn.processMessage(alice.did, withContextId.recordsWrite.message, {
          dataStream: DataStream.fromBytes(withContextId.permissionGrantBytes)
        });
        expect(withContextIdReply.status.code).to.equal(202);

        // create a permission request with protocol and protocolPath
        const withProtocolPath = await PermissionsProtocol.createGrant({
          signer      : Jws.createSigner(alice),
          grantedTo   : bob.did,
          dateExpires : Time.createOffsetTimestamp({ seconds: 100 }),
          description : 'Requesting to delete from Alice foo/bar',
          scope       : {
            interface    : DwnInterfaceName.Records,
            method       : DwnMethodName.Delete,
            protocol     : 'https://example.com/protocol/test',
            protocolPath : 'foo/bar'
          }
        });

        const withProtocolPathReply = await dwn.processMessage(alice.did, withProtocolPath.recordsWrite.message, {
          dataStream: DataStream.fromBytes(withProtocolPath.permissionGrantBytes)
        });
        expect(withProtocolPathReply.status.code).to.equal(202);
      });

      it('RecordsQuery', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const bob = await TestDataGenerator.generateDidKeyPersona();

        // create a permission grant with protocol and contextId scope
        const withContextId = await PermissionsProtocol.createGrant({
          signer      : Jws.createSigner(alice),
          grantedTo   : bob.did,
          dateExpires : Time.createOffsetTimestamp({ seconds: 100 }),
          description : 'Requesting to query from Alice test-context',
          delegated   : true,
          scope       : {
            interface : DwnInterfaceName.Records,
            method    : DwnMethodName.Query,
            protocol  : 'https://example.com/protocol/test',
            contextId : 'test-context'
          }
        });

        const withContextIdReply = await dwn.processMessage(alice.did, withContextId.recordsWrite.message, {
          dataStream: DataStream.fromBytes(withContextId.permissionGrantBytes)
        });
        expect(withContextIdReply.status.code).to.equal(202);

        // create a permission request with protocol and protocolPath scope
        const withProtocolPath = await PermissionsProtocol.createRequest({
          signer      : Jws.createSigner(bob),
          description : 'Requesting to query from Alice foo/bar',
          delegated   : true,
          scope       : {
            interface    : DwnInterfaceName.Records,
            method       : DwnMethodName.Query,
            protocol     : 'https://example.com/protocol/test',
            protocolPath : 'foo/bar'
          }
        });

        const withProtocolPathReply = await dwn.processMessage(bob.did, withProtocolPath.recordsWrite.message, {
          dataStream: DataStream.fromBytes(withProtocolPath.permissionRequestBytes)
        });
        expect(withProtocolPathReply.status.code).to.equal(202);
      });

      it('RecordsRead', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const bob = await TestDataGenerator.generateDidKeyPersona();

        // create a permission grant with protocol and contextId scope
        const withContextId = await PermissionsProtocol.createGrant({
          signer      : Jws.createSigner(alice),
          grantedTo   : bob.did,
          dateExpires : Time.createOffsetTimestamp({ seconds: 100 }),
          description : 'Requesting to read to Alice test-context',
          delegated   : true,
          scope       : {
            interface : DwnInterfaceName.Records,
            method    : DwnMethodName.Read,
            protocol  : 'https://example.com/protocol/test',
            contextId : 'test-context'
          }
        });

        const withContextIdReply = await dwn.processMessage(alice.did, withContextId.recordsWrite.message, {
          dataStream: DataStream.fromBytes(withContextId.permissionGrantBytes)
        });
        expect(withContextIdReply.status.code).to.equal(202);

        // create a permission request with protocol and protocolPath scope
        const withProtocolPath = await PermissionsProtocol.createGrant({
          signer      : Jws.createSigner(alice),
          grantedTo   : bob.did,
          dateExpires : Time.createOffsetTimestamp({ seconds: 100 }),
          description : 'Requesting to read to Alice foo/bar',
          delegated   : true,
          scope       : {
            interface    : DwnInterfaceName.Records,
            method       : DwnMethodName.Read,
            protocol     : 'https://example.com/protocol/test',
            protocolPath : 'foo/bar'
          }
        });

        const withProtocolPathReply = await dwn.processMessage(alice.did, withProtocolPath.recordsWrite.message, {
          dataStream: DataStream.fromBytes(withProtocolPath.permissionGrantBytes)
        });
        expect(withProtocolPathReply.status.code).to.equal(202);
      });

      it('RecordsSubscribe', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const bob = await TestDataGenerator.generateDidKeyPersona();

        // create a permission grant with protocol and contextId scope
        const withContextId = await PermissionsProtocol.createGrant({
          signer      : Jws.createSigner(alice),
          grantedTo   : bob.did,
          dateExpires : Time.createOffsetTimestamp({ seconds: 100 }),
          description : 'Requesting to subscribe to Alice test-context',
          delegated   : true,
          scope       : {
            interface : DwnInterfaceName.Records,
            method    : DwnMethodName.Subscribe,
            protocol  : 'https://example.com/protocol/test',
            contextId : 'test-context'
          }
        });

        const withContextIdReply = await dwn.processMessage(alice.did, withContextId.recordsWrite.message, {
          dataStream: DataStream.fromBytes(withContextId.permissionGrantBytes)
        });
        expect(withContextIdReply.status.code).to.equal(202);

        // create a permission request with protocol and protocolPath scope
        const withProtocolPath = await PermissionsProtocol.createGrant({
          signer      : Jws.createSigner(alice),
          grantedTo   : bob.did,
          dateExpires : Time.createOffsetTimestamp({ seconds: 100 }),
          description : 'Requesting to subscribe to Alice foo/bar',
          delegated   : true,
          scope       : {
            interface    : DwnInterfaceName.Records,
            method       : DwnMethodName.Subscribe,
            protocol     : 'https://example.com/protocol/test',
            protocolPath : 'foo/bar'
          }
        });

        const withProtocolPathReply = await dwn.processMessage(alice.did, withProtocolPath.recordsWrite.message, {
          dataStream: DataStream.fromBytes(withProtocolPath.permissionGrantBytes)
        });
        expect(withProtocolPathReply.status.code).to.equal(202);
      });

      it('RecordsWrite', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const bob = await TestDataGenerator.generateDidKeyPersona();

        // create a permission grant with protocol and contextId scope
        const withContextId = await PermissionsProtocol.createGrant({
          signer      : Jws.createSigner(alice),
          grantedTo   : bob.did,
          dateExpires : Time.createOffsetTimestamp({ seconds: 100 }),
          description : 'Requesting to write to Alice test-context',
          delegated   : true,
          scope       : {
            interface : DwnInterfaceName.Records,
            method    : DwnMethodName.Write,
            protocol  : 'https://example.com/protocol/test',
            contextId : 'test-context'
          }
        });

        const withContextIdReply = await dwn.processMessage(alice.did, withContextId.recordsWrite.message, {
          dataStream: DataStream.fromBytes(withContextId.permissionGrantBytes)
        });
        expect(withContextIdReply.status.code).to.equal(202);

        // create a permission request with protocol and protocolPath scope
        const withProtocolPath = await PermissionsProtocol.createGrant({
          signer      : Jws.createSigner(alice),
          grantedTo   : bob.did,
          dateExpires : Time.createOffsetTimestamp({ seconds: 100 }),
          description : 'Requesting to write to Alice foo/bar',
          delegated   : true,
          scope       : {
            interface    : DwnInterfaceName.Records,
            method       : DwnMethodName.Write,
            protocol     : 'https://example.com/protocol/test',
            protocolPath : 'foo/bar'
          }
        });

        const withProtocolPathReply = await dwn.processMessage(alice.did, withProtocolPath.recordsWrite.message, {
          dataStream: DataStream.fromBytes(withProtocolPath.permissionGrantBytes)
        });
        expect(withProtocolPathReply.status.code).to.equal(202);
      });

      it('ProtocolsQuery', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const bob = await TestDataGenerator.generateDidKeyPersona();

        // create a permission grant with protocol query that is unrestricted
        const protocolQueryPermissions = await PermissionsProtocol.createGrant({
          signer      : Jws.createSigner(alice),
          grantedTo   : bob.did,
          dateExpires : Time.createOffsetTimestamp({ seconds: 100 }),
          description : 'Requesting to query from Alice test-context',
          scope       : {
            interface : DwnInterfaceName.Protocols,
            method    : DwnMethodName.Query,
          }
        });

        const protocolQueryPermissionsReply = await dwn.processMessage(alice.did, protocolQueryPermissions.recordsWrite.message, {
          dataStream: DataStream.fromBytes(protocolQueryPermissions.permissionGrantBytes)
        });
        expect(protocolQueryPermissionsReply.status.code).to.equal(202);
      });
    });

    describe('validateScopeAndTags', async () => {
      it('should be called for a Request or Grant record', async () => {
        // spy on `validateScope`
        const validateScopeSpy = sinon.spy(PermissionsProtocol as any, 'validateScopeAndTags');

        const alice = await TestDataGenerator.generateDidKeyPersona();
        const bob = await TestDataGenerator.generateDidKeyPersona();

        const permissionScope: PermissionScope = {
          interface : DwnInterfaceName.Records,
          method    : DwnMethodName.Write,
          protocol  : 'https://example.com/protocol/test'
        };

        // create a request
        const requestToAlice = await PermissionsProtocol.createRequest({
          signer      : Jws.createSigner(bob),
          description : `Requesting to write to Alice's DWN`,
          delegated   : false,
          scope       : permissionScope
        });
        const requestToAliceReply = await dwn.processMessage(
          alice.did,
          requestToAlice.recordsWrite.message,
          { dataStream: DataStream.fromBytes(requestToAlice.permissionRequestBytes) }
        );
        expect(requestToAliceReply.status.code).to.equal(202);
        expect(validateScopeSpy.calledOnce).to.be.true;

        // create a grant
        const grantedToBob = await PermissionsProtocol.createGrant({
          signer      : Jws.createSigner(alice),
          dateExpires : Time.createOffsetTimestamp({ seconds: 100 }),
          description : 'Allow Bob to write',
          grantedTo   : bob.did,
          scope       : permissionScope
        });

        const grantWriteReply = await dwn.processMessage(
          alice.did,
          grantedToBob.recordsWrite.message,
          { dataStream: DataStream.fromBytes(grantedToBob.permissionGrantBytes) }
        );
        expect(grantWriteReply.status.code).to.equal(202);
        expect(validateScopeSpy.calledTwice).to.be.true; // called twice, once for the request and once for the grant
      });

      it('should throw if the scope is a RecordsPermissionScope and a protocol tag is not defined on the Request and Grant record', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();

        const permissionScope: PermissionScope = {
          interface : DwnInterfaceName.Records,
          method    : DwnMethodName.Write,
          protocol  : 'https://example.com/protocol/test'
        };

        // create a permission request without a protocol tag
        const requestWrite = await TestDataGenerator.generateRecordsWrite({
          author       : alice,
          protocol     : PermissionsProtocol.uri,
          protocolPath : PermissionsProtocol.requestPath,
          data         : Encoder.stringToBytes(JSON.stringify({})),
          tags         : { someTag: 'someValue' } // not a protocol tag
        });

        expect(
          () => PermissionsProtocol['validateScopeAndTags'](permissionScope, requestWrite.message)
        ).to.throw(DwnErrorCode.PermissionsProtocolValidateScopeMissingProtocolTag);

        // create a permission grant without a protocol tag
        const grantRecordsWrite = await TestDataGenerator.generateRecordsWrite({
          author       : alice,
          protocol     : PermissionsProtocol.uri,
          protocolPath : PermissionsProtocol.grantPath,
          data         : Encoder.stringToBytes(JSON.stringify({})),
          tags         : { someTag: 'someValue' } // not a protocol tag
        });

        expect(
          () => PermissionsProtocol['validateScopeAndTags'](permissionScope, grantRecordsWrite.message)
        ).to.throw(DwnErrorCode.PermissionsProtocolValidateScopeMissingProtocolTag);
      });

      it('should throw if the scope is a RecordsPermissionScope and the Request and Grant record has no tags', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();

        const permissionScope: PermissionScope = {
          interface : DwnInterfaceName.Records,
          method    : DwnMethodName.Write,
          protocol  : 'https://example.com/protocol/test'
        };

        // create a permission request without a protocol tag
        const requestWrite = await TestDataGenerator.generateRecordsWrite({
          author       : alice,
          protocol     : PermissionsProtocol.uri,
          protocolPath : PermissionsProtocol.requestPath,
          data         : Encoder.stringToBytes(JSON.stringify({}))
        });

        expect(
          () => PermissionsProtocol['validateScopeAndTags'](permissionScope, requestWrite.message)
        ).to.throw(DwnErrorCode.PermissionsProtocolValidateScopeMissingProtocolTag);

        // create a permission grant without a protocol tag
        const grantRecordsWrite = await TestDataGenerator.generateRecordsWrite({
          author       : alice,
          protocol     : PermissionsProtocol.uri,
          protocolPath : PermissionsProtocol.grantPath,
          data         : Encoder.stringToBytes(JSON.stringify({})),
        });

        expect(
          () => PermissionsProtocol['validateScopeAndTags'](permissionScope, grantRecordsWrite.message)
        ).to.throw(DwnErrorCode.PermissionsProtocolValidateScopeMissingProtocolTag);
      });

      it('should throw if the protocol tag in the Request and Grant record does not match the protocol defined in the scope', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();

        // create a permission scope to test against
        const permissionScope: PermissionScope = {
          interface : DwnInterfaceName.Records,
          method    : DwnMethodName.Write,
          protocol  : 'https://example.com/protocol/test'
        };

        // create a permission request with a protocol tag that does not match the scope
        const requestWrite = await TestDataGenerator.generateRecordsWrite({
          author       : alice,
          protocol     : PermissionsProtocol.uri,
          protocolPath : PermissionsProtocol.requestPath,
          data         : Encoder.stringToBytes(JSON.stringify({ })),
          tags         : { protocol: 'https://example.com/protocol/invalid' }
        });

        expect(
          () => PermissionsProtocol['validateScopeAndTags'](permissionScope, requestWrite.message)
        ).to.throw(DwnErrorCode.PermissionsProtocolValidateScopeProtocolMismatch);

        // create a permission grant with a protocol tag that does not match the scope
        const grantRecordsWrite = await TestDataGenerator.generateRecordsWrite({
          author       : alice,
          protocol     : PermissionsProtocol.uri,
          protocolPath : PermissionsProtocol.grantPath,
          data         : Encoder.stringToBytes(JSON.stringify({ })),
          tags         : { protocol: 'https://example.com/protocol/invalid' }
        });

        expect(
          () => PermissionsProtocol['validateScopeAndTags'](permissionScope, grantRecordsWrite.message)
        ).to.throw(DwnErrorCode.PermissionsProtocolValidateScopeProtocolMismatch);
      });

      it('should throw if protocolPath and contextId are both defined in the scope for a Request and Grant record', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();

        const permissionScope: PermissionScope = {
          interface    : DwnInterfaceName.Records,
          method       : DwnMethodName.Write,
          protocol     : 'https://example.com/protocol/test',
          protocolPath : 'test/path',
          contextId    : 'test-context'
        };

        // create a permission request with a scope that has both protocolPath and contextId
        const requestRecordsWrite = await TestDataGenerator.generateRecordsWrite({
          author       : alice,
          protocol     : PermissionsProtocol.uri,
          protocolPath : PermissionsProtocol.requestPath,
          data         : Encoder.stringToBytes(JSON.stringify({ })),
          tags         : { protocol: 'https://example.com/protocol/test' }
        });

        expect(
          () => PermissionsProtocol['validateScopeAndTags'](permissionScope, requestRecordsWrite.message)
        ).to.throw(DwnErrorCode.PermissionsProtocolValidateScopeContextIdProhibitedProperties);

        // create a permission grant with a scope that has both protocolPath and contextId
        const grantRecordsWrite = await TestDataGenerator.generateRecordsWrite({
          author       : alice,
          protocol     : PermissionsProtocol.uri,
          protocolPath : PermissionsProtocol.grantPath,
          data         : Encoder.stringToBytes(JSON.stringify({ })),
          tags         : { protocol: 'https://example.com/protocol/test' }
        });

        expect(
          () => PermissionsProtocol['validateScopeAndTags'](permissionScope, grantRecordsWrite.message)
        ).to.throw(DwnErrorCode.PermissionsProtocolValidateScopeContextIdProhibitedProperties);
      });
    });
  });
}
