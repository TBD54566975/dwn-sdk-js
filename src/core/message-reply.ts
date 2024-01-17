import type { MessagesGetReplyEntry } from '../types/messages-types.js';
import type { PaginationCursor } from '../types/query-types.js';
import type { ProtocolsConfigureMessage } from '../types/protocols-types.js';
import type { Readable } from 'readable-stream';
import type { RecordsWriteMessage } from '../types/records-types.js';
import type { GenericMessageReply, MessageSubscription, QueryResultEntry } from '../types/message-types.js';

export function messageReplyFromError(e: unknown, code: number): GenericMessageReply {

  const detail = e instanceof Error ? e.message : 'Error';

  return { status: { code, detail } };
}

/**
 * Catch-all message reply type. It is recommended to use GenericMessageReply or a message-specific reply type wherever possible.
 */
export type UnionMessageReply = GenericMessageReply & {
  /**
   * Resulting message entries or events returned from the invocation of the corresponding message.
   * e.g. the resulting messages from a RecordsQuery, or array of messageCid strings for EventsGet or EventsQuery
   * Mutually exclusive with `record`.
   */
  entries?: QueryResultEntry[] | ProtocolsConfigureMessage[] | MessagesGetReplyEntry[] | string[];

  /**
   * Record corresponding to the message received if applicable (e.g. RecordsRead).
   * Mutually exclusive with `entries` and `cursor`.
   */
  record?: RecordsWriteMessage & {
    /**
     * The initial write of the record if the returned RecordsWrite message itself is not the initial write.
     */
    initialWrite?: RecordsWriteMessage;
    data: Readable;
  };

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