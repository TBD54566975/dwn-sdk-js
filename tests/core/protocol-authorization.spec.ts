import { DwnErrorCode } from '../../src/core/dwn-error.js';
import { expect } from 'chai';
import { MessageStoreLevel } from '../../src/index.js';
import { ProtocolAuthorization } from '../../src/core/protocol-authorization.js';
import { TestDataGenerator } from '../utils/test-data-generator.js';

import sinon from 'sinon';

describe('ProtocolAuthorization', () => {
  beforeEach(() => {
    sinon.restore();
  });

  describe('authorizeWrite()', () => {
    it('should throw if message references non-existent parent', async () => {
      const alice = await TestDataGenerator.generateDidKeyPersona();

      const { recordsWrite } = await TestDataGenerator.generateRecordsWrite({
        author          : alice,
        parentContextId : 'nonExistentParent',
      });

      // stub the message store
      const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);
      messageStoreStub.query.resolves({ messages: [] }); // simulate parent not in message store

      await expect(ProtocolAuthorization.authorizeWrite(alice.did, recordsWrite, messageStoreStub)).to.be.rejectedWith(
        DwnErrorCode.ProtocolAuthorizationParentNotFoundConstructingRecordChain
      );
    });
  });

  describe('getActionsSeekingARuleMatch()', () => {
    it('should return empty array if unknown message method type is given', async () => {
      const alice = await TestDataGenerator.generateDidKeyPersona();

      const deliberatelyCraftedInvalidMessage = {
        message: {
          descriptor: {
            method: 'invalid-method'
          },
        }
      } as any;

      const messageStoreStub = sinon.createStubInstance(MessageStoreLevel);
      expect(ProtocolAuthorization['getActionsSeekingARuleMatch'](alice.did, deliberatelyCraftedInvalidMessage, messageStoreStub)).to.be.empty;
    });
  });
});