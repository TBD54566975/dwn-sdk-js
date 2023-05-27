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

export type BaseMessageReply = {
  status: Status;
};

export function messageReplyFromError(e: unknown, code: number): BaseMessageReply {

  const detail = e instanceof Error ? e.message : 'Error';

  return { status: { code, detail } };
}
