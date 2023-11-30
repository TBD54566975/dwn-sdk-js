import { ArrayUtility } from '../../src/utils/array.js';
import { EventLogLevel } from '../../src/event-log/event-log-level.js';
import { Message } from '../../src/core/message.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';

import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import chai, { expect } from 'chai';

chai.use(chaiAsPromised);

let eventLog: EventLogLevel;

describe('EventLogLevel Tests', () => {
  before(async () => {
    eventLog = new EventLogLevel({ location: 'TEST-EVENTLOG' });
    await eventLog.open();
  });

  beforeEach(async () => {
    await eventLog.clear();
  });

  after(async () => {
    await eventLog.close();
  });

  describe('deleteEventsByCid', () => {
    it('deletes all index related data', async () => {
      const { author, message, recordsWrite } = await TestDataGenerator.generateRecordsWrite();
      const messageCid = await Message.getCid(message);
      const index = await recordsWrite.constructRecordsWriteIndexes(true);
      await eventLog.append(author.did, messageCid, index);

      // control
      let result = await eventLog.getEvents(author.did);
      expect(result.length).to.equal(1);
      expect(result[0]).to.equal(await Message.getCid(message));

      const indexLevelDeleteSpy = sinon.spy(eventLog.index, 'delete');
      await eventLog.deleteEventsByCid(author.did, [ messageCid ]);
      indexLevelDeleteSpy.restore();
      expect(indexLevelDeleteSpy.callCount).to.equal(1);

      result = await eventLog.getEvents(author.did);
      expect(result.length).to.equal(0);

      const keysAfterDelete = await ArrayUtility.fromAsyncGenerator(eventLog.index.db.keys());
      expect(keysAfterDelete.length).to.equal(15);
    });
  });

  describe('purgeEventsByCid', () => {
    it('deletes all index related data', async () => {
      const { author, message, recordsWrite } = await TestDataGenerator.generateRecordsWrite();
      const messageCid = await Message.getCid(message);
      const index = await recordsWrite.constructRecordsWriteIndexes(true);
      await eventLog.append(author.did, messageCid, index);

      let keysAfterDelete = await ArrayUtility.fromAsyncGenerator(eventLog.index.db.keys());
      expect(keysAfterDelete.length).to.equal(15);

      const indexLevelPurgeSpy = sinon.spy(eventLog.index, 'purge');
      await eventLog.purgeEventsByCid(author.did, [ messageCid ]);
      indexLevelPurgeSpy.restore();
      expect(indexLevelPurgeSpy.callCount).to.equal(1);

      keysAfterDelete = await ArrayUtility.fromAsyncGenerator(eventLog.index.db.keys());
      expect(keysAfterDelete.length).to.equal(0);
    });
  });
});