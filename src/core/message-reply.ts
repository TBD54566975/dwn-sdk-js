import { Descriptor } from './types.js';

type Status = {
  code: number
  detail: string
};

type MessageReplyOptions = {
  status: Status,
  entries?: { descriptor: Descriptor }[];
};

export class MessageReply {
  status: Status;
  // resulting message entries returned from the invocation of the corresponding message
  // e.g. the resulting messages from a RecordsQuery
  entries?: { descriptor: Descriptor }[];

  constructor(opts: MessageReplyOptions) {
    const { status, entries } = opts;

    this.status = status;
    this.entries = entries;
  }
}