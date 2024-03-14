import type { EventStream } from '../../src/types/subscriptions.js';
import type { DataStore, EventLog, MessageStore } from '../../src/index.js';

import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import chai, { expect } from 'chai';

import { DidKey } from '@web5/dids';
import { DidResolver } from '@web5/dids';
import { Dwn } from '../../src/dwn.js';
import { Jws } from '../../src/utils/jws.js';
import { RecordsRead } from '../../src/interfaces/records-read.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { TestEventStream } from '../test-event-stream.js';
import { TestStores } from '../test-stores.js';

chai.use(chaiAsPromised);

export function testRecordsTags(): void {
  describe('Records Tags', () => {
    let didResolver: DidResolver;
    let messageStore: MessageStore;
    let dataStore: DataStore;
    let eventLog: EventLog;
    let eventStream: EventStream;
    let dwn: Dwn;

    // important to follow the `before` and `after` pattern to initialize and clean the stores in tests
    // so that different test suites can reuse the same backend store for testing
    before(async () => {
      didResolver = new DidResolver({ didResolvers: [DidKey] });

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

    it('should be able to write tags', async () => {
      const alice = await TestDataGenerator.generateDidKeyPersona();

      // create tags that represent `string[]`, `number[]`, `string`, `number`, or `boolean` values.
      const stringTag = 'string-value';
      const stringArrayTag = [ 'string-value', 'string-value2' ];
      const numberTag = 54566975;
      const numberArrayTag = [ 0, 1 ,2 ];
      const booleanTag = false;

      const tagsRecord1 = await TestDataGenerator.generateRecordsWrite({
        author    : alice,
        published : true,
        schema    : 'post',
        tags      : {
          stringTag,
          numberTag,
          booleanTag,
          stringArrayTag,
          numberArrayTag,
        }
      });

      const tagsRecord1Reply = await dwn.processMessage(alice.did, tagsRecord1.message, { dataStream: tagsRecord1.dataStream });
      expect(tagsRecord1Reply.status.code).to.equal(202);

      // verify the record was written
      const tagsRecord1Read = await RecordsRead.create({
        filter: {
          recordId: tagsRecord1.message.recordId,
        },
        signer: Jws.createSigner(alice)
      });

      const tagsRecord1ReadReply = await dwn.processMessage(alice.did, tagsRecord1Read.message);
      expect(tagsRecord1ReadReply.status.code).to.equal(200);
      expect(tagsRecord1ReadReply.record).to.not.be.undefined;
      expect(tagsRecord1ReadReply.record!.descriptor.tags).to.deep.equal({ stringTag, numberTag, booleanTag, stringArrayTag, numberArrayTag });
    });

    describe('query', async () => {
      it('should be able to query by string match', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const stringTag = 'string-value';

        const tagsRecord1 = await TestDataGenerator.generateRecordsWrite({
          author    : alice,
          published : true,
          schema    : 'post',
          tags      : {
            stringTag,
          }
        });

        const tagsRecord1Reply = await dwn.processMessage(alice.did, tagsRecord1.message, { dataStream: tagsRecord1.dataStream });
        expect(tagsRecord1Reply.status.code).to.equal(202);

        const tagsQueryMatch = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            tags: {
              stringTag: 'string-value'
            }
          }
        });

        const tagsQueryMatchReply = await dwn.processMessage(alice.did, tagsQueryMatch.message);
        expect(tagsQueryMatchReply.status.code).to.equal(200);
        expect(tagsQueryMatchReply.entries?.length).to.equal(1);
        expect(tagsQueryMatchReply.entries![0].recordId).to.equal(tagsRecord1.message.recordId);

        // negative result same tag different value
        let tagsQueryNegative = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            tags: {
              stringTag: 'other-value'
            }
          }
        });
        let tagsQueryNegativeReply = await dwn.processMessage(alice.did, tagsQueryNegative.message);
        expect(tagsQueryNegativeReply.status.code).to.equal(200);
        expect(tagsQueryNegativeReply.entries?.length).to.equal(0);

        // negative result different tag same value
        tagsQueryNegative = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            tags: {
              otherTag: 'string-value'
            }
          }
        });
        tagsQueryNegativeReply = await dwn.processMessage(alice.did, tagsQueryNegative.message);
        expect(tagsQueryNegativeReply.status.code).to.equal(200);
        expect(tagsQueryNegativeReply.entries?.length).to.equal(0);
      });

      it('should be able to query by number match', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();
        const numberTag = 54566975;

        // write a record with a numerical value tag
        const tagsRecord1 = await TestDataGenerator.generateRecordsWrite({
          author    : alice,
          published : true,
          schema    : 'post',
          tags      : {
            numberTag,
          }
        });

        const tagsRecord1Reply = await dwn.processMessage(alice.did, tagsRecord1.message, { dataStream: tagsRecord1.dataStream });
        expect(tagsRecord1Reply.status.code).to.equal(202);

        // do an exact match for the tag value
        const tagsQueryMatch = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            tags: {
              numberTag: 54566975,
            }
          }
        });

        const tagsQueryMatchReply = await dwn.processMessage(alice.did, tagsQueryMatch.message);
        expect(tagsQueryMatchReply.status.code).to.equal(200);
        expect(tagsQueryMatchReply.entries?.length).to.equal(1);
        expect(tagsQueryMatchReply.entries![0].recordId).to.equal(tagsRecord1.message.recordId);

        // negative result same tag different value
        let tagsQueryNegative = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            tags: {
              numberTag: 54566974, // off by one
            }
          }
        });
        let tagsQueryNegativeReply = await dwn.processMessage(alice.did, tagsQueryNegative.message);
        expect(tagsQueryNegativeReply.status.code).to.equal(200);
        expect(tagsQueryNegativeReply.entries?.length).to.equal(0);

        // negative result different tag same value
        tagsQueryNegative = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            tags: {
              otherTag: 54566975,
            }
          }
        });
        tagsQueryNegativeReply = await dwn.processMessage(alice.did, tagsQueryNegative.message);
        expect(tagsQueryNegativeReply.status.code).to.equal(200);
        expect(tagsQueryNegativeReply.entries?.length).to.equal(0);
      });

      it('should be able to query by boolean match', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();

        // write a record with a true boolean value tag
        const tagsRecordTrue = await TestDataGenerator.generateRecordsWrite({
          author    : alice,
          published : true,
          schema    : 'post',
          tags      : {
            booleanTag: true,
          }
        });

        const tagsRecordTrueReply = await dwn.processMessage(alice.did, tagsRecordTrue.message, { dataStream: tagsRecordTrue.dataStream });
        expect(tagsRecordTrueReply.status.code).to.equal(202);

        // write a record with a false boolean value tag
        const tagsRecordFalse = await TestDataGenerator.generateRecordsWrite({
          author    : alice,
          published : true,
          schema    : 'post',
          tags      : {
            booleanTag: false,
          }
        });

        const tagsRecordFalseReply = await dwn.processMessage(alice.did, tagsRecordFalse.message, { dataStream: tagsRecordFalse.dataStream });
        expect(tagsRecordFalseReply.status.code).to.equal(202);

        // do an exact match for the true tag value
        const tagsQueryMatchTrue = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            tags: {
              booleanTag: true
            }
          }
        });

        const tagsQueryMatchTrueReply = await dwn.processMessage(alice.did, tagsQueryMatchTrue.message);
        expect(tagsQueryMatchTrueReply.status.code).to.equal(200);
        expect(tagsQueryMatchTrueReply.entries?.length).to.equal(1);
        expect(tagsQueryMatchTrueReply.entries![0].recordId).to.equal(tagsRecordTrue.message.recordId);

        // do an exact match for the true tag value
        const tagsQueryMatchFalse = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            tags: {
              booleanTag: false
            }
          }
        });

        const tagsQueryMatchFalseReply = await dwn.processMessage(alice.did, tagsQueryMatchFalse.message);
        expect(tagsQueryMatchFalseReply.status.code).to.equal(200);
        expect(tagsQueryMatchFalseReply.entries?.length).to.equal(1);
        expect(tagsQueryMatchFalseReply.entries![0].recordId).to.equal(tagsRecordFalse.message.recordId);

        // negative result
        const tagsQueryNegative = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            tags: {
              otherTag: true,
            }
          }
        });
        const tagsQueryNegativeReply = await dwn.processMessage(alice.did, tagsQueryNegative.message);
        expect(tagsQueryNegativeReply.status.code).to.equal(200);
        expect(tagsQueryNegativeReply.entries?.length).to.equal(0);
      });

      it('should be able to range query by string', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();

        // create four records with different first names
        const aliceRecord = await TestDataGenerator.generateRecordsWrite({
          author    : alice,
          published : true,
          schema    : 'post',
          tags      : {
            firstName: 'alice'
          }
        });

        const bobRecord = await TestDataGenerator.generateRecordsWrite({
          author    : alice,
          published : true,
          schema    : 'post',
          tags      : {
            firstName: 'bob',
          }
        });

        const carolRecord = await TestDataGenerator.generateRecordsWrite({
          author    : alice,
          published : true,
          schema    : 'post',
          tags      : {
            firstName: 'carol',
          }
        });

        const danielRecord = await TestDataGenerator.generateRecordsWrite({
          author    : alice,
          published : true,
          schema    : 'post',
          tags      : {
            firstName: 'daniel',
          }
        });

        const aliceReply = await dwn.processMessage(alice.did, aliceRecord.message, { dataStream: aliceRecord.dataStream });
        expect(aliceReply.status.code).to.equal(202);
        const bobReply = await dwn.processMessage(alice.did, bobRecord.message, { dataStream: bobRecord.dataStream });
        expect(bobReply.status.code).to.equal(202);
        const carolReply = await dwn.processMessage(alice.did, carolRecord.message, { dataStream: carolRecord.dataStream });
        expect(carolReply.status.code).to.equal(202);
        const danielReply = await dwn.processMessage(alice.did, danielRecord.message, { dataStream: danielRecord.dataStream });
        expect(danielReply.status.code).to.equal(202);

        // sanity query for all
        const queryForAll = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            schema: 'post'
          }
        });
        const queryForAllReply = await dwn.processMessage(alice.did, queryForAll.message);
        expect(queryForAllReply.status.code).to.equal(200);
        expect(queryForAllReply.entries?.length).to.equal(4); // all 4 records


        // query for first names that begin with 'a' and 'b'
        const queryForAtoB = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            schema : 'post',
            tags   : {
              firstName: { from: 'a', to: 'b' + '\uffff' } //TODO: Temporary example, leaving TODO here to fail lint
            }
          }
        });
        const queryForAtoBReply = await dwn.processMessage(alice.did, queryForAtoB.message);
        expect(queryForAtoBReply.status.code).to.equal(200);
        expect(queryForAtoBReply.entries?.length).to.equal(2);
        const atobRecordIds = queryForAtoBReply.entries!.map(entry => entry.recordId);
        expect(atobRecordIds).to.have.members([ aliceRecord.message.recordId, bobRecord.message.recordId ]);

        // query for first names that begin with 'c' onward.
        const queryForBtoD = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            schema : 'post',
            tags   : {
              firstName: { from: 'c' } // from 'b' to 'd' inclusive
            }
          }
        });
        const queryForBtoDReply = await dwn.processMessage(alice.did, queryForBtoD.message);
        expect(queryForBtoDReply.status.code).to.equal(200);
        expect(queryForBtoDReply.entries?.length).to.equal(2);
        const btodRecordIds = queryForBtoDReply.entries!.map(entry => entry.recordId);
        expect(btodRecordIds).to.have.members([ carolRecord.message.recordId, danielRecord.message.recordId ]);
      });

      it('should be able to query by string prefix', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();

        // create two records that match the prefix 'string-'
        const tagsRecord1 = await TestDataGenerator.generateRecordsWrite({
          author    : alice,
          published : true,
          schema    : 'post',
          tags      : {
            stringTag: 'string-foo',
          }
        });

        const tagsRecord2 = await TestDataGenerator.generateRecordsWrite({
          author    : alice,
          published : true,
          schema    : 'post',
          tags      : {
            stringTag: 'string-bar',
          }
        });

        const tagsRecord1Reply = await dwn.processMessage(alice.did, tagsRecord1.message, { dataStream: tagsRecord1.dataStream });
        expect(tagsRecord1Reply.status.code).to.equal(202);
        const tagsRecord2Reply = await dwn.processMessage(alice.did, tagsRecord2.message, { dataStream: tagsRecord2.dataStream });
        expect(tagsRecord2Reply.status.code).to.equal(202);

        // control record that has a different prefix
        const tagsRecord3 = await TestDataGenerator.generateRecordsWrite({
          author    : alice,
          published : true,
          schema    : 'post',
          tags      : {
            stringTag: 'zaz-string', // comes after `string-` lexicographically
          }
        });
        const tagsRecord3Reply = await dwn.processMessage(alice.did, tagsRecord3.message, { dataStream: tagsRecord3.dataStream });
        expect(tagsRecord3Reply.status.code).to.equal(202);


        //sanity: a regular range query will return all
        const tagsQueryRange = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            tags: {
              stringTag: { from: 'string-' } // range query instead of prefix
            }
          }
        });

        const tagsQueryRangeReply = await dwn.processMessage(alice.did, tagsQueryRange.message);
        expect(tagsQueryRangeReply.status.code).to.equal(200);
        expect(tagsQueryRangeReply.entries?.length).to.equal(3); // returned all 3 records

        // a prefix search will return only the records matching the prefix
        const tagsQueryMatch = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            tags: {
              stringTag: { prefix: 'string-' }
            }
          }
        });

        const tagsQueryMatchReply = await dwn.processMessage(alice.did, tagsQueryMatch.message);
        expect(tagsQueryMatchReply.status.code).to.equal(200);
        expect(tagsQueryMatchReply.entries?.length).to.equal(2);
        const matchedRecords = tagsQueryMatchReply.entries!.map(entry => entry.recordId);
        expect(matchedRecords).to.have.members([ tagsRecord1.message.recordId, tagsRecord2.message.recordId ]);
      });

      it('should be able to range query by number', async () => {
        const alice = await TestDataGenerator.generateDidKeyPersona();

        // create four records with different test scores
        const aliceRecord = await TestDataGenerator.generateRecordsWrite({
          author    : alice,
          published : true,
          schema    : 'test',
          tags      : {
            firstName : 'alice',
            score     : 75,
          }
        });

        const bobRecord = await TestDataGenerator.generateRecordsWrite({
          author    : alice,
          published : true,
          schema    : 'test',
          tags      : {
            firstName : 'bob',
            score     : 80,
          }
        });

        const carolRecord = await TestDataGenerator.generateRecordsWrite({
          author    : alice,
          published : true,
          schema    : 'test',
          tags      : {
            firstName : 'carol',
            score     : 65,
          }
        });

        const danielRecord = await TestDataGenerator.generateRecordsWrite({
          author    : alice,
          published : true,
          schema    : 'test',
          tags      : {
            firstName : 'daniel',
            score     : 100,
          }
        });

        const aliceReply = await dwn.processMessage(alice.did, aliceRecord.message, { dataStream: aliceRecord.dataStream });
        expect(aliceReply.status.code).to.equal(202);
        const bobReply = await dwn.processMessage(alice.did, bobRecord.message, { dataStream: bobRecord.dataStream });
        expect(bobReply.status.code).to.equal(202);
        const carolReply = await dwn.processMessage(alice.did, carolRecord.message, { dataStream: carolRecord.dataStream });
        expect(carolReply.status.code).to.equal(202);
        const danielReply = await dwn.processMessage(alice.did, danielRecord.message, { dataStream: danielRecord.dataStream });
        expect(danielReply.status.code).to.equal(202);

        // sanity query for all
        const queryForAll = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            schema: 'test'
          }
        });
        const queryForAllReply = await dwn.processMessage(alice.did, queryForAll.message);
        expect(queryForAllReply.status.code).to.equal(200);
        expect(queryForAllReply.entries?.length).to.equal(4); // all 4 records


        // query for all records that received higher than(not including) an 80
        // only one record should match
        const queryForHighGrade = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            schema : 'test',
            tags   : {
              score: { gt: 80 }
            }
          }
        });
        const queryForHighReply = await dwn.processMessage(alice.did, queryForHighGrade.message);
        expect(queryForHighReply.status.code).to.equal(200);
        expect(queryForHighReply.entries?.length).to.equal(1);
        expect(queryForHighReply.entries![0].recordId).to.equal(danielRecord.message.recordId);

        // query for all records that received higher (and including) a 75
        // three records should match
        const queryForPassingGrade = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            schema : 'test',
            tags   : {
              score: { gte: 75 }
            }
          }
        });
        const queryForPassingGradeReply = await dwn.processMessage(alice.did, queryForPassingGrade.message);
        expect(queryForPassingGradeReply.status.code).to.equal(200);
        expect(queryForPassingGradeReply.entries?.length).to.equal(3);
        const passingRecords = queryForPassingGradeReply.entries!.map(entry => entry.recordId);
        expect(passingRecords).to.have.members([ danielRecord.message.recordId, bobRecord.message.recordId, aliceRecord.message.recordId ]);

        // query for poorly performing grades (65 and below, inclusive)
        const queryForPoorGrades = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            schema : 'test',
            tags   : {
              score: { lte: 65 }
            }
          }
        });
        const queryForPoorGradesReply = await dwn.processMessage(alice.did, queryForPoorGrades.message);
        expect(queryForPoorGradesReply.status.code).to.equal(200);
        expect(queryForPoorGradesReply.entries?.length).to.equal(1);
        expect(queryForPoorGradesReply.entries![0].recordId).to.equal(carolRecord.message.recordId);

        // query for passing grades that were not perfect scores
        const queryForRange = await TestDataGenerator.generateRecordsQuery({
          author : alice,
          filter : {
            schema : 'test',
            tags   : {
              score: { lt: 100, gte: 75 }
            }
          }
        });
        const queryForRangeReply = await dwn.processMessage(alice.did, queryForRange.message);
        expect(queryForRangeReply.status.code).to.equal(200);
        expect(queryForRangeReply.entries?.length).to.equal(2);
        const rangeRecords = queryForRangeReply.entries!.map(entry => entry.recordId);
        expect(rangeRecords).to.have.members([ bobRecord.message.recordId, aliceRecord.message.recordId ]);
      });
    });
  });
}