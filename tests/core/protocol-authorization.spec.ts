import type { MessageStore } from '../../src/index.js';

import { DwnErrorCode } from '../../src/core/dwn-error.js';
import { expect } from 'chai';
import { ProtocolAuthorization } from '../../src/core/protocol-authorization.js';
import { stubInterface } from 'ts-sinon';
import { TestDataGenerator } from '../utils/test-data-generator.js';

describe('ProtocolAuthorization', () => {
  describe('authorizeWrite()', () => {
    it('should throw if message references non-existent parent', async () => {
      const alice = await TestDataGenerator.generateDidKeyPersona();

      const { recordsWrite } = await TestDataGenerator.generateRecordsWrite({
        author          : alice,
        parentContextId : 'nonExistentParent',
      });

      // stub the message store
      const messageStoreStub = stubInterface<MessageStore>();
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

      const messageStoreStub = stubInterface<MessageStore>();
      expect(ProtocolAuthorization['getActionsSeekingARuleMatch'](alice.did, deliberatelyCraftedInvalidMessage, messageStoreStub)).to.be.empty;
    });
  });
});