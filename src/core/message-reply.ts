import type { Readable } from 'readable-stream';

type Status = {
  code: number
  detail: string
};

type MessageReplyOptions<EntryKind> = {
  status: Status,
  entries?: EntryKind[];
  data? : Readable;
};

export class MessageReply<EntryKind> {
  status: Status;

  /**
   * Resulting message entries or events returned from the invocation of the corresponding message.
   * e.g. the resulting messages from a RecordsQuery
   * Mutually exclusive with `data`.
   */
  entries?: EntryKind[];

  /**
   * Data corresponding to the message received if applicable (e.g. RecordsRead).
   * Mutually exclusive with `entries`.
   */
  data?: Readable;

  constructor(opts: MessageReplyOptions<EntryKind>) {
    const { status, entries, data } = opts;

    this.status = status;
    this.entries = entries;
    this.data = data;
  }

  static fromError(e: unknown, code: number): MessageReply<never> {

    const detail = e instanceof Error ? e.message : 'Error';

    return new MessageReply({ status: { code, detail } });
  }
}