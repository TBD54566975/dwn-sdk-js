import type { DidMethodResolver } from './did/did-resolver.js';
import type { MessageStore } from './store/message-store.js';
import type { BaseMessage, RequestSchema } from './core/types.js';
import type { Interface, MethodHandler } from './interfaces/types.js';

import { DidResolver } from './did/did-resolver.js';
import { Encoder } from './utils/encoder.js';
import { Message } from './core/message.js';
import { MessageReply } from './core/message-reply.js';
import { MessageStoreLevel } from './store/message-store-level.js';
import { Request } from './core/request.js';
import { Response } from './core/response.js';

import { CollectionsInterface } from './interfaces/records/records-interface.js';
import { PermissionsInterface } from './interfaces/permissions/permissions-interface.js';
import { ProtocolsInterface } from './interfaces/protocols/protocols-interface.js';

export class Dwn {
  static methodHandlers: { [key:string]: MethodHandler } = {
    ...CollectionsInterface.methodHandlers,
    ...PermissionsInterface.methodHandlers,
    ...ProtocolsInterface.methodHandlers
  };

  private DidResolver: DidResolver;
  private messageStore: MessageStore;

  private constructor(config: Config) {
    this.DidResolver = new DidResolver(config.DidMethodResolvers);
    this.messageStore = config.messageStore;
  }

  static async create(config: Config): Promise<Dwn> {
    config.messageStore ??= new MessageStoreLevel();
    config.interfaces ??= [];

    for (const { methodHandlers } of config.interfaces) {

      for (const messageType in methodHandlers) {
        if (Dwn.methodHandlers[messageType]) {
          throw new Error(`methodHandler already exists for ${messageType}`);
        } else {
          Dwn.methodHandlers[messageType] = methodHandlers[messageType];
        }
      }
    }

    const dwn = new Dwn(config);
    await dwn.open();

    return dwn;
  }

  private async open(): Promise<void> {
    return this.messageStore.open();
  }

  async close(): Promise<void> {
    return this.messageStore.close();
  }

  async processRequest(rawRequest: Uint8Array): Promise<Response> {
    let request: RequestSchema;
    try {
      const requestString = Encoder.bytesToString(rawRequest);
      request = JSON.parse(requestString);
    } catch {
      throw new Error('expected request to be valid JSON');
    }

    try {
      request = Request.parse(request);
    } catch (e) {
      return new Response({
        status: { code: 400, message: e.message }
      });
    }

    const response = new Response();

    for (const message of request.messages) {
      let result;
      try {
        result = await this.processMessage(message);
      } catch (error) {
        result = new MessageReply({
          status: { code: 500, detail: error.message }
        });
      }

      response.addMessageResult(result);
    }

    return response;
  }

  /**
   * Processes the given DWN message.
   */
  async processMessage(rawMessage: any): Promise<MessageReply> {
    const dwnMethod = rawMessage?.descriptor?.method;
    if (dwnMethod === undefined) {
      return new MessageReply({
        status: { code: 400, detail: `unknown DWN method ${dwnMethod}` }
      });
    }

    try {
      // consider to push this down to individual handlers
      Message.validateJsonSchema(rawMessage);
    } catch (error) {
      return new MessageReply({
        status: { code: 400, detail: error.message }
      });
    }

    const interfaceMethodHandler = Dwn.methodHandlers[dwnMethod];

    const methodHandlerReply = await interfaceMethodHandler(rawMessage as BaseMessage, this.messageStore, this.DidResolver);
    return methodHandlerReply;
  }
};

export type Config = {
  DidMethodResolvers?: DidMethodResolver[],
  interfaces?: Interface[];
  messageStore?: MessageStore;
};
