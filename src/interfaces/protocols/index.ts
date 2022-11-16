import { handleProtocolsConfigure } from './handlers/protocols-configure';
import { handleProtocolsQuery } from './handlers/protocols-query';
import { ProtocolsConfigure } from './messages/protocols-configure';
import { ProtocolsQuery } from './messages/protocols-query';
import { DwnMethodName } from '../../core/message';

export const ProtocolsInterface = {
  methodHandlers: {
    [DwnMethodName.ProtocolsConfigure]: handleProtocolsConfigure,
    [DwnMethodName.ProtocolsQuery]: handleProtocolsQuery
  },
  messages: [
    ProtocolsConfigure,
    ProtocolsQuery
  ]
};