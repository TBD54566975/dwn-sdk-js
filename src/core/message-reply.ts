import { QueryResultEntry } from './types.js';
import { Readable } from 'readable-stream';

type Status = {
  code: number
  detail: string
};

type MessageReplyOptions = {
  status: Status,
  entries?: QueryResultEntry[];
  data? : Readable;
};

export class MessageReply {
  status: Status;

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
    const { status, entries, data } = opts;

    this.status = status;
    this.entries = entries;
    this.data = data;
  }
}