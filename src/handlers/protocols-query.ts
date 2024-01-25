import type { DataStore } from '../types/data-store.js';
import type { DidResolver } from '@web5/dids';
import type { MessageStore } from '../types//message-store.js';
import type { MethodHandler } from '../types/method-handler.js';
import type { ProtocolsConfigureMessage, ProtocolsQueryMessage, ProtocolsQueryReply } from '../types/protocols-types.js';

import { authenticate } from '../core/auth.js';
import { DwnErrorCode } from '../core/dwn-error.js';
import { messageReplyFromError } from '../core/message-reply.js';
import { ProtocolsQuery } from '../interfaces/protocols-query.js';
import { removeUndefinedProperties } from '../utils/object.js';

import { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';

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

    // authentication & authorization
    try {
      await authenticate(message.authorization, this.didResolver);
      await protocolsQuery.authorize(tenant, this.messageStore);
    } catch (error: any) {

      // return public ProtocolsConfigures if query fails with a certain authentication or authorization code
      if (error.code === DwnErrorCode.AuthenticateJwsMissing || // unauthenticated
          error.code === DwnErrorCode.ProtocolsQueryUnauthorized) {

        const entries: ProtocolsConfigureMessage[] = await this.fetchPublishedProtocolsConfigure(tenant, protocolsQuery);
        return {
          status: { code: 200, detail: 'OK' },
          entries
        };
      } else {
        return messageReplyFromError(error, 401);
      }
    }

    const query = {
      ...message.descriptor.filter,
      interface : DwnInterfaceName.Protocols,
      method    : DwnMethodName.Configure
    };
    removeUndefinedProperties(query);

    const { messages } = await this.messageStore.query(tenant, [ query ]);

    return {
      status  : { code: 200, detail: 'OK' },
      entries : messages as ProtocolsConfigureMessage[]
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
    const { messages: publishedProtocolsConfigure } = await this.messageStore.query(tenant, [ filter ]);
    return publishedProtocolsConfigure as ProtocolsConfigureMessage[];
  }
}
