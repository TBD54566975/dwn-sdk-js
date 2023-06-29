import type { QueryResultEntry } from '../types/message-types.js';
import type { Readable } from 'readable-stream';

type Status = {
  code: number
  detail: string
};

export type BaseMessageReply = {
  status: Status;
};

export function messageReplyFromError(e: unknown, code: number): BaseMessageReply {

  const detail = e instanceof Error ? e.message : 'Error';

  return { status: { code, detail } };
}

/**
 * Catch-all message reply type. It is recommended to use BaseMessageReply or a message-specific reply type whereever possible.
 */
export type UnionMessageReply = BaseMessageReply & {
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
};