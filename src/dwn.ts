import type { DataStore } from './types/data-store.js';
import type { EventLog } from './types/event-log.js';
import type { GenericMessage } from './types/message-types.js';
import type { MessageStore } from './types/message-store.js';
import type { MethodHandler } from './types/method-handler.js';
import type { Readable } from 'readable-stream';
import type { RecordsWriteHandlerOptions } from './handlers/records-write.js';
import type { TenantGate } from './core/tenant-gate.js';
import type { GenericMessageReply, UnionMessageReply } from './core/message-reply.js';
import type { MessagesGetMessage, MessagesGetReply } from './types/messages-types.js';
import type { RecordsQueryMessage, RecordsQueryReply, RecordsReadMessage, RecordsReadReply, RecordsWriteMessage } from './types/records-types.js';

import { AllowAllTenantGate } from './core/tenant-gate.js';
import { DidResolver } from './did/did-resolver.js';
import { EventsGetHandler } from './handlers/events-get.js';
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
import { DwnInterfaceName, DwnMethodName, Message } from './core/message.js';

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
  public async processMessage(tenant: string, rawMessage: any, dataStream?: Readable): Promise<UnionMessageReply> {
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
   * Handles a `RecordsQuery` message.
   */
  public async handleRecordsQuery(tenant: string, message: RecordsQueryMessage): Promise<RecordsQueryReply> {
    const errorMessageReply =
      await this.validateTenant(tenant) ??
      await this.validateMessageIntegrity(message, DwnInterfaceName.Records, DwnMethodName.Query);
    if (errorMessageReply !== undefined) {
      return errorMessageReply;
    }

    const handler = new RecordsQueryHandler(this.didResolver, this.messageStore, this.dataStore);
    return handler.handle({ tenant, message });
  }

  /**
   * Handles a `RecordsRead` message.
   */
  public async handleRecordsRead(tenant: string, message: RecordsReadMessage): Promise<RecordsReadReply> {
    const errorMessageReply =
      await this.validateTenant(tenant) ??
      await this.validateMessageIntegrity(message, DwnInterfaceName.Records, DwnMethodName.Read);
    if (errorMessageReply !== undefined) {
      return errorMessageReply;
    }

    const handler = new RecordsReadHandler(this.didResolver, this.messageStore, this.dataStore);
    return handler.handle({ tenant, message });
  }

  /**
   * Handles a `MessagesGet` message.
   */
  public async handleMessagesGet(tenant: string, message: MessagesGetMessage): Promise<MessagesGetReply> {
    const errorMessageReply =
      await this.validateTenant(tenant) ??
      await this.validateMessageIntegrity(message, DwnInterfaceName.Messages, DwnMethodName.Get);
    if (errorMessageReply !== undefined) {
      return errorMessageReply;
    }

    const handler = new MessagesGetHandler(this.didResolver, this.messageStore, this.dataStore);
    return handler.handle({ tenant, message });
  }

  /**
   * Privileged method for writing a pruned initial `RecordsWrite` to a DWN without needing to supply associated data.
   */
  public async synchronizePrunedInitialRecordsWrite(tenant: string, message: RecordsWriteMessage): Promise<GenericMessageReply> {
    const errorMessageReply =
      await this.validateTenant(tenant) ??
      await this.validateMessageIntegrity(message, DwnInterfaceName.Records, DwnMethodName.Write);
    if (errorMessageReply !== undefined) {
      return errorMessageReply;
    }

    const options: RecordsWriteHandlerOptions = {
      skipDataStorage: true,
    };

    const handler = new RecordsWriteHandler(this.didResolver, this.messageStore, this.dataStore, this.eventLog);
    const methodHandlerReply = await handler.handle({ tenant, message, options });
    return methodHandlerReply;
  }

  /**
   * Checks tenant gate to see if tenant is allowed.
   * @param tenant The tenant DID to route the given message to.
   * @returns GenericMessageReply if the message has an integrity error, otherwise undefined.
   */
  public async validateTenant(tenant: string): Promise<GenericMessageReply | undefined> {
    const isTenant = await this.tenantGate.isTenant(tenant);
    if (!isTenant) {
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
    expectedInterface?: DwnInterfaceName,
    expectedMethod?: DwnMethodName,
  ): Promise<GenericMessageReply | undefined> {
    // Verify interface and method
    const dwnInterface = rawMessage?.descriptor?.interface;
    const dwnMethod = rawMessage?.descriptor?.method;
    if (dwnInterface === undefined || dwnMethod === undefined) {
      return {
        status: { code: 400, detail: `Both interface and method must be present, interface: ${dwnInterface}, method: ${dwnMethod}` }
      };
    }

    if (expectedInterface !== undefined && expectedInterface !== dwnInterface) {
      return {
        status: { code: 400, detail: `Expected interface ${expectedInterface}, received ${dwnInterface}` }
      };
    }
    if (expectedMethod !== undefined && expectedMethod !== dwnMethod) {
      return {
        status: { code: 400, detail: `Expected method ${expectedInterface}${expectedMethod}, received ${dwnInterface}${dwnMethod}` }
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
