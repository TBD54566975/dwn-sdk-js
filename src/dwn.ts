import type { BaseMessage } from './core/types.js';
import type { DidMethodResolver } from './did/did-resolver.js';
import type { MessageStore } from './store/message-store.js';
import type { Interface, MethodHandler } from './interfaces/types.js';

import { DidResolver } from './did/did-resolver.js';
import { Encoder } from './utils/encoder.js';
import { Message } from './core/message.js';
import { MessageReply } from './core/message-reply.js';
import { MessageStoreLevel } from './store/message-store-level.js';

import { PermissionsInterface } from './interfaces/permissions/permissions-interface.js';
import { ProtocolsInterface } from './interfaces/protocols/protocols-interface.js';
import { RecordsInterface } from './interfaces/records/records-interface.js';

export class Dwn {
  static methodHandlers: { [key:string]: MethodHandler } = {
    ...RecordsInterface.methodHandlers,
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

  /**
   * Processes the given DWN message given as raw bytes and returns with a message reply.
   * @param tenant The tenant DID to route the given message to.
   */
  async processRequest(tenant: string, rawRequest: Uint8Array): Promise<MessageReply> {
    let message: BaseMessage;
    try {
      const requestString = Encoder.bytesToString(rawRequest);
      message = JSON.parse(requestString);
    } catch (error) {
      return new MessageReply({
        status: { code: 400, detail: error.message }
      });
    }

    const messageReply = await this.processMessage(tenant, message);
    return messageReply;
  }

  /**
   * Processes the given DWN message and returns with a reply.
   * @param tenant The tenant DID to route the given message to.
   */
  async processMessage(tenant: string, rawMessage: any): Promise<MessageReply> {
    const dwnInterface = rawMessage?.descriptor?.interface;
    const dwnMethod = rawMessage?.descriptor?.method;
    if (dwnInterface === undefined || dwnMethod === undefined) {
      return new MessageReply({
        status: { code: 400, detail: `DWN interface or method is undefined` }
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

    const handlerKey = dwnInterface + dwnMethod;
    const interfaceMethodHandler = Dwn.methodHandlers[handlerKey];

    const methodHandlerReply = await interfaceMethodHandler(tenant, rawMessage as BaseMessage, this.messageStore, this.DidResolver);
    return methodHandlerReply;
  }
};

export type Config = {
  DidMethodResolvers?: DidMethodResolver[],
  interfaces?: Interface[];
  messageStore?: MessageStore;
};
