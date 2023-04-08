/* eslint-disable max-len */

/**
 * exports everything that we want to be consumable
 */

// yep, it's weird that we're exporting '.js' files when they're really
// '.ts' files. Long story. If you're interested as to why, check out:
//   - https://stackoverflow.com/questions/44979976/typescript-compiler-is-forgetting-to-add-file-extensions-to-es6-module-imports
//   - https://github.com/microsoft/TypeScript/issues/40878
//
export type { DwnConfig } from './dwn.js';
export type { DwnServiceEndpoint, ServiceEndpoint, DidDocument, DidResolutionResult, DidResolutionMetadata, DidDocumentMetadata, VerificationMethod } from './did/did-resolver.js';
export type { EventLog } from './event-log/event-log.js';
export type { EventsGetMessage } from './interfaces/events/types.js';
export type { HooksWriteMessage } from './interfaces/hooks/types.js';
export type { ProtocolDefinition, ProtocolRuleSet, ProtocolsConfigureMessage, ProtocolsQueryMessage } from './interfaces/protocols/types.js';
export type { RecordsDeleteMessage, RecordsQueryMessage, RecordsWriteMessage } from './interfaces/records/types.js';
export { AllowAllTenantGate, TenantGate } from './core/tenant-gate.js';
export { Cid } from './utils/cid.js';
export { DataStore } from './store/data-store.js';
export { DataStoreLevel } from './store/data-store-level.js';
export { DateSort } from './interfaces/records/messages/records-query.js';
export { DataStream } from './utils/data-stream.js';
export { DidKeyResolver } from './did/did-key-resolver.js';
export { DidIonResolver } from './did/did-ion-resolver.js';
export { DidResolver, DidMethodResolver } from './did/did-resolver.js';
export { Dwn } from './dwn.js';
export { DwnConstant } from './core/dwn-constant.js';
export { DwnInterfaceName, DwnMethodName } from './core/message.js';
export { Encoder } from './utils/encoder.js';
export { EventLogLevel } from './event-log/event-log-level.js';
export { EventsGet, EventsGetOptions } from './interfaces/events/messages/events-get.js';
export { Encryption } from './utils/encryption.js';
export { HooksWrite, HooksWriteOptions } from './interfaces/hooks/messages/hooks-write.js';
export { Jws } from './utils/jws.js';
export { KeyMaterial, PrivateJwk, PublicJwk } from './jose/types.js';
export { MessageReply } from './core/message-reply.js';
export { MessageStore } from './store/message-store.js';
export { MessageStoreLevel } from './store/message-store-level.js';
export { ProtocolsConfigure, ProtocolsConfigureOptions } from './interfaces/protocols/messages/protocols-configure.js';
export { ProtocolsQuery, ProtocolsQueryOptions } from './interfaces/protocols/messages/protocols-query.js';
export { RecordsDelete, RecordsDeleteOptions } from './interfaces/records/messages/records-delete.js';
export { RecordsQuery, RecordsQueryOptions } from './interfaces/records/messages/records-query.js';
export { RecordsRead, RecordsReadOptions } from './interfaces/records/messages/records-read.js';
export { RecordsWrite, RecordsWriteOptions, CreateFromOptions } from './interfaces/records/messages/records-write.js';
export { Secp256k1 } from './utils/secp256k1.js';
export { SignatureInput } from './jose/jws/general/types.js';