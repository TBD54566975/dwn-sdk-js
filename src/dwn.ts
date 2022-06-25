import type { Context } from './types';
import type { DIDMethodResolver } from './did/did-resolver';
import type { InterfaceMethod } from './interfaces/types';
import type { JsonMessage } from './messages/types';
import type { MessageStore } from './store/message-store';

import { DIDResolver } from './did/did-resolver';
import { Message } from './messages/message';
import { MessageStoreLevel } from './store/message-store-level';
import { Request } from './request';
import { MessageResult, Response } from './response';
import { PermissionsInterface } from './interfaces';

export class DWN {
  static methods: { [key:string]: InterfaceMethod } = {
    ...PermissionsInterface.methods
  };

  DIDResolver: DIDResolver;
  messageStore: MessageStore;

  private constructor(config: Config) {
    this.DIDResolver = new DIDResolver(config.DIDMethodResolvers);
    this.messageStore = config.messageStore;
  }

  static async create(config: Config): Promise<DWN> {
    config.messageStore = config.messageStore || new MessageStoreLevel();
    config.DIDMethodResolvers = config.DIDMethodResolvers || [];

    const dwn = new DWN(config);
    await dwn.open();

    return dwn;
  }

  private async open(): Promise<void> {
    return this.messageStore.open();
  }

  async close(): Promise<void> {
    return this.messageStore.close();
  }

  async processRequest(rawRequest: any): Promise<Response> {
    let request: Request;

    try {
      request = Request.unmarshal(rawRequest);
    } catch (e) {
      return new Response({
        status: { code: 400, message: e.message }
      });
    }

    const response = new Response();
    const context: Context = { tenant: request.target };

    for (let message of request.messages) {
      const result = await this.processMessage(message, context);
      response.addMessageResult(result);
    }

    return response;
  }

  /**
   * TODO: add docs
   * @param message
   */
  async processMessage(rawMessage: object, ctx: Context): Promise<MessageResult> {
    let message: JsonMessage;

    try {
      message = Message.unmarshal(rawMessage);
    } catch(e) {
      return new MessageResult({
        status: { code: 400, message: e.message }
      });
    }

    const interfaceMethod = DWN.methods[message.descriptor.method];

    return await interfaceMethod(ctx, message, this.messageStore, this.DIDResolver);
  }
};

export type Config = {
  DIDMethodResolvers?: DIDMethodResolver[],
  messageStore?: MessageStore
};