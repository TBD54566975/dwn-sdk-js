import type { MessagesReadReplyEntry } from '../types/messages-types.js';
import type { PaginationCursor } from '../types/query-types.js';
import type { ProtocolsConfigureMessage } from '../types/protocols-types.js';
import type { RecordsReadReply } from '../types/records-types.js';
import type { GenericMessageReply, MessageSubscription, QueryResultEntry } from '../types/message-types.js';

export function messageReplyFromError(e: unknown, code: number): GenericMessageReply {

  const detail = e instanceof Error ? e.message : 'Error';

  return { status: { code, detail } };
}

/**
 * Catch-all message reply type. It is recommended to use GenericMessageReply or a message-specific reply type wherever possible.
 */
export type UnionMessageReply = GenericMessageReply & RecordsReadReply &{
  /**
   * Resulting message entries or events returned from the invocation of the corresponding message.
   * e.g. the resulting messages from a RecordsQuery, or array of messageCid strings for MessagesQuery
   * Mutually exclusive with `record`.
   */
  entries?: QueryResultEntry[] | ProtocolsConfigureMessage[] | string[];

  /**
   * A single message entry if applicable (e.g. MessagesRead).
   * Mutually exclusive with `record`, `entries` and `cursor`.
   */
  entry?: MessagesReadReplyEntry;

  /**
   * A cursor for pagination if applicable (e.g. RecordsQuery).
   * Mutually exclusive with `record`.
   */
  cursor?: PaginationCursor;

  /**
   * A subscription object if a subscription was requested.
   */
  subscription?: MessageSubscription;
};