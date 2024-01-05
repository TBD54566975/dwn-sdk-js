import type { DataStore } from './types/data-store.js';
import type { EventLog } from './types/event-log.js';
import type { MessageStore } from './types/message-store.js';
import type { MethodHandler } from './types/method-handler.js';
import type { Readable } from 'readable-stream';
import type { TenantGate } from './core/tenant-gate.js';
import type { UnionMessageReply } from './core/message-reply.js';
import type { EventsGetMessage, EventsGetReply, EventsQueryMessage, EventsQueryReply } from './types/event-types.js';
import type { GenericMessage, GenericMessageReply } from './types/message-types.js';
import type { MessagesGetMessage, MessagesGetReply } from './types/messages-types.js';
import type { PermissionsGrantMessage, PermissionsRequestMessage, PermissionsRevokeMessage } from './types/permissions-types.js';
import type { ProtocolsConfigureMessage, ProtocolsQueryMessage, ProtocolsQueryReply } from './types/protocols-types.js';
import type { RecordsDeleteMessage, RecordsQueryMessage, RecordsQueryReply, RecordsReadMessage, RecordsReadReply, RecordsWriteMessage } from './types/records-types.js';

import { AllowAllTenantGate } from './core/tenant-gate.js';
import { DidResolver } from './did/did-resolver.js';
import { EventsGetHandler } from './handlers/events-get.js';
import { EventsQueryHandler } from './handlers/events-query.js';
import { Message } from './core/message.js';
import { messageReplyFromError } from './core/message-reply.js';
import { MessagesGetHandler } from './handlers/messages-get.js';
import { PermissionsGrantHandler } from './handlers/permissions-grant.js';
import { PermissionsRequestHandler } from './handlers/permissions-request.js';
import { PermissionsRevokeHandler } from './handlers/permissions-revoke.js';
import { ProtocolsConfigureHandler } from './handlers/protocols-configure.js';
import { ProtocolsQueryHandler } from './handlers/protocols-query.js';
import { RecordsDeleteHandler } from './handlers/records-delete.js';
import { RecordsQueryHandler } from './handlers/records-query.js';
import { RecordsReadHandler } from './handlers/records-read.js';
import { RecordsWriteHandler } from './handlers/records-write.js';
import { DwnInterfaceName, DwnMethodName } from './enums/dwn-interface-method.js';

export class Dwn {
  private methodHandlers: { [key:string]: MethodHandler };
  private didResolver: DidResolver;
  private messageStore: MessageStore;
  private dataStore: DataStore;
  private eventLog: EventLog;
  private tenantGate: TenantGate;

  private constructor(config: DwnConfig) {
    this.didResolver = config.didResolver!;
    this.tenantGate = config.tenantGate!;
    this.messageStore = config.messageStore;
    this.dataStore = config.dataStore;
    this.eventLog = config.eventLog;

    this.methodHandlers = {
      [DwnInterfaceName.Events + DwnMethodName.Get]        : new EventsGetHandler(this.didResolver, this.eventLog),
      [DwnInterfaceName.Events + DwnMethodName.Query]      : new EventsQueryHandler(this.didResolver, this.eventLog),
      [DwnInterfaceName.Messages + DwnMethodName.Get]      : new MessagesGetHandler(this.didResolver, this.messageStore, this.dataStore),
      [DwnInterfaceName.Permissions + DwnMethodName.Grant] : new PermissionsGrantHandler(
        this.didResolver, this.messageStore, this.eventLog),
      [DwnInterfaceName.Permissions + DwnMethodName.Request]: new PermissionsRequestHandler(
        this.didResolver, this.messageStore, this.eventLog),
      [DwnInterfaceName.Permissions + DwnMethodName.Revoke]: new PermissionsRevokeHandler(
        this.didResolver, this.messageStore, this.eventLog),
      [DwnInterfaceName.Protocols + DwnMethodName.Configure]: new ProtocolsConfigureHandler(
        this.didResolver, this.messageStore, this.dataStore, this.eventLog),
      [DwnInterfaceName.Protocols + DwnMethodName.Query] : new ProtocolsQueryHandler(this.didResolver, this.messageStore, this.dataStore),
      [DwnInterfaceName.Records + DwnMethodName.Delete]  : new RecordsDeleteHandler(
        this.didResolver, this.messageStore, this.dataStore, this.eventLog),
      [DwnInterfaceName.Records + DwnMethodName.Query] : new RecordsQueryHandler(this.didResolver, this.messageStore, this.dataStore),
      [DwnInterfaceName.Records + DwnMethodName.Read]  : new RecordsReadHandler(this.didResolver, this.messageStore, this.dataStore),
      [DwnInterfaceName.Records + DwnMethodName.Write] : new RecordsWriteHandler(this.didResolver, this.messageStore, this.dataStore, this.eventLog),
    };
  }

  /**
   * Creates an instance of the DWN.
   */
  public static async create(config: DwnConfig): Promise<Dwn> {
    config.didResolver ??= new DidResolver();
    config.tenantGate ??= new AllowAllTenantGate();

    const dwn = new Dwn(config);
    await dwn.open();

    return dwn;
  }

  private async open(): Promise<void> {
    await this.messageStore.open();
    await this.dataStore.open();
    await this.eventLog.open();
  }

  public async close(): Promise<void> {
    this.messageStore.close();
    this.dataStore.close();
    this.eventLog.close();
  }

  /**
   * Processes the given DWN message and returns with a reply.
   * @param tenant The tenant DID to route the given message to.
   */
  public async processMessage(tenant: string, rawMessage: EventsGetMessage): Promise<EventsGetReply>;
  public async processMessage(tenant: string, rawMessage: EventsQueryMessage): Promise<EventsQueryReply>;
  public async processMessage(tenant: string, rawMessage: MessagesGetMessage): Promise<MessagesGetReply>;
  public async processMessage(tenant: string, rawMessage: ProtocolsConfigureMessage): Promise<GenericMessageReply>;
  public async processMessage(tenant: string, rawMessage: ProtocolsQueryMessage): Promise<ProtocolsQueryReply>;
  public async processMessage(tenant: string, rawMessage: PermissionsRequestMessage): Promise<GenericMessageReply>;
  public async processMessage(tenant: string, rawMessage: PermissionsGrantMessage): Promise<GenericMessageReply>;
  public async processMessage(tenant: string, rawMessage: PermissionsRevokeMessage): Promise<GenericMessageReply>;
  public async processMessage(tenant: string, rawMessage: RecordsDeleteMessage): Promise<GenericMessageReply>;
  public async processMessage(tenant: string, rawMessage: RecordsQueryMessage): Promise<RecordsQueryReply>;
  public async processMessage(tenant: string, rawMessage: RecordsReadMessage): Promise<RecordsReadReply>;
  public async processMessage(tenant: string, rawMessage: RecordsWriteMessage, dataStream?: Readable): Promise<GenericMessageReply>;
  public async processMessage(tenant: string, rawMessage: unknown, dataStream?: Readable): Promise<UnionMessageReply>;
  public async processMessage(tenant: string, rawMessage: GenericMessage, dataStream?: Readable): Promise<UnionMessageReply> {
    const errorMessageReply = await this.validateTenant(tenant) ?? await this.validateMessageIntegrity(rawMessage);
    if (errorMessageReply !== undefined) {
      return errorMessageReply;
    }

    const handlerKey = rawMessage.descriptor.interface + rawMessage.descriptor.method;
    const methodHandlerReply = await this.methodHandlers[handlerKey].handle({
      tenant,
      message: rawMessage as GenericMessage,
      dataStream
    });

    return methodHandlerReply;
  }

  /**
   * Checks tenant gate to see if tenant is allowed.
   * @param tenant The tenant DID to route the given message to.
   * @returns GenericMessageReply if the message has an integrity error, otherwise undefined.
   */
  public async validateTenant(tenant: string): Promise<GenericMessageReply | undefined> {
    const isActiveTenant = await this.tenantGate.isActiveTenant(tenant);
    if (!isActiveTenant) {
      return {
        status: { code: 401, detail: `${tenant} is not a tenant` }
      };
    }
  }

  /**
   * Validates structure of DWN message
   * @param tenant The tenant DID to route the given message to.
   * @param dwnMessageInterface The interface of DWN message.
   * @param dwnMessageMethod The interface of DWN message.

   * @returns GenericMessageReply if the message has an integrity error, otherwise undefined.
   */
  public async validateMessageIntegrity(
    rawMessage: any,
  ): Promise<GenericMessageReply | undefined> {
    // Verify interface and method
    const dwnInterface = rawMessage?.descriptor?.interface;
    const dwnMethod = rawMessage?.descriptor?.method;
    if (dwnInterface === undefined || dwnMethod === undefined) {
      return {
        status: { code: 400, detail: `Both interface and method must be present, interface: ${dwnInterface}, method: ${dwnMethod}` }
      };
    }

    // validate message structure
    try {
      // consider to push this down to individual handlers
      Message.validateJsonSchema(rawMessage);
    } catch (error) {
      return messageReplyFromError(error, 400);
    }
  }
};

/**
 * DWN configuration.
 */
export type DwnConfig = {
  didResolver?: DidResolver,
  tenantGate?: TenantGate;

  messageStore: MessageStore;
  dataStore: DataStore;
  eventLog: EventLog
};
