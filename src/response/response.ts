import { MessageReply } from './message-reply';

type ResponseStatus = {
  code: number
  message: string
};

type ResponseOpts = {
  status?: ResponseStatus
  results?: MessageReply[];
};

/**
 * class used to create a response that will be returned for a given request
 */
export class Response {
  // present ONLY if there is a general request-related issue
  // e.g. malformed request, invalid target. `status` and `replies` are mutually exclusive
  status?: ResponseStatus;
  // responses to individual messages provided within a request
  results?: MessageReply[];

  constructor(opts: ResponseOpts = {}) {
    const { status, results } = opts;
    if (status && results) {
      throw new Error('status and results are mutually exclusive');
    }

    if (status) {
      this.status = status;
    }

    this.results = results || [];
  }

  addMessageResult(result: MessageReply): void {
    if (this.status) {
      throw new Error('a response with a status cannot contain any results');
    }

    this.results.push(result);
  }
}