import { RecordsQuery } from './messages/collections-query.js';
import { RecordsWrite } from './messages/collections-write.js';
import { DwnMethodName } from '../../core/message.js';
import { handleRecordsQuery } from './handlers/collections-query.js';
import { handleRecordsWrite } from './handlers/collections-write.js';

export const CollectionsInterface = {
  methodHandlers: {
    [DwnMethodName.RecordsQuery] : handleRecordsQuery,
    [DwnMethodName.RecordsWrite] : handleRecordsWrite
  },
  messages: [
    RecordsQuery,
    RecordsWrite
  ]
};