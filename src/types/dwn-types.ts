import type { EventsGetMessage, EventsGetReply } from './event-types.js';
import type { MessagesGetMessage, MessagesGetReply } from './messages-types.js';
import type { ProtocolsConfigureMessage, ProtocolsQueryMessage, ProtocolsQueryReply } from './protocols-types.js';
import type { RecordsDeleteMessage, RecordsQueryMessage, RecordsQueryReply, RecordsReadMessage, RecordsReadReply, RecordsWriteMessage } from './records-types.js';
import type { BaseMessageReply } from '../core/message-reply.js';

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
    ProtocolsConfigure : BaseMessageReply,
    ProtocolsQuery : ProtocolsQueryReply,
    RecordsDelete : BaseMessageReply,
    RecordsQuery : RecordsQueryReply,
    RecordsRead : RecordsReadReply,
    RecordsWrite : BaseMessageReply,
};

export type DwnMessage<T extends keyof DwnMessageMap> = DwnMessageMap[T];
export type DwnMessageReply<T extends keyof DwnMessageReplyMap> = DwnMessageReplyMap[T];
