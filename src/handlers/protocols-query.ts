import type { MethodHandler } from '../types/method-handler.js';
import type { DataStore, DidResolver, MessageStore } from '../index.js';
import type { ProtocolsConfigureMessage, ProtocolsQueryMessage, ProtocolsQueryReply } from '../types/protocols-types.js';

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

    // if this is an anonymous query, query only published ProtocolsConfigures
    if (protocolsQuery.author === undefined) {
      const entries: ProtocolsConfigureMessage[] = await this.fetchPublishedProtocolsConfigure(tenant, protocolsQuery);
      return {
        status: { code: 200, detail: 'OK' },
        entries
      };
    }

    // authentication & authorization
    try {
      await authenticate(message.authorization, this.didResolver);
      await protocolsQuery.authorize(tenant, this.messageStore);
    } catch (e) {
      return messageReplyFromError(e, 401);
    }

    const query = {
      ...message.descriptor.filter,
      interface : DwnInterfaceName.Protocols,
      method    : DwnMethodName.Configure
    };
    removeUndefinedProperties(query);

    const entries = await this.messageStore.query(tenant, query) as ProtocolsConfigureMessage[];

    return {
      status: { code: 200, detail: 'OK' },
      entries
    };
  };

  /**
   * Fetches only published `ProtocolsConfigure`.
   */
  private async fetchPublishedProtocolsConfigure(tenant: string, protocolsQuery: ProtocolsQuery): Promise<ProtocolsConfigureMessage[]> {
    // fetch all published `ProtocolConfigure` matching the query
    const filter = {
      ...protocolsQuery.message.descriptor.filter,
      interface : DwnInterfaceName.Protocols,
      method    : DwnMethodName.Configure,
      published : true
    };
    const publishedProtocolsConfigure = await this.messageStore.query(tenant, filter);
    return publishedProtocolsConfigure as ProtocolsConfigureMessage[];
  }
}
