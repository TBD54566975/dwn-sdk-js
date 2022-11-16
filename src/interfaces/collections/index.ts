import { CollectionsQuery } from './messages/collections-query';
import { CollectionsWrite } from './messages/collections-write';
import { handleCollectionsQuery } from './handlers/collections-query';
import { handleCollectionsWrite } from './handlers/collections-write';
import { DwnMethodName } from '../../core/message';

export const CollectionsInterface = {
  methodHandlers: {
    [DwnMethodName.CollectionsQuery]: handleCollectionsQuery,
    [DwnMethodName.CollectionsWrite]: handleCollectionsWrite
  },
  messages: [
    CollectionsQuery,
    CollectionsWrite
  ]
};