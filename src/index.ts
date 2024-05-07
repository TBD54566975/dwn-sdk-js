// export everything that we want to be consumable
export type { DwnConfig } from './dwn.js';
export type { EventLog } from './types/event-log.js';
export type { EventsGetMessage, EventsGetReply, EventsQueryMessage, EventsQueryReply, EventsSubscribeDescriptor, EventsSubscribeMessage, EventsSubscribeReply, MessageSubscriptionHandler as EventSubscriptionHandler } from './types/events-types.js';
export type { EventStream, MessageEvent, SubscriptionReply } from './types/subscriptions.js';
export type { GenericMessage, GenericMessageReply, MessageSort, MessageSubscription, Pagination, QueryResultEntry } from './types/message-types.js';
export type { MessagesGetMessage, MessagesGetReply, MessagesGetReplyEntry } from './types/messages-types.js';
export type { Filter, EqualFilter, OneOfFilter, RangeFilter, RangeCriterion, PaginationCursor, QueryOptions } from './types/query-types.js';
export type { PermissionConditions, PermissionScope } from './types/permission-types.js';
export type { ProtocolsConfigureDescriptor, ProtocolDefinition, ProtocolTypes, ProtocolRuleSet, ProtocolsQueryFilter, ProtocolsConfigureMessage, ProtocolsQueryMessage, ProtocolsQueryReply } from './types/protocols-types.js';
export type { EncryptionProperty, RecordsDeleteMessage, RecordsQueryMessage, RecordsQueryReply, RecordsQueryReplyEntry, RecordsReadMessage, RecordsReadReply, RecordsSubscribeDescriptor, RecordsSubscribeMessage, RecordsSubscribeReply, RecordSubscriptionHandler, RecordsWriteDescriptor, RecordsWriteTags, RecordsWriteTagValue, RecordsWriteMessage } from './types/records-types.js';
export { authenticate } from './core/auth.js';
export { ActiveTenantCheckResult, AllowAllTenantGate, TenantGate } from './core/tenant-gate.js';
export { Cid } from './utils/cid.js';
export { RecordsQuery, RecordsQueryOptions } from './interfaces/records-query.js';
export { DataStore, DataStorePutResult, DataStoreGetResult } from './types/data-store.js';
export { DataStream } from './utils/data-stream.js';
export { DateSort } from './types/records-types.js';
export { DerivedPrivateJwk, HdKey, KeyDerivationScheme } from './utils/hd-key.js';
export { Dwn } from './dwn.js';
export { DwnConstant } from './core/dwn-constant.js';
export { DwnError, DwnErrorCode } from './core/dwn-error.js';
export { DwnInterfaceName, DwnMethodName } from './enums/dwn-interface-method.js';
export { Encoder } from './utils/encoder.js';
export { EventsGet, EventsGetOptions } from './interfaces/events-get.js';
export { EventsQuery, EventsQueryOptions } from './interfaces/events-query.js';
export { EventsSubscribe, EventsSubscribeOptions } from './interfaces/events-subscribe.js';
export { Encryption, EncryptionAlgorithm } from './utils/encryption.js';
export { EncryptionInput, KeyEncryptionInput, RecordsWrite, RecordsWriteOptions, CreateFromOptions } from './interfaces/records-write.js';
export { executeUnlessAborted } from './utils/abort.js';
export { Jws } from './utils/jws.js';
export { KeyMaterial, PrivateJwk, PublicJwk } from './types/jose-types.js';
export { Message } from './core/message.js';
export { MessagesGet, MessagesGetOptions } from './interfaces/messages-get.js';
export { UnionMessageReply } from './core/message-reply.js';
export { MessageStore, MessageStoreOptions } from './types/message-store.js';
export { PermissionsProtocol } from './protocols/permissions.js';
export { PrivateKeySigner } from './utils/private-key-signer.js';
export { Protocols } from './utils/protocols.js';
export { ProtocolsConfigure, ProtocolsConfigureOptions } from './interfaces/protocols-configure.js';
export { ProtocolsQuery, ProtocolsQueryOptions } from './interfaces/protocols-query.js';
export { Records } from './utils/records.js';
export { RecordsDelete, RecordsDeleteOptions } from './interfaces/records-delete.js';
export { RecordsRead, RecordsReadOptions } from './interfaces/records-read.js';
export { RecordsSubscribe, RecordsSubscribeOptions } from './interfaces/records-subscribe.js';
export { Secp256k1 } from './utils/secp256k1.js';
export { Secp256r1 } from './utils/secp256r1.js';
export { Signer } from './types/signer.js';
export { SortDirection } from './types/query-types.js';
export { Time } from './utils/time.js';

// concrete implementations of stores and event stream
export { DataStoreLevel } from './store/data-store-level.js';
export { EventLogLevel } from './event-log/event-log-level.js';
export { MessageStoreLevel } from './store/message-store-level.js';
export { EventEmitterStream } from './event-log/event-emitter-stream.js';

// test library exports
export { Persona, TestDataGenerator } from '../tests/utils/test-data-generator.js';