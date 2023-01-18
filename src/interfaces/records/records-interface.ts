import { DwnMethodName } from '../../core/message.js';
import { handleRecordsQuery } from './handlers/records-query.js';
import { handleRecordsWrite } from './handlers/records-write.js';
import { RecordsQuery } from './messages/records-query.js';
import { RecordsWrite } from './messages/records-write.js';

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