import { handleRecordsQuery } from './handlers/records-query.js';
import { handleRecordsWrite } from './handlers/records-write.js';
import { RecordsQuery } from './messages/records-query.js';
import { RecordsWrite } from './messages/records-write.js';
import { DwnInterfaceName, DwnMethodName } from '../../core/message.js';

export const RecordsInterface = {
  methodHandlers: {
    [DwnInterfaceName.Records + DwnMethodName.Query] : handleRecordsQuery,
    [DwnInterfaceName.Records + DwnMethodName.Write] : handleRecordsWrite
  },
  messages: [
    RecordsQuery,
    RecordsWrite
  ]
};