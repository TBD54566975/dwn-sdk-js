import type { BaseMessageReply } from '../../src/core/message-reply.js';

import { expect } from 'chai';
import { messageReplyfromError } from '../../src/core/message-reply.js';

describe('Message Reply', () => {
  it('handles non-Errors being thrown', () => {
    let response: BaseMessageReply;
    try {
      throw 'Some error message';
    } catch (e: unknown) {
      response = messageReplyfromError(e, 500);
    }
    expect(response.status.code).to.eq(500);
    expect(response.status.detail).to.eq('Error');
  });
});
