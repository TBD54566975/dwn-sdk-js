import { CollectionsQuery } from './messages/collections-query.js';
import { CollectionsWrite } from './messages/collections-write.js';
import { DwnMethodName } from '../../core/message.js';
import { handleCollectionsQuery } from './handlers/collections-query.js';
import { handleCollectionsWrite } from './handlers/collections-write.js';

export const CollectionsInterface = {
  methodHandlers: {
    [DwnMethodName.CollectionsQuery] : handleCollectionsQuery,
    [DwnMethodName.CollectionsWrite] : handleCollectionsWrite
  },
  messages: [
    CollectionsQuery,
    CollectionsWrite
  ]
};