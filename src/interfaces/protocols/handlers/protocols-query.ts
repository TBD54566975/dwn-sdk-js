import type { MethodHandler } from '../../types.js';
import type { ProtocolsQueryMessage } from '../types.js';

import { canonicalAuth } from '../../../core/auth.js';
import { MessageReply } from '../../../core/message-reply.js';
import { ProtocolsQuery } from '../messages/protocols-query.js';
import { removeUndefinedProperties } from '../../../utils/object.js';

import { DataStore, DidResolver, MessageStore } from '../../../index.js';
import { DwnInterfaceName, DwnMethodName } from '../../../core/message.js';

export class ProtocolsQueryHandler implements MethodHandler {

  constructor(private didResolver: DidResolver, private messageStore: MessageStore,private dataStore: DataStore) { }

  public async handle({
    tenant,
    message
  }): Promise<MessageReply> {
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
      await canonicalAuth(tenant, protocolsQuery, this.didResolver);
    } catch (e) {
      return new MessageReply({
        status: { code: 401, detail: e.message }
      });
    }

    const query = {
      tenant,
      interface : DwnInterfaceName.Protocols,
      method    : DwnMethodName.Configure,
      ...incomingMessage.descriptor.filter
    };
    removeUndefinedProperties(query);

    const entries = await this.messageStore.query(query);

    return new MessageReply({
      status: { code: 200, detail: 'OK' },
      entries
    });
  };
}
