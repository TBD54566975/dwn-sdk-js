import type { SnapshotDefinition } from '../../src/types/snapshots-types.js';

import chaiAsPromised from 'chai-as-promised';
import { getCurrentTimeInHighPrecision } from '../../src/utils/time.js';
import { Jws } from '../../src/utils/jws.js';
import { SnapshotScopeType } from '../../src/types/snapshots-types.js';
import { SnapshotsCreate } from '../../src/interfaces/snapshots-create.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';

import chai, { expect } from 'chai';

chai.use(chaiAsPromised);

describe('SnapshotsCreate', () => {
  describe('create()', () => {
    it('should be able to create a SnapshotCreate message', async () => {
      const alice = await TestDataGenerator.generatePersona();

      const currentTime = getCurrentTimeInHighPrecision();
      const definition: SnapshotDefinition = {
        scope: {
          type               : SnapshotScopeType.Permissions,
          permissionsGrantId : await TestDataGenerator.randomCborSha256Cid()
        },
        messageCids: [
          await TestDataGenerator.randomCborSha256Cid(),
          await TestDataGenerator.randomCborSha256Cid(),
          await TestDataGenerator.randomCborSha256Cid()
        ]
      };

      const snapshotsCreate = await SnapshotsCreate.create({
        messageTimestamp            : currentTime,
        definition,
        authorizationSignatureInput : Jws.createSignatureInput(alice),
      });

      expect(snapshotsCreate.message.descriptor.messageTimestamp).to.equal(currentTime);
    });
  });
});

