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

    it.only('should support permission management through use of Request, Grants, and Revocations', async () => {
      // scenario:
      // 1. Verify anyone (Bob) can send a permission request to Alice
      // 2. Alice queries her DWN for new permission requests
      // 3. Verify a non-owner cannot create a grant for Bob in Alice's DWN
      // 4. Alice creates a permission grant for Bob in her DWN
      // 5. Verify that Bob can read the permission grant from Alice's DWN (even though Alice can also send it directly to Bob)
      // 6. Verify that any third-party can fetch revocation of the grant and find it is still active (not revoked)
      // 7. Verify that non-owner cannot revoke the grant
      // 8. Alice revokes the permission grant for Bob
      // 9. Verify that any third-party can fetch the revocation status of the permission grant

      const alice = await TestDataGenerator.generateDidKeyPersona();
      const bob = await TestDataGenerator.generateDidKeyPersona();

      // 1. Verify anyone (Bob) can send a permission request to Alice
      const permissionScope: PermissionScope = {
        interface : DwnInterfaceName.Records,
        method    : DwnMethodName.Write
      };
      const requestToAlice = PermissionsProtocol.createRequest({
        description : `Requesting to write to Alice's DWN`,
        grantedBy   : alice.did,
        grantedTo   : bob.did,
        scope       : permissionScope
      });

      const requestBytes = Encoder.objectToBytes(requestToAlice);
      const requestWrite = await RecordsWrite.create({
        signer       : Jws.createSigner(bob),
        protocol     : PermissionsProtocol.uri,
        protocolPath : PermissionsProtocol.requestPath,
        dataFormat   : 'application/json',
        data         : requestBytes,
      });

      const requestWriteReply = await dwn.processMessage(alice.did, requestWrite.message, { dataStream: DataStream.fromBytes(requestBytes) });
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
      expect(requestFromBob.recordId).to.equal(requestWrite.message.recordId);

      // 3. Verify a non-owner cannot create a grant for Bob in Alice's DWN
      const decodedRequest = PermissionsProtocol.parseRequest(requestFromBob.encodedData!);
      const grantForBob = PermissionsProtocol.createGrant({
        dateExpires : Time.createOffsetTimestamp({ seconds: 100 }),
        description : 'Allow Bob to write',
        grantedBy   : alice.did,
        grantedTo   : bob.did,
        scope       : decodedRequest.scope
      });

      const grantBytes = Encoder.objectToBytes(grantForBob);
      const unauthorizedGrantWrite = await RecordsWrite.create({
        signer       : Jws.createSigner(bob),
        recipient    : bob.did,
        protocol     : PermissionsProtocol.uri,
        protocolPath : PermissionsProtocol.grantPath,
        dataFormat   : 'application/json',
        data         : grantBytes,
      });

      const unauthorizedGrantWriteReply
        = await dwn.processMessage(alice.did, unauthorizedGrantWrite.message, { dataStream: DataStream.fromBytes(grantBytes) });
      expect(unauthorizedGrantWriteReply.status.code).to.equal(401);
      expect(unauthorizedGrantWriteReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationActionNotAllowed);

      // 4. Alice creates a permission grant for Bob in her DWN
      const grantWrite = await RecordsWrite.create({
        signer       : Jws.createSigner(alice),
        recipient    : bob.did,
        protocol     : PermissionsProtocol.uri,
        protocolPath : PermissionsProtocol.grantPath,
        dataFormat   : 'application/json',
        data         : grantBytes,
      });

      const grantWriteReply = await dwn.processMessage(alice.did, grantWrite.message, { dataStream: DataStream.fromBytes(grantBytes) });
      expect(grantWriteReply.status.code).to.equal(202);

      // 5. Verify that Bob can read the permission grant from Alice's DWN (even though Alice can also send it directly to Bob)
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
      expect(grantFromBob.recordId).to.equal(grantWrite.message.recordId);

      // 6. Verify that any third-party can fetch revocation of the grant and find it is still active (not revoked)
      const revocationRead = await RecordsRead.create({
        signer : Jws.createSigner(bob),
        filter : {
          contextId    : grantWrite.message.contextId,
          protocolPath : PermissionsProtocol.revocationPath
        }
      });

      const revocationReadReply = await dwn.processMessage(alice.did, revocationRead.message);
      expect(revocationReadReply.status.code).to.equal(404);

      // 7. Verify that non-owner cannot revoke the grant
      const revocation = PermissionsProtocol.createRevocation({
        permissionGrantId : grantWrite.message.recordId,
        dateRevoked       : Time.getCurrentTimestamp()
      });

      const revokeBytes = Encoder.objectToBytes(revocation);
      const unauthorizedRevokeWrite = await RecordsWrite.create({
        parentContextId : grantWrite.message.contextId,
        signer          : Jws.createSigner(bob),
        protocol        : PermissionsProtocol.uri,
        protocolPath    : PermissionsProtocol.revocationPath,
        dataFormat      : 'application/json',
        data            : revokeBytes,
      });

      const unauthorizedRevokeWriteReply = await dwn.processMessage(
        alice.did,
        unauthorizedRevokeWrite.message,
        { dataStream: DataStream.fromBytes(revokeBytes) }
      );
      expect(unauthorizedRevokeWriteReply.status.code).to.equal(401);
      expect(unauthorizedGrantWriteReply.status.detail).to.contain(DwnErrorCode.ProtocolAuthorizationActionNotAllowed);

      // 8. Alice revokes the permission grant for Bob
      const revokeWrite = await RecordsWrite.create({
        parentContextId : grantWrite.message.contextId,
        signer          : Jws.createSigner(alice),
        protocol        : PermissionsProtocol.uri,
        protocolPath    : PermissionsProtocol.revocationPath,
        dataFormat      : 'application/json',
        data            : revokeBytes,
      });

      const revokeWriteReply = await dwn.processMessage(alice.did, revokeWrite.message, { dataStream: DataStream.fromBytes(revokeBytes) });
      expect(revokeWriteReply.status.code).to.equal(202);

      // 9. Verify that any third-party can fetch the revocation status of the permission grant
      const revocationReadReply2 = await dwn.processMessage(alice.did, revocationRead.message);
      expect(revocationReadReply2.status.code).to.equal(200);
      expect(revocationReadReply2.record?.recordId).to.equal(revokeWrite.message.recordId);
    });
  });
}
