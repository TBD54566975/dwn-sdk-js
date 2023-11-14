import type { Filter } from '../types/message-types.js';
import type { MessageStore } from '../types/message-store.js';
import type { RecordsDelete } from '../interfaces/records-delete.js';
import type { RecordsQuery } from '../interfaces/records-query.js';
import type { RecordsRead } from '../interfaces/records-read.js';
import type { RecordsWriteMessage } from '../types/records-types.js';
import type { ProtocolActionRule, ProtocolDefinition, ProtocolRuleSet, ProtocolsConfigureMessage, ProtocolType, ProtocolTypes } from '../types/protocols-types.js';

import { RecordsWrite } from '../interfaces/records-write.js';
import { DwnError, DwnErrorCode } from './dwn-error.js';
import { DwnInterfaceName, DwnMethodName } from '../enums/dwn-interface-method.js';
import { ProtocolAction, ProtocolActor } from '../types/protocols-types.js';

export class ProtocolAuthorization {

  /**
   * Performs validation on the structure of RecordsWrite messages that use a protocol.
   * @throws {Error} if validation fails.
   */
  public static async validateReferentialIntegrity(
    tenant: string,
    incomingMessage: RecordsWrite,
    messageStore: MessageStore,
  ): Promise<void> {
    // fetch the protocol definition
    const protocolDefinition = await ProtocolAuthorization.fetchProtocolDefinition(
      tenant,
      incomingMessage.message.descriptor.protocol!,
      messageStore,
    );

    // verify declared protocol type exists in protocol and that it conforms to type specification
    ProtocolAuthorization.verifyType(
      incomingMessage.message,
      protocolDefinition.types
    );

    // validate `protocolPath`
    await ProtocolAuthorization.verifyProtocolPath(
      tenant,
      incomingMessage,
      messageStore,
    );

    // get the rule set for the inbound message
    const inboundMessageRuleSet = ProtocolAuthorization.getRuleSet(
      incomingMessage.message.descriptor.protocolPath!,
      protocolDefinition,
    );

    // If the incoming message is writing a $globalRole record, validate that the recipient is unique
    await ProtocolAuthorization.verifyUniqueRoleRecipient(
      tenant,
      incomingMessage,
      inboundMessageRuleSet,
      messageStore,
    );
  }

  /**
   * Performs protocol-based authorization against the incoming RecordsWrite message.
   * @throws {Error} if authorization fails.
   */
  public static async authorizeWrite(
    tenant: string,
    incomingMessage: RecordsWrite,
    messageStore: MessageStore,
  ): Promise<void> {
    // fetch ancestor message chain
    const ancestorMessageChain: RecordsWriteMessage[] =
      await ProtocolAuthorization.constructAncestorMessageChain(tenant, incomingMessage, incomingMessage, messageStore);

    // fetch the protocol definition
    const protocolDefinition = await ProtocolAuthorization.fetchProtocolDefinition(
      tenant,
      incomingMessage.message.descriptor.protocol!,
      messageStore,
    );

    // get the rule set for the inbound message
    const inboundMessageRuleSet = ProtocolAuthorization.getRuleSet(
      incomingMessage.message.descriptor.protocolPath!,
      protocolDefinition,
    );

    // If the incoming message has `protocolRole` in the descriptor, validate the invoked role
    await ProtocolAuthorization.verifyInvokedRole(
      tenant,
      incomingMessage,
      incomingMessage.message.descriptor.protocol!,
      incomingMessage.message.contextId!,
      protocolDefinition,
      messageStore,
    );

    // verify method invoked against the allowed actions
    await ProtocolAuthorization.verifyAllowedActions(
      tenant,
      incomingMessage,
      inboundMessageRuleSet,
      ancestorMessageChain,
      messageStore,
    );
  }

  /**
   * Performs protocol-based authorization against the incoming RecordsRead  message.
   * @param newestRecordsWrite Either the incomingMessage itself if the incoming is a RecordsWrite,
   *                     or the latest RecordsWrite associated with the recordId being read.
   * @throws {Error} if authorization fails.
   */
  public static async authorizeRead(
    tenant: string,
    incomingMessage: RecordsRead,
    newestRecordsWrite: RecordsWrite,
    messageStore: MessageStore,
  ): Promise<void> {
    // fetch ancestor message chain
    const ancestorMessageChain: RecordsWriteMessage[] =
      await ProtocolAuthorization.constructAncestorMessageChain(tenant, incomingMessage, newestRecordsWrite, messageStore);

    // fetch the protocol definition
    const protocolDefinition = await ProtocolAuthorization.fetchProtocolDefinition(
      tenant,
      newestRecordsWrite.message.descriptor.protocol!,
      messageStore,
    );

    // get the rule set for the inbound message
    const inboundMessageRuleSet = ProtocolAuthorization.getRuleSet(
      newestRecordsWrite.message.descriptor.protocolPath!,
      protocolDefinition,
    );

    // If the incoming message has `protocolRole` in the descriptor, validate the invoked role
    await ProtocolAuthorization.verifyInvokedRole(
      tenant,
      incomingMessage,
      newestRecordsWrite.message.descriptor.protocol!,
      newestRecordsWrite.message.contextId!,
      protocolDefinition,
      messageStore,
    );

    // verify method invoked against the allowed actions
    await ProtocolAuthorization.verifyAllowedActions(
      tenant,
      incomingMessage,
      inboundMessageRuleSet,
      ancestorMessageChain,
      messageStore,
    );
  }

  /**
   * Performs protocol-based authorization against the incoming RecordsQuery message.
   * @throws {Error} if authorization fails.
   */
  public static async authorizeQuery(
    tenant: string,
    incomingMessage: RecordsQuery,
    messageStore: MessageStore,
  ): Promise<void> {
    // validate that required properties exist in query filter
    const { protocol, protocolPath, contextId } = incomingMessage.message.descriptor.filter;

    // fetch the protocol definition
    const protocolDefinition = await ProtocolAuthorization.fetchProtocolDefinition(
      tenant,
      protocol!, // authorizeQuery` is only called if `protocol` is present
      messageStore,
    );

    // get the rule set for the inbound message
    const inboundMessageRuleSet = ProtocolAuthorization.getRuleSet(
      protocolPath!, // presence of `protocolPath` is verified in `parse()`
      protocolDefinition,
    );

    // If the incoming message has `protocolRole` in the descriptor, validate the invoked role
    await ProtocolAuthorization.verifyInvokedRole(
      tenant,
      incomingMessage,
      protocol!,
      contextId,
      protocolDefinition,
      messageStore,
    );

    // verify method invoked against the allowed actions
    await ProtocolAuthorization.verifyAllowedActions(
      tenant,
      incomingMessage,
      inboundMessageRuleSet,
      [], // ancestor chain is not relevant to queries
      messageStore,
    );
  }

  public static async authorizeDelete(
    tenant: string,
    incomingMessage: RecordsDelete,
    newestRecordsWrite: RecordsWrite,
    messageStore: MessageStore,
  ): Promise<void> {

    // fetch ancestor message chain
    const ancestorMessageChain: RecordsWriteMessage[] =
      await ProtocolAuthorization.constructAncestorMessageChain(tenant, incomingMessage, newestRecordsWrite, messageStore);

    // fetch the protocol definition
    const protocolDefinition = await ProtocolAuthorization.fetchProtocolDefinition(
      tenant,
      newestRecordsWrite.message.descriptor.protocol!,
      messageStore,
    );

    // get the rule set for the inbound message
    const inboundMessageRuleSet = ProtocolAuthorization.getRuleSet(
      newestRecordsWrite.message.descriptor.protocolPath!,
      protocolDefinition,
    );

    // If the incoming message has `protocolRole` in the descriptor, validate the invoked role
    await ProtocolAuthorization.verifyInvokedRole(
      tenant,
      incomingMessage,
      newestRecordsWrite.message.descriptor.protocol!,
      newestRecordsWrite.message.contextId!,
      protocolDefinition,
      messageStore,
    );

    // verify method invoked against the allowed actions
    await ProtocolAuthorization.verifyAllowedActions(
      tenant,
      incomingMessage,
      inboundMessageRuleSet,
      ancestorMessageChain,
      messageStore,
    );

  }

  /**
   * Fetches the protocol definition based on the protocol specified in the given message.
   */
  private static async fetchProtocolDefinition(
    tenant: string,
    protocolUri: string,
    messageStore: MessageStore
  ): Promise<ProtocolDefinition> {
    // fetch the corresponding protocol definition
    const query: Filter = {
      interface : DwnInterfaceName.Protocols,
      method    : DwnMethodName.Configure,
      protocol  : protocolUri
    };
    const { messages: protocols } = await messageStore.query(tenant, [query]);

    if (protocols.length === 0) {
      throw new DwnError(DwnErrorCode.ProtocolAuthorizationProtocolNotFound, `unable to find protocol definition for ${protocolUri}`);
    }

    const protocolMessage = protocols[0] as ProtocolsConfigureMessage;
    return protocolMessage.descriptor.definition;
  }

  /**
   * Constructs a chain of ancestor messages
   * @param newestRecordsWrite The newest RecordsWrite associated with the recordId being written.
   *                           This will be the incoming RecordsWrite itself if the incoming message is a RecordsWrite.
   * @returns the ancestor chain of messages where the first element is the root of the chain; returns empty array if no parent is specified.
   */
  private static async constructAncestorMessageChain(
    tenant: string,
    incomingMessage: RecordsDelete | RecordsRead | RecordsWrite,
    newestRecordsWrite: RecordsWrite,
    messageStore: MessageStore
  )
    : Promise<RecordsWriteMessage[]> {
    const ancestorMessageChain: RecordsWriteMessage[] = [];

    if (incomingMessage.message.descriptor.method !== DwnMethodName.Write) {
      // Unless inboundMessage is a Write, recordsWrite is also an ancestor message
      ancestorMessageChain.push(newestRecordsWrite.message);
    }

    const protocol = newestRecordsWrite.message.descriptor.protocol!;
    const contextId = newestRecordsWrite.message.contextId!;

    // keep walking up the chain from the inbound message's parent, until there is no more parent
    let currentParentId = newestRecordsWrite.message.descriptor.parentId;
    while (currentParentId !== undefined) {
      // fetch parent
      const query: Filter = {
        interface : DwnInterfaceName.Records,
        method    : DwnMethodName.Write,
        protocol,
        contextId,
        recordId  : currentParentId
      };
      const { messages: parentMessages } = await messageStore.query(tenant, [query]);

      // We already check the immediate parent in `verifyProtocolPath`, so if it triggers,
      // it means a bug that caused an invalid message to be saved to the DWN.
      if (parentMessages.length === 0) {
        throw new DwnError(DwnErrorCode.ProtocolAuthorizationParentNotFound, `no parent found with ID ${currentParentId}`);
      }

      const parent = parentMessages[0] as RecordsWriteMessage;
      ancestorMessageChain.push(parent);

      currentParentId = parent.descriptor.parentId;
    }

    return ancestorMessageChain.reverse(); // root ancestor first
  }

  /**
   * Gets the rule set corresponding to the given message chain.
   */
  private static getRuleSet(
    protocolPath: string,
    protocolDefinition: ProtocolDefinition,
  ): ProtocolRuleSet {
    const ruleSet = ProtocolAuthorization.getRuleSetAtProtocolPath(protocolPath, protocolDefinition);
    if (ruleSet === undefined) {
      throw new DwnError(DwnErrorCode.ProtocolAuthorizationMissingRuleSet,
        `No rule set defined for protocolPath ${protocolPath}`);
    }
    return ruleSet;
  }

  /**
   * Verifies the `protocolPath` declared in the given message (if it is a RecordsWrite) matches the path of actual ancestor chain.
   * @throws {DwnError} if fails verification.
   */
  private static async verifyProtocolPath(
    tenant: string,
    inboundMessage: RecordsWrite,
    messageStore: MessageStore
  ): Promise<void> {
    const declaredProtocolPath = inboundMessage.message.descriptor.protocolPath!;
    const declaredTypeName = ProtocolAuthorization.getTypeName(declaredProtocolPath);

    const parentId = inboundMessage.message.descriptor.parentId;
    if (parentId === undefined) {
      if (declaredProtocolPath !== declaredTypeName) {
        throw new DwnError(
          DwnErrorCode.ProtocolAuthorizationParentlessIncorrectProtocolPath,
          `Declared protocol path '${declaredProtocolPath}' is not valid for records with no parentId'.`
        );
      }
    } else {
      const protocol = inboundMessage.message.descriptor.protocol!;
      const contextId = inboundMessage.message.contextId!;
      const query: Filter = {
        interface : DwnInterfaceName.Records,
        method    : DwnMethodName.Write,
        protocol,
        contextId,
        recordId  : parentId
      };
      const { messages: parentMessages } = await messageStore.query(tenant, [query]);
      const parentProtocolPath = (parentMessages as RecordsWriteMessage[])[0]?.descriptor?.protocolPath;
      const actualProtocolPath = `${parentProtocolPath}/${declaredTypeName}`;
      if (parentProtocolPath === undefined || actualProtocolPath !== declaredProtocolPath) {
        throw new DwnError(
          DwnErrorCode.ProtocolAuthorizationIncorrectProtocolPath,
          `Could not find matching parent record to verify declared protocol path '${declaredProtocolPath}'.`
        );
      }
    }
  }

  /**
   * Verifies the `dataFormat` and `schema` declared in the given message (if it is a RecordsWrite) matches dataFormat
   * and schema of the type in the given protocol.
   * @throws {DwnError} if fails verification.
   */
  private static verifyType(
    inboundMessage: RecordsWriteMessage,
    protocolTypes: ProtocolTypes,
  ): void {

    const typeNames = Object.keys(protocolTypes);
    const declaredProtocolPath = inboundMessage.descriptor.protocolPath!;
    const declaredTypeName = ProtocolAuthorization.getTypeName(declaredProtocolPath);
    if (!typeNames.includes(declaredTypeName)) {
      throw new DwnError(DwnErrorCode.ProtocolAuthorizationInvalidType,
        `record with type ${declaredTypeName} not allowed in protocol`);
    }

    const protocolPath = inboundMessage.descriptor.protocolPath!;
    // existence of `protocolType` has already been verified
    const typeName = ProtocolAuthorization.getTypeName(protocolPath);
    const protocolType: ProtocolType = protocolTypes[typeName];

    // no `schema` specified in protocol definition means that any schema is allowed
    const { schema } = inboundMessage.descriptor;
    if (protocolType.schema !== undefined && protocolType.schema !== schema) {
      throw new DwnError(
        DwnErrorCode.ProtocolAuthorizationInvalidSchema,
        `type '${typeName}' must have schema '${protocolType.schema}', \
        instead has '${schema}'`
      );
    }

    // no `dataFormats` specified in protocol definition means that all dataFormats are allowed
    const { dataFormat } = inboundMessage.descriptor;
    if (protocolType.dataFormats !== undefined && !protocolType.dataFormats.includes(dataFormat)) {
      throw new DwnError(
        DwnErrorCode.ProtocolAuthorizationIncorrectDataFormat,
        `type '${typeName}' must have data format in (${protocolType.dataFormats}), \
        instead has '${dataFormat}'`
      );
    }
  }

  /**
   * Check if the incoming message is invoking a role. If so, validate the invoked role.
   */
  private static async verifyInvokedRole(
    tenant: string,
    incomingMessage: RecordsDelete | RecordsQuery | RecordsRead | RecordsWrite,
    protocolUri: string,
    contextId: string | undefined,
    protocolDefinition: ProtocolDefinition,
    messageStore: MessageStore,
  ): Promise<void> {
    const protocolRole = incomingMessage.signaturePayload?.protocolRole;

    // Only verify role if there is a role being invoked
    if (protocolRole === undefined) {
      return;
    }

    const roleRuleSet = ProtocolAuthorization.getRuleSetAtProtocolPath(protocolRole, protocolDefinition);
    if (roleRuleSet === undefined || (!roleRuleSet.$globalRole && !roleRuleSet.$contextRole)) {
      throw new DwnError(
        DwnErrorCode.ProtocolAuthorizationNotARole,
        `Protocol path ${protocolRole} is not a valid protocolRole`
      );
    }

    const roleRecordFilter: Filter = {
      interface         : DwnInterfaceName.Records,
      method            : DwnMethodName.Write,
      protocol          : protocolUri,
      protocolPath      : protocolRole,
      recipient         : incomingMessage.author!,
      isLatestBaseState : true,
    };

    if (roleRuleSet.$contextRole) {
      if (contextId === undefined) {
        throw new DwnError(
          DwnErrorCode.ProtocolAuthorizationMissingContextId,
          'Could not verify $contextRole because contextId is missing'
        );
      }
      roleRecordFilter.contextId = contextId;
    }

    const { messages: matchingMessages } = await messageStore.query(tenant, [roleRecordFilter]);

    if (matchingMessages.length === 0) {
      throw new DwnError(
        DwnErrorCode.ProtocolAuthorizationMissingRole,
        `No matching role record found for protocol path ${protocolRole}`
      );
    }
  }

  /**
   * Returns a list of ProtocolAction(s) based on the incoming message, one of which must be allowed for the message to be authorized.
   * NOTE: the reason why there could be multiple actions is because in case of an "update" RecordsWrite by the original record author,
   * the RecordsWrite can either be authorized by a `write` or `update` allow rule. It is important to recognize that the `write` access that allowed
   * the original record author to create the record maybe revoked (e.g. by role revocation) by the time an "update" by the same author is attempted.
   */
  private static async getActionsSeekingARuleMatch(
    tenant: string,
    incomingMessage: RecordsDelete | RecordsQuery | RecordsRead | RecordsWrite,
    messageStore: MessageStore,
  ): Promise<ProtocolAction[]> {

    switch (incomingMessage.message.descriptor.method) {
    case DwnMethodName.Delete:
      return [ProtocolAction.Delete];

    case DwnMethodName.Query:
      return [ProtocolAction.Query];

    case DwnMethodName.Read:
      return [ProtocolAction.Read];

    case DwnMethodName.Write:
      const incomingRecordsWrite = incomingMessage as RecordsWrite;
      if (await incomingRecordsWrite.isInitialWrite()) {
        // only 'write' allows initial RecordsWrites; 'update' only applies to subsequent RecordsWrites
        return [ProtocolAction.Write];
      } else if (await incomingRecordsWrite.isAuthoredByInitialRecordAuthor(tenant, messageStore)) {
        // Both 'update' and 'write' authorize the incoming message
        return [ProtocolAction.Write, ProtocolAction.Update];
      } else {
        // Actors other than the initial record author must be authorized to 'update' the message
        return [ProtocolAction.Update];
      }

      // default:
      // not reachable in typescript
    }
  }

  /**
   * Verifies the action (e.g. read/write) specified in the given message matches the allowed actions in the rule set.
   * @throws {Error} if action not allowed.
   */
  private static async verifyAllowedActions(
    tenant: string,
    incomingMessage: RecordsDelete | RecordsQuery | RecordsRead | RecordsWrite,
    inboundMessageRuleSet: ProtocolRuleSet,
    ancestorMessageChain: RecordsWriteMessage[],
    messageStore: MessageStore,
  ): Promise<void> {
    const incomingMessageMethod = incomingMessage.message.descriptor.method;
    const inboundMessageActions = await ProtocolAuthorization.getActionsSeekingARuleMatch(tenant, incomingMessage, messageStore);
    const author = incomingMessage.author;
    const actionRules = inboundMessageRuleSet.$actions;

    // We have already checked that the message is not from tenant, owner, or permissionsGrant
    if (actionRules === undefined) {
      throw new DwnError(
        DwnErrorCode.ProtocolAuthorizationActionRulesNotFound,
        `no action rule defined for ${incomingMessageMethod}, ${author} is unauthorized`
      );
    }

    const invokedRole = incomingMessage.signaturePayload?.protocolRole;

    for (const actionRule of actionRules) {
      if (!inboundMessageActions.includes(actionRule.can as ProtocolAction)) {
        continue;
      }

      if (invokedRole !== undefined) {
        // When a protocol role is being invoked, we require that there is a matching `role` rule.
        if (actionRule.role === invokedRole) {
          // role is successfully invoked
          return;
        } else {
          continue;
        }
      } else if (actionRule.who === ProtocolActor.Recipient && actionRule.of === undefined && author !== undefined) {
        // Author must be recipient of the record being accessed
        let recordsWriteMessage: RecordsWriteMessage;
        if (incomingMessage.message.descriptor.method === DwnMethodName.Write) {
          recordsWriteMessage = incomingMessage.message as RecordsWriteMessage;
        } else {
          // else the incoming message must be a RecordsDelete because only `update` and `delete` are allowed recipient actions
          recordsWriteMessage = ancestorMessageChain[ancestorMessageChain.length - 1];
        }
        if (recordsWriteMessage.descriptor.recipient === author) {
          return;
        }
      } else if (actionRule.who === ProtocolActor.Anyone) {
        return;
      } else if (author === undefined) {
        continue;
      }

      const ancestorRuleSuccess: boolean = await ProtocolAuthorization.checkActor(author, actionRule, ancestorMessageChain);
      if (ancestorRuleSuccess) {
        return;
      }
    }

    // No action rules were satisfied, author is not authorized
    throw new DwnError(DwnErrorCode.ProtocolAuthorizationActionNotAllowed, `inbound message action not allowed for author`);
  }

  /**
   * Verifies that writes to a $globalRole or $contextRole record do not have the same recipient as an existing RecordsWrite
   * to the same $globalRole or the same $contextRole in the same context.
   */
  private static async verifyUniqueRoleRecipient(
    tenant: string,
    incomingMessage: RecordsWrite,
    inboundMessageRuleSet: ProtocolRuleSet,
    messageStore: MessageStore,
  ): Promise<void> {
    const incomingRecordsWrite = incomingMessage as RecordsWrite;
    if (!inboundMessageRuleSet.$globalRole && !inboundMessageRuleSet.$contextRole) {
      return;
    }

    const recipient = incomingRecordsWrite.message.descriptor.recipient;
    if (recipient === undefined) {
      throw new DwnError(
        DwnErrorCode.ProtocolAuthorizationRoleMissingRecipient,
        'Role records must have a recipient'
      );
    }
    const protocolPath = incomingRecordsWrite.message.descriptor.protocolPath!;
    const filter: Filter = {
      interface         : DwnInterfaceName.Records,
      method            : DwnMethodName.Write,
      isLatestBaseState : true,
      protocol          : incomingRecordsWrite.message.descriptor.protocol!,
      protocolPath,
      recipient,
    };
    if (inboundMessageRuleSet.$contextRole) {
      filter.contextId = incomingRecordsWrite.message.contextId!;
    }
    const { messages: matchingMessages } = await messageStore.query(tenant, [filter]);
    const matchingRecords = matchingMessages as RecordsWriteMessage[];
    const matchingRecordsExceptIncomingRecordId = matchingRecords.filter((recordsWriteMessage) =>
      recordsWriteMessage.recordId !== incomingRecordsWrite.message.recordId
    );
    if (matchingRecordsExceptIncomingRecordId.length > 0) {
      if (inboundMessageRuleSet.$globalRole) {
        throw new DwnError(
          DwnErrorCode.ProtocolAuthorizationDuplicateGlobalRoleRecipient,
          `DID '${recipient}' is already recipient of a $globalRole record at protocol path '${protocolPath}`
        );
      } else {
        // $contextRole
        throw new DwnError(
          DwnErrorCode.ProtocolAuthorizationDuplicateContextRoleRecipient,
          `DID '${recipient}' is already recipient of a $contextRole record at protocol path '${protocolPath} in the same context`
        );
      }
    }
  }

  private static getRuleSetAtProtocolPath(protocolPath: string, protocolDefinition: ProtocolDefinition): ProtocolRuleSet | undefined {
    const protocolPathArray = protocolPath.split('/');
    let currentRuleSet: ProtocolRuleSet = protocolDefinition.structure;
    let i = 0;
    while (i < protocolPathArray.length) {
      const currentTypeName = protocolPathArray[i];
      const nextRuleSet: ProtocolRuleSet | undefined = currentRuleSet[currentTypeName];

      if (nextRuleSet === undefined) {
        return undefined;
      }

      currentRuleSet = nextRuleSet;
      i++;
    }

    return currentRuleSet;
  }

  /**
   * Checks if there is a record in the ancestor chain matching the `who: 'author' | 'recipient'` action rule.
   * @returns true if the action rule is satisfied. false otherwise
   */
  private static async checkActor(
    author: string,
    actionRule: ProtocolActionRule,
    ancestorMessageChain: RecordsWriteMessage[],
  ): Promise<boolean> {
    // Iterate up the ancestor chain to find a message with matching protocolPath
    const ancestorRecordsWrite = ancestorMessageChain.find((recordsWriteMessage) =>
      recordsWriteMessage.descriptor.protocolPath === actionRule.of!
    );

    // If this is reached, there is likely an issue with the protocol definition.
    // The protocolPath to the actionRule should start with actionRule.of
    // consider moving this check to ProtocolsConfigure message ingestion
    if (ancestorRecordsWrite === undefined) {
      return false;
    }

    if (actionRule.who === ProtocolActor.Recipient) {
      // Recipient of ancestor message must be the author of the incoming message
      return author === ancestorRecordsWrite.descriptor.recipient;
    } else { // actionRule.who === ProtocolActor.Author
      // Author of ancestor message must be the author of the incoming message
      const ancestorAuthor = (await RecordsWrite.parse(ancestorRecordsWrite)).author;
      return author === ancestorAuthor;
    }
  }

  private static getTypeName(protocolPath: string): string {
    return protocolPath.split('/').slice(-1)[0];
  }
}