import type { BaseMessage } from './core/types.js';
import type { DataStore } from './store/data-store.js';
import type { MessageStore } from './store/message-store.js';
import type { MethodHandler } from './interfaces/types.js';
import type { Readable } from 'readable-stream';
import type { TenantGate } from './core/tenant-gate.js';

import { AllowAllTenantGate } from './core/tenant-gate.js';
import { DataStoreLevel } from './store/data-store-level.js';
import { DidResolver } from './did/did-resolver.js';
import { MessageReply } from './core/message-reply.js';
import { MessageStoreLevel } from './store/message-store-level.js';
import { PermissionsRequestHandler } from './interfaces/permissions/handlers/permissions-request.js';
import { ProtocolsConfigureHandler } from './interfaces/protocols/handlers/protocols-configure.js';
import { ProtocolsQueryHandler } from './interfaces/protocols/handlers/protocols-query.js';
import { RecordsDeleteHandler } from './interfaces/records/handlers/records-delete.js';
import { RecordsQueryHandler } from './interfaces/records/handlers/records-query.js';
import { RecordsWriteHandler } from './interfaces/records/handlers/records-write.js';
import { DwnInterfaceName, DwnMethodName, Message } from './core/message.js';

export class Dwn {
  private methodHandlers: { [key:string]: MethodHandler };
  private didResolver: DidResolver;
  private messageStore: MessageStore;
  private dataStore: DataStore;
  private tenantGate: TenantGate;

  private constructor(config: DwnConfig) {
    this.didResolver = config.didResolver;
    this.messageStore = config.messageStore;
    this.dataStore = config.dataStore;
    this.tenantGate = config.tenantGate;

    this.methodHandlers = {
      [DwnInterfaceName.Permissions + DwnMethodName.Request] : new PermissionsRequestHandler(this.didResolver, this.messageStore, this.dataStore),
      [DwnInterfaceName.Protocols + DwnMethodName.Configure] : new ProtocolsConfigureHandler(this.didResolver, this.messageStore, this.dataStore),
      [DwnInterfaceName.Protocols + DwnMethodName.Query]     : new ProtocolsQueryHandler(this.didResolver, this.messageStore, this.dataStore),
      [DwnInterfaceName.Records + DwnMethodName.Delete]      : new RecordsDeleteHandler(this.didResolver, this.messageStore, this.dataStore),
      [DwnInterfaceName.Records + DwnMethodName.Query]       : new RecordsQueryHandler(this.didResolver, this.messageStore, this.dataStore),
      [DwnInterfaceName.Records + DwnMethodName.Write]       : new RecordsWriteHandler(this.didResolver, this.messageStore, this.dataStore),
    };
  }

  /**
   * Creates an instance of the DWN.
   */
  static async create(config?: DwnConfig): Promise<Dwn> {
    config ??= { };
    config.didResolver ??= new DidResolver();
    config.tenantGate ??= new AllowAllTenantGate();
    config.messageStore ??= new MessageStoreLevel();
    config.dataStore ??= new DataStoreLevel();

    const dwn = new Dwn(config);
    await dwn.open();

    return dwn;
  }

  private async open(): Promise<void> {
    await this.messageStore.open();
    await this.dataStore.open();
  }

  async close(): Promise<void> {
    this.messageStore.close();
    this.dataStore.close();
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
    const methodHandlerReply = await this.methodHandlers[handlerKey].handle({
      tenant,
      message: rawMessage as BaseMessage,
      dataStream
    });
    return methodHandlerReply;
  }
};

export type DwnConfig = {
  didResolver?: DidResolver,
  messageStore?: MessageStore;
  dataStore?: DataStore;
  tenantGate?: TenantGate;
};
