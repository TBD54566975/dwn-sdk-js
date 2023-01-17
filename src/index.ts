/* eslint-disable max-len */

/**
 * exports everything that we want to be consumable
 */

// yep, it's weird that we're exporting '.js' files when they're really
// '.ts' files. Long story. If you're interested as to why, check out:
//   - https://stackoverflow.com/questions/44979976/typescript-compiler-is-forgetting-to-add-file-extensions-to-es6-module-imports
//   - https://github.com/microsoft/TypeScript/issues/40878
//
export type { RecordsQueryMessage, RecordsWriteMessage } from './interfaces/records/types.js';
export type { Config } from './dwn.js';
export type { HooksWriteMessage } from './interfaces/hooks/types.js';
export type { ProtocolDefinition, ProtocolRuleSet, ProtocolsConfigureMessage, ProtocolsQueryMessage } from './interfaces/protocols/types.js';
export type { DwnServiceEndpoint, ServiceEndpoint, DidDocument, DidResolutionResult, DidResolutionMetadata, DidDocumentMetadata, VerificationMethod } from './did/did-resolver.js';
export { RecordsQuery, RecordsQueryOptions } from './interfaces/records/messages/records-query.js';
export { RecordsWrite, RecordsWriteOptions, CreateFromOptions } from './interfaces/records/messages/records-write.js';
export { DateSort } from './interfaces/records/messages/records-query.js';
export { DidKeyResolver } from './did/did-key-resolver.js';
export { DidIonResolver } from './did/did-ion-resolver.js';
export { DidResolver, DidMethodResolver } from './did/did-resolver.js';
export { Dwn } from './dwn.js';
export { Encoder } from './utils/encoder.js';
export { HooksWrite, HooksWriteOptions } from './interfaces/hooks/messages/hooks-write.js';
export { MessageStore } from './store/message-store.js';
export { MessageStoreLevel } from './store/message-store-level.js';
export { PrivateJwk, PublicJwk } from './jose/types.js';
export { ProtocolsConfigure, ProtocolsConfigureOptions } from './interfaces/protocols/messages/protocols-configure.js';
export { ProtocolsQuery, ProtocolsQueryOptions } from './interfaces/protocols/messages/protocols-query.js';
export { Response } from './core/response.js';