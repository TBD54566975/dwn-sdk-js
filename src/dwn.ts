import type { BaseMessage, RequestSchema } from './core/types';
import type { DidMethodResolver } from './did/did-resolver';
import type { Interface, MethodHandler } from './interfaces/types';
import type { MessageStore } from './store/message-store';
import * as encoder from '../src/utils/encoder';
import { addSchema } from './validation/validator';
import { CollectionsInterface, PermissionsInterface, ProtocolsInterface } from './interfaces';
import { DidKeyResolver } from './did/did-key-resolver';
import { DidResolver } from './did/did-resolver';
import { DidIonResolver } from './did/did-ion-resolver';
import { Message, MessageReply, Request, Response } from './core';
import { MessageStoreLevel } from './store/message-store-level';


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
    config.messageStore = config.messageStore || new MessageStoreLevel();
    config.DidMethodResolvers = config.DidMethodResolvers || [new DidIonResolver(), new DidKeyResolver()];
    config.interfaces = config.interfaces || [];

    for (const { methodHandlers, schemas } of config.interfaces) {

      for (const messageType in methodHandlers) {
        if (Dwn.methodHandlers[messageType]) {
          throw new Error(`methodHandler already exists for ${messageType}`);
        } else {
          Dwn.methodHandlers[messageType] = methodHandlers[messageType];
        }
      }

      for (const schemaName in schemas) {
        addSchema(schemaName, schemas[schemaName]);
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
      const requestString = encoder.bytesToString(rawRequest);
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
      const result = await this.processMessage(message);
      response.addMessageResult(result);
    }

    return response;
  }

  /**
   * Processes the given DWN message.
   */
  async processMessage(rawMessage: object): Promise<MessageReply> {
    let message: BaseMessage;

    try {
      message = Message.parse(rawMessage);
    } catch (e) {
      return new MessageReply({
        status: { code: 400, detail: e.message }
      });
    }

    try {
      const interfaceMethodHandler = Dwn.methodHandlers[message.descriptor.method];

      const methodHandlerReply = await interfaceMethodHandler(message, this.messageStore, this.DidResolver);
      return methodHandlerReply;
    } catch (e) {
      return new MessageReply({
        status: { code: 500, detail: e.message }
      });
    }
  }
};

export type Config = {
  DidMethodResolvers?: DidMethodResolver[],
  interfaces?: Interface[];
  messageStore?: MessageStore;
};


/**
 * An event handler that is triggered after a message passes processing flow of:
 * DWN message level schema validation -> authentication -> authorization -> message processing/storage.
 * @param message The message to be handled
 * @returns the response to be returned back to the caller
 */
export interface EventHandler {
  (message: BaseMessage): Promise<MessageReply>;
}