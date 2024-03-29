import type { DidResolver } from '@web5/dids';
import type { EventStream } from '../../src/types/subscriptions.js';
import type { PermissionScope } from '../../src/index.js';
import type { DataStore, EventLog, MessageStore } from '../../src/index.js';

import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import chai, { expect } from 'chai';

import { DataStream } from '../../src/utils/data-stream.js';
import { Dwn } from '../../src/dwn.js';
import { Jws } from '../../src/utils/jws.js';
import { PermissionsProtocol } from '../../src/protocols/permissions.js';
import { RecordsRead } from '../../src/interfaces/records-read.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestEventStream } from '../test-event-stream.js';
import { TestStores } from '../test-stores.js';
import { DidKey, UniversalResolver } from '@web5/dids';
import { DwnErrorCode, DwnInterfaceName, DwnMethodName, RecordsQuery, Time } from '../../src/index.js';

chai.use(chaiAsPromised);

export function testPermissions(): void {
  describe('permissions', async () => {
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
        protocol  : `any-protocol`,
        schema    : `any-schema`
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
        grantId     : grantWrite.recordsWrite.message.recordId,
        dateRevoked : Time.getCurrentTimestamp()
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
        grantId     : grantWrite.recordsWrite.message.recordId,
        dateRevoked : Time.getCurrentTimestamp()
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
  });
}
