import type { MethodHandler } from '../types/method-handler.js';
import type { QueryResultEntry } from '../types/message-types.js';
import type { DataStore, DidResolver, MessageStore } from '../index.js';
import type { ProtocolsQueryMessage, ProtocolsQueryReply } from '../types/protocols-types.js';

import { authenticate } from '../core/auth.js';
import { messageReplyFromError } from '../core/message-reply.js';
import { ProtocolsQuery } from '../interfaces/protocols-query.js';
import { removeUndefinedProperties } from '../utils/object.js';

import { DwnInterfaceName, DwnMethodName } from '../core/message.js';

export class ProtocolsQueryHandler implements MethodHandler {

  constructor(private didResolver: DidResolver, private messageStore: MessageStore,private dataStore: DataStore) { }

  public async handle({
    tenant,
    message
  }: { tenant: string, message: ProtocolsQueryMessage}): Promise<ProtocolsQueryReply> {

    let protocolsQuery: ProtocolsQuery;
    try {
      protocolsQuery = await ProtocolsQuery.parse(message);
    } catch (e) {
      return messageReplyFromError(e, 400);
    }

    try {
      await authenticate(message.authorization, this.didResolver);
      await protocolsQuery.authorize(tenant, this.messageStore);
    } catch (e) {
      return messageReplyFromError(e, 401);
    }

    const query = {
      interface : DwnInterfaceName.Protocols,
      method    : DwnMethodName.Configure,
      ...message.descriptor.filter
    };
    removeUndefinedProperties(query);

    const messages = await this.messageStore.query(tenant, query);

    // strip away `authorization` property for each record before responding
    const entries: QueryResultEntry[] = [];
    for (const message of messages) {
      const { authorization: _, ...objectWithRemainingProperties } = message; // a trick to strip away `authorization`
      entries.push(objectWithRemainingProperties as QueryResultEntry);
    }

    return {
      status: { code: 200, detail: 'OK' },
      entries
    };
  };
}
