import type { MethodHandler } from '../../types.js';
import type { ProtocolsQueryMessage } from '../types.js';

import { canonicalAuth } from '../../../core/auth.js';
import { DwnMethodName } from '../../../core/message.js';
import { MessageReply } from '../../../core/message-reply.js';
import { ProtocolsQuery } from '../messages/protocols-query.js';
import { removeUndefinedProperties } from '../../../utils/object.js';

export const handleProtocolsQuery: MethodHandler = async (
  message,
  messageStore,
  didResolver
): Promise<MessageReply> => {
  const incomingMessage = message as ProtocolsQueryMessage;

  let protocolsQuery: ProtocolsQuery;
  try {
    protocolsQuery = await ProtocolsQuery.parse(incomingMessage);
  } catch (e) {
    return new MessageReply({
      status: { code: 400, detail: e.message }
    });
  }

  try {
    await canonicalAuth(protocolsQuery, didResolver);
  } catch (e) {
    return new MessageReply({
      status: { code: 401, detail: e.message }
    });
  }

  const query = {
    target : protocolsQuery.target,
    method : DwnMethodName.ProtocolsConfigure,
    ...incomingMessage.descriptor.filter
  };
  removeUndefinedProperties(query);

  const entries = await messageStore.query(query);

  return new MessageReply({
    status: { code: 200, detail: 'OK' },
    entries
  });
};
