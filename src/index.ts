/* eslint-disable max-len */

/**
 * exports everything that we want to be consumable
 */

// yep, it's weird that we're exporting '.js' files when they're really
// '.ts' files. Long story. If you're interested as to why, check out:
//   - https://stackoverflow.com/questions/44979976/typescript-compiler-is-forgetting-to-add-file-extensions-to-es6-module-imports
//   - https://github.com/microsoft/TypeScript/issues/40878
//
export type { CollectionsQueryOptions } from './interfaces/collections/messages/collections-query.js';
export type { CollectionsQueryMessage, CollectionsWriteMessage } from './interfaces/collections/types';
export type { CollectionsWriteOptions } from './interfaces/collections/messages/collections-write.js';
export type { DIDResolver } from './did/did-resolver.js';
export type { EventHandler } from './dwn.js';
export type { HandlersWriteOptions } from './interfaces/handlers/messages/handlers-write.js';
export type { HandlersWriteMessage } from './interfaces/handlers/types';
export { CollectionsQuery } from './interfaces/collections/messages/collections-query.js';
export { CollectionsWrite } from './interfaces/collections/messages/collections-write.js';
export { DWN } from './dwn.js';
export { HandlersWrite } from './interfaces/handlers/messages/handlers-write.js';
export { Response } from './core/response.js';