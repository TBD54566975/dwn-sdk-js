import type { BaseMessage, RequestSchema } from './core/types';
import type { DIDMethodResolver } from './did/did-resolver';
import type { HandlersWriteMessage } from './interfaces/handlers/types';
import type { Interface, MethodHandler } from './interfaces/types';
import type { MessageStore } from './store/message-store';

import { addSchema } from './validation/validator';
import { CollectionsInterface, PermissionsInterface } from './interfaces';
import { DIDKeyResolver } from './did/did-key-resolver';
import { DIDResolver } from './did/did-resolver';
import { IonDidResolver } from './did/ion-did-resolver';
import { Message, MessageReply, Request, Response } from './core';
import { MessageStoreLevel } from './store/message-store-level';

export class DWN {
  static methodHandlers: { [key:string]: MethodHandler } = {
    ...CollectionsInterface.methodHandlers,
    ...PermissionsInterface.methodHandlers
  };

  private DIDResolver: DIDResolver;
  private messageStore: MessageStore;
  private customEventHandlers: { handlersWriteMessage: HandlersWriteMessage, eventHandler: EventHandler }[] = [];


  private constructor(config: Config) {
    this.DIDResolver = new DIDResolver(config.DIDMethodResolvers);
    this.messageStore = config.messageStore;
  }

  static async create(config: Config): Promise<DWN> {
    config.messageStore = config.messageStore || new MessageStoreLevel();
    config.DIDMethodResolvers = config.DIDMethodResolvers || [new IonDidResolver(), new DIDKeyResolver()];
    config.interfaces = config.interfaces || [];

    for (const { methodHandlers, schemas } of config.interfaces) {

      for (const messageType in methodHandlers) {
        if (DWN.methodHandlers[messageType]) {
          throw new Error(`methodHandler already exists for ${messageType}`);
        } else {
          DWN.methodHandlers[messageType] = methodHandlers[messageType];
        }
      }

      for (const schemaName in schemas) {
        addSchema(schemaName, schemas[schemaName]);
      }
    }

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

  /**
   * Adds a custom event handler.
   * Current implementation only allows one matching handler.
   */
  async addCustomEventHandler(handlersWriteMessage: HandlersWriteMessage, eventHandler: EventHandler): Promise<void> {
    const matchingHandlers = this.getCustomEventHandlers(handlersWriteMessage);

    if (matchingHandlers.length !== 0) {
      throw new Error(`an existing handler matching the filter of the given handler already exists`);
    }

    this.customEventHandlers.push({
      handlersWriteMessage,
      eventHandler
    });
  }

  async processRequest(rawRequest: Uint8Array): Promise<Response> {
    let request: RequestSchema;
    try {
      const requestString = new TextDecoder().decode(rawRequest);
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
   * TODO: add docs, Issue #70 https://github.com/TBD54566975/dwn-sdk-js/issues/70
   * @param message
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
      const interfaceMethodHandler = DWN.methodHandlers[message.descriptor.method];

      const methodHandlerReply = await interfaceMethodHandler(message, this.messageStore, this.DIDResolver);

      const customHandlerReply = await this.triggerEventHandler(message);

      // use custom handler's reply if exists
      if (customHandlerReply === undefined) {
        return methodHandlerReply;
      } else {
        return customHandlerReply;
      }
    } catch (e) {
      return new MessageReply({
        status: { code: 500, detail: e.message }
      });
    }
  }

  /**
   * Gets the matching custom event handlers given a message.
   */
  private getCustomEventHandlers(message: BaseMessage): EventHandler[]{
    const matchingHandlersData = this.customEventHandlers.filter(
      (handlerData) => message.descriptor.target === handlerData.handlersWriteMessage.descriptor.target &&
                       message.descriptor.method === handlerData.handlersWriteMessage.descriptor.filter.method);

    const matchingHandlers = matchingHandlersData.map(handlerData => handlerData.eventHandler);
    return matchingHandlers;
  }

  /**
   * Trigger method event handler as needed.
   * Current implementation only allows one matching handler.
   */
  private async triggerEventHandler(message: BaseMessage): Promise<MessageReply | undefined> {
    // find the matching event handlers
    const matchingHandlers = this.getCustomEventHandlers(message);

    if (matchingHandlers.length === 0) {
      return undefined;
    }

    const handler = matchingHandlers[0];
    const response = await handler(message);
    return response;
  }
};

export type Config = {
  DIDMethodResolvers?: DIDMethodResolver[],
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