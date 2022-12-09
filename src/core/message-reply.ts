import { BaseMessage } from './types.js';

type Status = {
  code: number
  detail: string
};

type MessageReplyOptions = {
  status: Status,
  entries?: BaseMessage[];
};

export class MessageReply {
  status: Status;
  // resulting message entries returned from the invocation of the corresponding message
  // e.g. the resulting messages from a CollectionsQuery
  entries?: BaseMessage[];

  constructor(opts: MessageReplyOptions) {
    const { status, entries } = opts;

    this.status = status;
    this.entries = entries;
  }
}