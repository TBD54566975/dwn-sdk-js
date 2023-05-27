import type { BaseMessageReply } from './core/message-reply.js';
import type { DataStore } from './types/data-store.js';
import type { EventLog } from './types/event-log.js';
import type { MessageStore } from './types/message-store.js';
import type { MethodHandler } from './types/method-handler.js';
import type { Readable } from 'readable-stream';
import type { RecordsWriteHandlerOptions } from './interfaces/records/handlers/records-write.js';
import type { TenantGate } from './core/tenant-gate.js';
import type { DwnMessage, DwnMessageMap, DwnMessageReply } from './types/dwn-types.js';
import type { MessagesGetMessage, MessagesGetReply } from './types/messages-types.js';
import type { RecordsReadMessage, RecordsReadReply, RecordsWriteMessage } from './types/records-types.js';

import { AllowAllTenantGate } from './core/tenant-gate.js';
import { DataStoreLevel } from './store/data-store-level.js';
import { DidResolver } from './did/did-resolver.js';
import { EventLogLevel } from './event-log/event-log-level.js';
import { EventsGetHandler } from './interfaces/events/handlers/events-get.js';
import { messageReplyFromError } from './core/message-reply.js';
import { MessagesGetHandler } from './interfaces/messages/handlers/messages-get.js';
import { MessageStoreLevel } from './store/message-store-level.js';
import { ProtocolsConfigureHandler } from './interfaces/protocols/handlers/protocols-configure.js';
import { ProtocolsQueryHandler } from './interfaces/protocols/handlers/protocols-query.js';
import { RecordsDeleteHandler } from './interfaces/records/handlers/records-delete.js';
import { RecordsQueryHandler } from './interfaces/records/handlers/records-query.js';
import { RecordsReadHandler } from './interfaces/records/handlers/records-read.js';
import { RecordsWriteHandler } from './interfaces/records/handlers/records-write.js';
import { DwnInterfaceName, DwnMethodName, Message } from './core/message.js';

export class Dwn {
  private methodHandlers: { [key: string]: MethodHandler<keyof DwnMessageMap> };
  private didResolver: DidResolver;
  private messageStore: MessageStore;
  private dataStore: DataStore;
  private eventLog: EventLog;
  private tenantGate: TenantGate;

  private constructor(config: DwnConfig) {
    this.didResolver = config.didResolver!;
    this.messageStore = config.messageStore!;
    this.dataStore = config.dataStore!;
    this.eventLog = config.eventLog!;
    this.tenantGate = config.tenantGate!;

    this.methodHandlers = {
      [DwnInterfaceName.Events + DwnMethodName.Get]          : new EventsGetHandler(this.didResolver, this.eventLog),
      [DwnInterfaceName.Messages + DwnMethodName.Get]        : new MessagesGetHandler(this.didResolver, this.messageStore, this.dataStore),
      [DwnInterfaceName.Protocols + DwnMethodName.Configure] : new ProtocolsConfigureHandler(
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
  public static async create(config?: DwnConfig): Promise<Dwn> {
    config ??= { };
    config.didResolver ??= new DidResolver();
    config.tenantGate ??= new AllowAllTenantGate();
    config.messageStore ??= new MessageStoreLevel();
    config.dataStore ??= new DataStoreLevel();
    config.eventLog ??= new EventLogLevel();

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
  public async processMessage<M extends keyof DwnMessageMap>(
    tenant: string,
    messageType: M,
    rawMessage: DwnMessage<M>,
    dataStream?: Readable
  ): Promise<DwnMessageReply<M>> {
    const errorMessageReply = await this.preprocessingChecks(tenant, rawMessage, messageType);
    if (errorMessageReply !== undefined) {
      return errorMessageReply;
    }

    const handlerKey = rawMessage.descriptor.interface + rawMessage.descriptor.method;
    const methodHandlerReply = await this.methodHandlers[handlerKey].handle({
      tenant,
      message: rawMessage,
      dataStream
    });

    return methodHandlerReply;
  }

  /**
   * Handles a `RecordsRead` message.
   */
  public async handleRecordsRead(tenant: string, message: RecordsReadMessage): Promise<RecordsReadReply> {
    const errorMessageReply = await this.preprocessingChecks(tenant, message, DwnInterfaceName.Records + DwnMethodName.Read);
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
    const errorMessageReply = await this.preprocessingChecks(tenant, message, DwnInterfaceName.Messages + DwnMethodName.Get);
    if (errorMessageReply !== undefined) {
      return errorMessageReply;
    }

    const handler = new MessagesGetHandler(this.didResolver, this.messageStore, this.dataStore);
    return handler.handle({ tenant, message });
  }

  /**
   * Privileged method for writing a pruned initial `RecordsWrite` to a DWN without needing to supply associated data.
   */
  public async synchronizePrunedInitialRecordsWrite(tenant: string, message: RecordsWriteMessage): Promise<BaseMessageReply> {
    const errorMessageReply = await this.preprocessingChecks(tenant, message, DwnInterfaceName.Records + DwnMethodName.Write);
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
   * Common checks for handlers.
   */
  private async preprocessingChecks(
    tenant: string,
    rawMessage: any,
    expectedMessageType: string,
  ): Promise<BaseMessageReply | undefined> {
    const isTenant = await this.tenantGate.isTenant(tenant);
    if (!isTenant) {
      return {
        status: { code: 401, detail: `${tenant} is not a tenant` }
      };
    }

    // Verify interface and method
    const dwnInterface: string = rawMessage?.descriptor?.interface ?? '';
    const dwnMethod: string = rawMessage?.descriptor?.method ?? '';
    const actualMessageType = dwnInterface + dwnMethod;
    if (expectedMessageType !== actualMessageType) {
      return {
        status: { code: 400, detail: `Expected DWN message type ${expectedMessageType}, received ${actualMessageType}` }
      };
    }

    // validate message structure
    try {
      Message.validateJsonSchema(rawMessage);
    } catch (error) {
      return messageReplyFromError(error, 400);
    }

    return undefined;
  }

  public async dump(): Promise<void> {
    console.group('didResolver');
    await this.didResolver['dump']?.();
    console.groupEnd();

    console.group('messageStore');
    // @ts-ignore
    await this.messageStore['dump']?.();
    console.groupEnd();

    console.group('dataStore');
    // @ts-ignore
    await this.dataStore['dump']?.();
    console.groupEnd();

    console.group('eventLog');
    await this.eventLog['dump']?.();
    console.groupEnd();
  }
};

export type DwnConfig = {
  didResolver?: DidResolver,
  messageStore?: MessageStore;
  dataStore?: DataStore;
  tenantGate?: TenantGate;
  eventLog?: EventLog
};
