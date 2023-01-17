import { CollectionsQuery } from './messages/collections-query.js';
import { RecordsWrite } from './messages/collections-write.js';
import { DwnMethodName } from '../../core/message.js';
import { handleCollectionsQuery } from './handlers/collections-query.js';
import { handleRecordsWrite } from './handlers/collections-write.js';

export const CollectionsInterface = {
  methodHandlers: {
    [DwnMethodName.CollectionsQuery]: handleCollectionsQuery,
    [DwnMethodName.RecordsWrite]: handleRecordsWrite
  },
  messages: [
    CollectionsQuery,
    RecordsWrite
  ]
};