import type { QueryResultEntry } from '../types/message-types.js';
import type { Readable } from 'readable-stream';

type Status = {
  code: number
  detail: string
};

type MessageReplyOptions = {
  status: Status,
  entries?: QueryResultEntry[];
  data? : Readable;
};

export class BaseMessageReply {
  status: Status;

  constructor(opts: MessageReplyOptions) {
    this.status = opts.status;
  }

  static fromError(e: unknown, code: number): CommonMessageReply {

    const detail = e instanceof Error ? e.message : 'Error';

    return new CommonMessageReply({ status: { code, detail } });
  }
};

export class CommonMessageReply {
  status: Status;

  /**
   * Resulting message entries or events returned from the invocation of the corresponding message.
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
    const { status, entries, data } = opts;

    this.status = status;
    this.entries = entries;
    this.data = data;
  }


}