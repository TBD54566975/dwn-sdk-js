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
