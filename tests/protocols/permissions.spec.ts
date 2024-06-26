import type { MessageStore } from '../../src/index.js';

import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import chai, { expect } from 'chai';

import { Jws } from '../../src/utils/jws.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestStores } from '../test-stores.js';
import { DwnErrorCode, DwnInterfaceName, DwnMethodName, Encoder, PermissionGrant, PermissionRequest, PermissionsProtocol, Time } from '../../src/index.js';

chai.use(chaiAsPromised);

describe('PermissionsProtocol', () => {
  let messageStore: MessageStore;

  // important to follow the `before` and `after` pattern to initialize and clean the stores in tests
  // so that different test suites can reuse the same backend store for testing
  before(async () => {

    const stores = TestStores.get();
    messageStore = stores.messageStore;
    await messageStore.open();
  });


  afterEach(async () => {
    // restores all fakes, stubs, spies etc. not restoring causes a memory leak.
    // more info here: https://sinonjs.org/releases/v13/general-setup/
    sinon.restore();
    await messageStore.clear();
  });

  after(async () => {
    await messageStore.close();
  });

  describe('getScopeFromPermissionRecord', () => {
    it('should get scope from a permission request record', async () => {
      const alice = await TestDataGenerator.generateDidKeyPersona();
      const bob = await TestDataGenerator.generateDidKeyPersona();

      // bob creates a request
      const permissionRequest = await PermissionsProtocol.createRequest({
        signer    : Jws.createSigner(bob),
        delegated : true,
        scope     : {
          interface : DwnInterfaceName.Records,
          method    : DwnMethodName.Query,
          protocol  : 'https://example.com/protocol/test'
        }
      });

      const request = await PermissionRequest.parse(permissionRequest.dataEncodedMessage);

      const scope = await PermissionsProtocol.getScopeFromPermissionRecord(
        alice.did,
        messageStore,
        permissionRequest.dataEncodedMessage
      );

      expect(scope).to.deep.equal(request.scope);
    });

    it('should get scope from a permission grant record', async () => {
      const alice = await TestDataGenerator.generateDidKeyPersona();
      const bob = await TestDataGenerator.generateDidKeyPersona();

      const { dataEncodedMessage: grantMessage } = await PermissionsProtocol.createGrant({
        signer : Jws.createSigner(alice),
        scope  : {
          interface : DwnInterfaceName.Records,
          method    : DwnMethodName.Write,
          protocol  : 'https://example.com/protocol/test'
        },
        grantedTo   : bob.did,
        dateExpires : Time.createOffsetTimestamp({ seconds: 100 })
      });

      const grant = await PermissionGrant.parse(grantMessage);

      const scope = await PermissionsProtocol.getScopeFromPermissionRecord(
        alice.did,
        messageStore,
        grantMessage
      );

      expect(scope).to.deep.equal(grant.scope);
    });

    it('should get scope from a permission revocation record', async () => {
      const alice = await TestDataGenerator.generateDidKeyPersona();
      const bob = await TestDataGenerator.generateDidKeyPersona();

      const { dataEncodedMessage: grantMessage, recordsWrite: grantRecordsWrite } = await PermissionsProtocol.createGrant({
        signer : Jws.createSigner(alice),
        scope  : {
          interface : DwnInterfaceName.Records,
          method    : DwnMethodName.Write,
          protocol  : 'https://example.com/protocol/test'
        },
        grantedTo   : bob.did,
        dateExpires : Time.createOffsetTimestamp({ seconds: 100 })
      });

      // store grant in the messageStore so that that the original grant can be retrieved within `getScopeFromPermissionRecord`
      const indexes = await grantRecordsWrite.constructIndexes(true);
      await messageStore.put(alice.did, grantMessage, indexes);

      const grant = await PermissionGrant.parse(grantMessage);

      const revocation = await PermissionsProtocol.createRevocation({
        signer : Jws.createSigner(alice),
        grant  : grant
      });

      const scope = await PermissionsProtocol.getScopeFromPermissionRecord(
        alice.did,
        messageStore,
        revocation.dataEncodedMessage
      );

      expect(scope).to.deep.equal(grant.scope);
    });

    it('should throw if there is no grant for the revocation', async () => {
      const alice = await TestDataGenerator.generateDidKeyPersona();
      const bob = await TestDataGenerator.generateDidKeyPersona();

      const { dataEncodedMessage: grantMessage } = await PermissionsProtocol.createGrant({
        signer : Jws.createSigner(alice),
        scope  : {
          interface : DwnInterfaceName.Records,
          method    : DwnMethodName.Write,
          protocol  : 'https://example.com/protocol/test'
        },
        grantedTo   : bob.did,
        dateExpires : Time.createOffsetTimestamp({ seconds: 100 })
      });

      // notice the grant is not stored in the message store
      const grant = await PermissionGrant.parse(grantMessage);

      const revocation = await PermissionsProtocol.createRevocation({
        signer : Jws.createSigner(alice),
        grant  : grant
      });

      await expect(PermissionsProtocol.getScopeFromPermissionRecord(
        alice.did,
        messageStore,
        revocation.dataEncodedMessage
      )).to.eventually.be.rejectedWith(DwnErrorCode.GrantAuthorizationGrantMissing);
    });

    it('should throw if the message is not a permission protocol record', async () => {
      const recordsWriteMessage = await TestDataGenerator.generateRecordsWrite();
      const dataEncodedMessage = {
        ...recordsWriteMessage.message,
        encodedData: Encoder.bytesToBase64Url(recordsWriteMessage.dataBytes!)
      };

      await expect(PermissionsProtocol.getScopeFromPermissionRecord(
        recordsWriteMessage.author.did,
        messageStore,
        dataEncodedMessage
      )).to.eventually.be.rejectedWith(DwnErrorCode.PermissionsProtocolGetScopeInvalidProtocol);
    });
  });
});
