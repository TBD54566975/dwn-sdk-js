import { JsonMessage } from '../messages/types';

type Status = {
  code: number
  message: string
};

type MessageResultOpts = {
  status: Status,
  entries?: JsonMessage[];
};

export class MessageResult {
  status: Status;
  // resulting message entries returned from the invocation of the corresponding message
  // e.g. the resulting messages from a CollectionsQuery
  entries?: JsonMessage[];

  constructor(opts: MessageResultOpts) {
    const { status, entries } = opts;

    this.status = status;
    this.entries = entries;
  }
}