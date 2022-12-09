import { MessageReply } from './message-reply.js';

type ResponseStatus = {
  code: number
  message: string
};

type ResponseOptions = {
  status?: ResponseStatus
  replies?: MessageReply[];
};

/**
 * class used to create a response that will be returned for a given request
 */
export class Response {
  // present ONLY if there is a general request-related issue
  // e.g. malformed request, invalid target. `status` and `replies` are mutually exclusive
  status?: ResponseStatus;
  // responses to individual messages provided within a request
  replies?: MessageReply[];

  constructor(opts: ResponseOptions = {}) {
    const { status, replies } = opts;
    if (status && replies) {
      throw new Error('status and replies are mutually exclusive');
    }

    if (status) {
      this.status = status;
    }

    this.replies = replies || [];
  }

  addMessageResult(result: MessageReply): void {
    if (this.status) {
      throw new Error('a response with a status cannot contain any replies');
    }

    this.replies.push(result);
  }
}