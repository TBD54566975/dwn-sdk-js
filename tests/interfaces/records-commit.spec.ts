
import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';
import { RecordsCommit } from '../../src/interfaces/records-commit.js'
import { CommitStrategy, type RecordsCommitMessage } from '../../src/types/records-types.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { Jws } from '../../src/index.js';

chai.use(chaiAsPromised);

describe('RecordsCommit', () => {
  describe('create()', () => {
    it('should be able to create', async () => {
       // testing `create()` first
       const alice = await TestDataGenerator.generatePersona();

       const options = {
         data                        : TestDataGenerator.randomBytes(10),
         dataFormat                  : 'application/json',
         dateCreated                 : '2022-10-14T10:20:30.405060Z',
         recordId                    : await TestDataGenerator.randomCborSha256Cid(),
         parentId                    : await TestDataGenerator.randomCborSha256Cid(),
         commitStrategy              : CommitStrategy.JSONMerge,
         authorizationSignatureInput : Jws.createSignatureInput(alice)
       };
       const recordsCommit = await RecordsCommit.create(options);

       const message = recordsCommit.message as RecordsCommitMessage;
 
       expect(message.descriptor.parentId).to.equal(options.parentId);
       expect(message.recordId).to.equal(options.recordId);
       expect(message.descriptor.commitStrategy).to.equal(options.commitStrategy);
    });
  });
});