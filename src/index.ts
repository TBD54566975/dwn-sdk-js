/* eslint-disable max-len */

/**
 * exports everything that we want to be consumable
 */

// yep, it's weird that we're exporting '.js' files when they're really
// '.ts' files. Long story. If you're interested as to why, check out:
//   - https://stackoverflow.com/questions/44979976/typescript-compiler-is-forgetting-to-add-file-extensions-to-es6-module-imports
//   - https://github.com/microsoft/TypeScript/issues/40878
//
export type { CollectionsQueryMessage, CollectionsWriteMessage } from './interfaces/collections/types';
export type { EventHandler } from './dwn.js';
export type { HooksWriteMessage } from './interfaces/hooks/types';
export type { ProtocolDefinition, ProtocolRuleSet, ProtocolsConfigureMessage, ProtocolsQueryMessage } from './interfaces/protocols/types';
export { CollectionsQuery, CollectionsQueryOptions } from './interfaces/collections/messages/collections-query.js';
export { CollectionsWrite, CollectionsWriteOptions } from './interfaces/collections/messages/collections-write.js';
export { DidResolver } from './did/did-resolver.js';
export { Dwn } from './dwn.js';
export { HooksWrite, HooksWriteOptions } from './interfaces/hooks/messages/hooks-write.js';
export { ProtocolsConfigure, ProtocolsConfigureOptions } from './interfaces/protocols/messages/protocols-configure.js';
export { ProtocolsQuery, ProtocolsQueryOptions } from './interfaces/protocols/messages/protocols-query.js';
export { Response } from './core/response.js';