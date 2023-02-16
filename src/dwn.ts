import type { BaseMessage } from './core/types.js';
import type { DidMethodResolver } from './did/did-resolver.js';
import type { MessageStore } from './store/message-store.js';
import type { Readable } from 'readable-stream';
import type { TenantGate } from './core/tenant-gate.js';
import type { Interface, MethodHandler } from './interfaces/types.js';

import { AllowAllTenantGate } from './core/tenant-gate.js';
import { DidResolver } from './did/did-resolver.js';
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
  private tenantGate: TenantGate;

  private constructor(config: DwnConfig) {
    this.DidResolver = new DidResolver(config.didMethodResolvers);
    this.messageStore = config.messageStore;
    this.tenantGate = config.tenantGate;
  }

  /**
   * Creates an instance of the DWN.
   */
  static async create(config?: DwnConfig): Promise<Dwn> {
    config ??= { };
    config.tenantGate ??= new AllowAllTenantGate();
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
   * Processes the given DWN message and returns with a reply.
   * @param tenant The tenant DID to route the given message to.
   */
  async processMessage(tenant: string, rawMessage: any, dataStream?: Readable): Promise<MessageReply> {
    const isTenant = await this.tenantGate.isTenant(tenant);
    if (!isTenant) {
      return new MessageReply({
        status: { code: 401, detail: `${tenant} is not a tenant` }
      });
    }

    const dwnInterface = rawMessage?.descriptor?.interface;
    const dwnMethod = rawMessage?.descriptor?.method;
    if (dwnInterface === undefined || dwnMethod === undefined) {
      return new MessageReply({
        status: { code: 400, detail: `Both interface and method must be present, interface: ${dwnInterface}, method: ${dwnMethod}` }
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

    const methodHandlerReply = await interfaceMethodHandler({
      tenant,
      message      : rawMessage as BaseMessage,
      messageStore : this.messageStore,
      didResolver  : this.DidResolver,
      dataStream
    });
    return methodHandlerReply;
  }
};

export type DwnConfig = {
  didMethodResolvers?: DidMethodResolver[],
  interfaces?: Interface[];
  messageStore?: MessageStore;
  tenantGate?: TenantGate;
};
