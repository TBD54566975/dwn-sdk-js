import { handleProtocolsConfigure } from './handlers/protocols-configure.js';
import { handleProtocolsQuery } from './handlers/protocols-query.js';
import { ProtocolsConfigure } from './messages/protocols-configure.js';
import { ProtocolsQuery } from './messages/protocols-query.js';
import { DwnInterfaceName, DwnMethodName } from '../../core/message.js';

export const ProtocolsInterface = {
  methodHandlers: {
    [DwnInterfaceName.Protocols + DwnMethodName.Configure] : handleProtocolsConfigure,
    [DwnInterfaceName.Protocols + DwnMethodName.Query]     : handleProtocolsQuery
  },
  messages: [
    ProtocolsConfigure,
    ProtocolsQuery
  ]
};