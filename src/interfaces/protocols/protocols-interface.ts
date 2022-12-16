import { DwnMethodName } from '../../core/message.js';
import { handleProtocolsConfigure } from './handlers/protocols-configure.js';
import { handleProtocolsQuery } from './handlers/protocols-query.js';
import { ProtocolsConfigure } from './messages/protocols-configure.js';
import { ProtocolsQuery } from './messages/protocols-query.js';

export const ProtocolsInterface = {
  methodHandlers: {
    [DwnMethodName.ProtocolsConfigure] : handleProtocolsConfigure,
    [DwnMethodName.ProtocolsQuery]     : handleProtocolsQuery
  },
  messages: [
    ProtocolsConfigure,
    ProtocolsQuery
  ]
};