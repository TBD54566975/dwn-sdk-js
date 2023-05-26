import type { EventsGetMessage, EventsGetReply } from './event-types.js';
import type { MessagesGetMessage, MessagesGetReply } from './messages-types.js';
import type { ProtocolsConfigureMessage, ProtocolsQueryMessage } from './protocols-types.js';
import type { RecordsDeleteMessage, RecordsQueryMessage, RecordsReadMessage, RecordsReadReply, RecordsWriteMessage } from './records-types.js';

import type { CommonMessageReply } from '../core/message-reply.js';

export type DwnMessageMap = {
    EventsGet : EventsGetMessage;
    MessagesGet : MessagesGetMessage;
    ProtocolsConfigure : ProtocolsConfigureMessage;
    ProtocolsQuery : ProtocolsQueryMessage;
    RecordsDelete : RecordsDeleteMessage;
    RecordsQuery : RecordsQueryMessage;
    RecordsRead : RecordsReadMessage;
    RecordsWrite : RecordsWriteMessage;
};

export type DwnMessageReplyMap = {
    EventsGet : EventsGetReply,
    MessagesGet : MessagesGetReply,
    ProtocolsConfigure : CommonMessageReply,
    ProtocolsQuery : CommonMessageReply,
    RecordsDelete : CommonMessageReply,
    RecordsQuery : CommonMessageReply,
    RecordsRead : RecordsReadReply,
    RecordsWrite : CommonMessageReply,
};

export type DwnMessage<T extends keyof DwnMessageMap> = DwnMessageMap[T];
export type DwnMessageReply<T extends keyof DwnMessageReplyMap> = DwnMessageReplyMap[T];
