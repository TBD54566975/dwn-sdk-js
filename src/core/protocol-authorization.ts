import type { Filter } from '../types/message-types.js';
import type { MessageStore } from '../types/message-store.js';
import type { RecordsRead } from '../interfaces/records-read.js';
import type { RecordsWriteMessage } from '../types/records-types.js';
import type { ProtocolActionRule, ProtocolDefinition, ProtocolRuleSet, ProtocolsConfigureMessage, ProtocolType, ProtocolTypes } from '../types/protocols-types.js';

import { RecordsWrite } from '../interfaces/records-write.js';
import { DwnError, DwnErrorCode } from './dwn-error.js';
import { DwnInterfaceName, DwnMethodName } from './message.js';
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
      incomingMessage,
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
      incomingMessage,
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
   * Performs protocol-based authorization against the given message.
   * @param recordsWrite Either the incomingMessage itself if the incoming is a RecordsWrite,
   *                     or the latest RecordsWrite associated with the recordId being read.
   * @throws {Error} if authorization fails.
   */
  public static async authorize(
    tenant: string,
    incomingMessage: RecordsRead | RecordsWrite,
    recordsWrite: RecordsWrite,
    messageStore: MessageStore,
  ): Promise<void> {
    // fetch ancestor message chain
    const ancestorMessageChain: RecordsWriteMessage[] =
      await ProtocolAuthorization.constructAncestorMessageChain(tenant, incomingMessage, recordsWrite, messageStore);

    // fetch the protocol definition
    const protocolDefinition = await ProtocolAuthorization.fetchProtocolDefinition(
      tenant,
      recordsWrite,
      messageStore,
    );

    // get the rule set for the inbound message
    const inboundMessageRuleSet = ProtocolAuthorization.getRuleSet(
      recordsWrite,
      protocolDefinition,
    );

    // If the incoming message has `protocolRole` in the descriptor, validate the invoked role
    await ProtocolAuthorization.verifyInvokedRole(
      tenant,
      incomingMessage,
      recordsWrite,
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
    recordsWrite: RecordsWrite,
    messageStore: MessageStore
  ): Promise<ProtocolDefinition> {
    const protocolUri = recordsWrite.message.descriptor.protocol!;

    // fetch the corresponding protocol definition
    const query: Filter = {
      interface : DwnInterfaceName.Protocols,
      method    : DwnMethodName.Configure,
      protocol  : protocolUri
    };
    const { messages: protocols } = await messageStore.query(tenant, [ query ]);

    if (protocols.length === 0) {
      throw new Error(`unable to find protocol definition for ${protocolUri}`);
    }

    const protocolMessage = protocols[0] as ProtocolsConfigureMessage;
    return protocolMessage.descriptor.definition;
  }

  /**
   * Constructs a chain of ancestor messages
   * @returns the ancestor chain of messages where the first element is the root of the chain; returns empty array if no parent is specified.
   */
  private static async constructAncestorMessageChain(
    tenant: string,
    incomingMessage: RecordsRead | RecordsWrite,
    recordsWrite: RecordsWrite,
    messageStore: MessageStore
  )
    : Promise<RecordsWriteMessage[]> {
    const ancestorMessageChain: RecordsWriteMessage[] = [];

    if (incomingMessage.message.descriptor.method !== DwnMethodName.Write) {
      // Unless inboundMessage is a Write, recordsWrite is also an ancestor message
      ancestorMessageChain.push(recordsWrite.message);
    }

    const protocol = recordsWrite.message.descriptor.protocol!;
    const contextId = recordsWrite.message.contextId!;

    // keep walking up the chain from the inbound message's parent, until there is no more parent
    let currentParentId = recordsWrite.message.descriptor.parentId;
    while (currentParentId !== undefined) {
      // fetch parent
      const query: Filter = {
        interface : DwnInterfaceName.Records,
        method    : DwnMethodName.Write,
        protocol,
        contextId,
        recordId  : currentParentId
      };
      const { messages: parentMessages } = await messageStore.query(tenant, [ query ]);

      // We already check the immediate parent in `verifyProtocolPath`, so if it triggers,
      // it means a bug that caused an invalid message to be saved to the DWN.
      if (parentMessages.length === 0) {
        throw new Error(`no parent found with ID ${currentParentId}`);
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
    recordsWrite: RecordsWrite,
    protocolDefinition: ProtocolDefinition,
  ): ProtocolRuleSet {
    const protocolPath = recordsWrite.message.descriptor.protocolPath!;

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
      const { messages: parentMessages } = await messageStore.query(tenant, [ query ]);
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
    incomingMessage: RecordsRead | RecordsWrite,
    recordsWrite: RecordsWrite,
    protocolDefinition: ProtocolDefinition,
    messageStore: MessageStore,
  ): Promise<void> {
    const protocolRole = incomingMessage.authorSignaturePayload?.protocolRole;

    // Only verify role if there is a role being invoked
    if (protocolRole === undefined) {
      return;
    }

    const roleRuleSet = ProtocolAuthorization.getRuleSetAtProtocolPath(protocolRole, protocolDefinition);
    if (!roleRuleSet?.$globalRole && !roleRuleSet?.$contextRole) {
      throw new DwnError(
        DwnErrorCode.ProtocolAuthorizationNotARole,
        `Protocol path ${protocolRole} is not a valid protocolRole`
      );
    }

    const roleRecordFilter: Filter = {
      interface         : DwnInterfaceName.Records,
      method            : DwnMethodName.Write,
      protocol          : recordsWrite.message.descriptor.protocol!,
      protocolPath      : protocolRole,
      recipient         : incomingMessage.author!,
      isLatestBaseState : true,
    };
    if (roleRuleSet?.$contextRole) {
      roleRecordFilter.contextId = recordsWrite.message.contextId!;
    }
    const { messages: matchingMessages } = await messageStore.query(tenant, [roleRecordFilter]);

    if (matchingMessages.length === 0) {
      throw new DwnError(
        DwnErrorCode.ProtocolAuthorizationMissingRole,
        `No role record found for protocol path ${protocolRole}`
      );
    }
  }

  /**
   * Returns a list of ProtocolAction(s) based on the incoming message, one of which must be allowed for the message to be authorized.
   */
  private static async getActionsSeekingARuleMatch(
    tenant: string,
    incomingMessage: RecordsRead | RecordsWrite,
    messageStore: MessageStore,
  ): Promise<ProtocolAction[]> {
    if (incomingMessage.message.descriptor.method === DwnMethodName.Read) {
      return [ProtocolAction.Read];
    }
    // else 'Write'

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
  }

  /**
   * Verifies the action (e.g. read/write) specified in the given message matches the allowed actions in the rule set.
   * @throws {Error} if action not allowed.
   */
  private static async verifyAllowedActions(
    tenant: string,
    incomingMessage: RecordsRead | RecordsWrite,
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
      throw new Error(`no action rule defined for ${incomingMessageMethod}, ${author} is unauthorized`);
    }

    const invokedRole = incomingMessage.authorSignaturePayload?.protocolRole;

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
      } else if (actionRule.who === ProtocolActor.Anyone) {
        return;
      } else if (author === undefined) {
        continue;
      }

      const ancestorRuleSuccess: boolean = await ProtocolAuthorization.checkAncestorGroupActionRule(author, actionRule, ancestorMessageChain);
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
   * Checks if there is a RecordsWriteMessage in the ancestor chain that matches the protocolPath in given ProtocolActionRule.
   * Assumes that the actionRule authorizes either recipient or author, but not 'anyone'.
   * @returns true if there is an ancestorRecordsWrite that matches actionRule. false otherwise.
   */
  private static async checkAncestorGroupActionRule(
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