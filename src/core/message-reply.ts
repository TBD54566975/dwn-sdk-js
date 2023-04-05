import type { Message } from './message.js';
import type { Readable } from 'readable-stream';
import type { BaseMessage, QueryResultEntry } from './types.js';

type Status = {
  code: number
  detail: string
};

type MessageReplyOptions = {
  status: Status,
  message?: Message<BaseMessage>,
  entries?: QueryResultEntry[];
  data? : Readable;
};

export class MessageReply {
  status: Status;

  message?: Message<BaseMessage>;

  /**
   * Resulting message entries returned from the invocation of the corresponding message.
   * e.g. the resulting messages from a RecordsQuery
   * Mutually exclusive with `data`.
   */
  entries?: QueryResultEntry[];

  /**
   * Data corresponding to the message received if applicable (e.g. RecordsRead).
   * Mutually exclusive with `entries`.
   */
  data?: Readable;

  constructor(opts: MessageReplyOptions) {
    const { status, message, entries, data } = opts;

    this.status = status;
    this.message = message;
    this.entries = entries;
    this.data = data;
  }

  static fromError(e: unknown, code: number): MessageReply {

    const detail = e instanceof Error ? e.message : 'Error';

    return new MessageReply({ status: { code, detail } });
  }
}