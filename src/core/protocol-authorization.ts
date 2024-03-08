import type { Filter } from '../types/query-types.js';
import type { MessageStore } from '../types/message-store.js';
import type { RecordsDelete } from '../interfaces/records-delete.js';
import type { RecordsQuery } from '../interfaces/records-query.js';
import type { RecordsRead } from '../interfaces/records-read.js';
import type { RecordsSubscribe } from '../interfaces/records-subscribe.js';
import type { RecordsWriteMessage } from '../types/records-types.js';
import type { ProtocolActionRule, ProtocolDefinition, ProtocolRuleSet, ProtocolsConfigureMessage, ProtocolType, ProtocolTypes } from '../types/protocols-types.js';

import { FilterUtility } from '../utils/filter.js';
import { Records } from '../utils/records.js';
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
    await ProtocolAuthorization.verifyProtocolPathAndContextId(
      tenant,
      incomingMessage,
      messageStore,
    );

    // get the rule set for the inbound message
    const ruleSet = ProtocolAuthorization.getRuleSet(
      incomingMessage.message.descriptor.protocolPath!,
      protocolDefinition,
    );

    // Validate as a role record if the incoming message is writing a role record
    await ProtocolAuthorization.verifyAsRoleRecordIfNeeded(
      tenant,
      incomingMessage,
      ruleSet,
      messageStore,
    );

    // Verify size limit
    ProtocolAuthorization.verifySizeLimit(incomingMessage, ruleSet);
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
    const ruleSet = ProtocolAuthorization.getRuleSet(
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

    // verify method invoked against the allowed actions in the rule set
    await ProtocolAuthorization.authorizeAgainstAllowedActions(
      tenant,
      incomingMessage,
      ruleSet,
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
    const ruleSet = ProtocolAuthorization.getRuleSet(
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

    // verify method invoked against the allowed actions in the rule set
    await ProtocolAuthorization.authorizeAgainstAllowedActions(
      tenant,
      incomingMessage,
      ruleSet,
      ancestorMessageChain,
      messageStore,
    );
  }

  public static async authorizeQueryOrSubscribe(
    tenant: string,
    incomingMessage: RecordsQuery | RecordsSubscribe,
    messageStore: MessageStore,
  ): Promise<void> {
    const { protocol, protocolPath, contextId } = incomingMessage.message.descriptor.filter;

    // fetch the protocol definition
    const protocolDefinition = await ProtocolAuthorization.fetchProtocolDefinition(
      tenant,
      protocol!, // `authorizeQueryOrSubscribe` is only called if `protocol` is present
      messageStore,
    );

    // get the rule set for the inbound message
    const ruleSet = ProtocolAuthorization.getRuleSet(
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

    // verify method invoked against the allowed actions in the rule set
    await ProtocolAuthorization.authorizeAgainstAllowedActions(
      tenant,
      incomingMessage,
      ruleSet,
      [], // ancestor chain is not relevant to subscriptions
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
    const ruleSet = ProtocolAuthorization.getRuleSet(
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

    // verify method invoked against the allowed actions in the rule set
    await ProtocolAuthorization.authorizeAgainstAllowedActions(
      tenant,
      incomingMessage,
      ruleSet,
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

    // keep walking up the chain from the inbound message's parent, until there is no more parent
    let currentParentId = newestRecordsWrite.message.descriptor.parentId;
    while (currentParentId !== undefined) {
      // fetch parent
      const query: Filter = {
        interface : DwnInterfaceName.Records,
        method    : DwnMethodName.Write,
        protocol,
        recordId  : currentParentId
      };
      const { messages: parentMessages } = await messageStore.query(tenant, [query]);

      // We already check the immediate parent in `verifyProtocolPathAndContextId` at the time of writing, so if this condition is triggered,
      // it means there is an unexpected bug that caused an invalid message being saved to the DWN.
      // We add additional defensive check here because returning an unexpected/incorrect ancestor chain could lead to security vulnerabilities.
      if (parentMessages.length === 0) {
        throw new DwnError(
          DwnErrorCode.ProtocolAuthorizationParentNotFoundConstructingAncestorChain,
          `Unexpected error that should never trigger: no parent found with ID ${currentParentId} when constructing ancestor message chain.`
        );
      }

      const parent = parentMessages[0] as RecordsWriteMessage;
      ancestorMessageChain.push(parent);

      currentParentId = parent.descriptor.parentId;
    }

    return ancestorMessageChain.reverse(); // root ancestor first
  }

  /**
   * Gets the rule set corresponding to the given protocolPath.
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
  private static async verifyProtocolPathAndContextId(
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

      return;
    }

    // Else `parentId` is defined, so we need to verify both protocolPath and contextId

    // fetch the parent message
    const protocol = inboundMessage.message.descriptor.protocol!;
    const query: Filter = {
      isLatestBaseState : true, // NOTE: this filter is critical, to ensure are are not returning a deleted parent
      interface         : DwnInterfaceName.Records,
      method            : DwnMethodName.Write,
      protocol,
      recordId          : parentId
    };
    const { messages: parentMessages } = await messageStore.query(tenant, [query]);
    const parentMessage = (parentMessages as RecordsWriteMessage[])[0];

    // verifying protocolPath of incoming message is a child of the parent message's protocolPath
    const parentProtocolPath = parentMessage?.descriptor?.protocolPath;
    const expectedProtocolPath = `${parentProtocolPath}/${declaredTypeName}`;
    if (expectedProtocolPath !== declaredProtocolPath) {
      throw new DwnError(
        DwnErrorCode.ProtocolAuthorizationIncorrectProtocolPath,
        `Could not find matching parent record to verify declared protocol path '${declaredProtocolPath}'.`
      );
    }

    // verifying contextId of incoming message is a child of the parent message's contextId
    const expectedContextId = `${parentMessage.contextId}/${inboundMessage.message.recordId}`;
    const actualContextId = inboundMessage.message.contextId;
    if (actualContextId !== expectedContextId) {
      throw new DwnError(
        DwnErrorCode.ProtocolAuthorizationIncorrectContextId,
        `Declared contextId '${actualContextId}' is not the same as expected: '${expectedContextId}'.`
      );
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
    incomingMessage: RecordsDelete | RecordsQuery | RecordsRead | RecordsSubscribe | RecordsWrite,
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
    if (roleRuleSet === undefined || !roleRuleSet.$role) {
      throw new DwnError(
        DwnErrorCode.ProtocolAuthorizationNotARole,
        `Protocol path ${protocolRole} does not match role record type.`
      );
    }

    // Construct a filter to fetch the invoked role record
    const roleRecordFilter: Filter = {
      interface         : DwnInterfaceName.Records,
      method            : DwnMethodName.Write,
      protocol          : protocolUri,
      protocolPath      : protocolRole,
      recipient         : incomingMessage.author!,
      isLatestBaseState : true,
    };

    const ancestorSegmentCountOfRolePath = protocolRole.split('/').length - 1;
    if (contextId === undefined && ancestorSegmentCountOfRolePath > 0) {
      throw new DwnError(
        DwnErrorCode.ProtocolAuthorizationMissingContextId,
        'Could not verify role because contextId is missing.'
      );
    }

    // Compute `contextId` prefix filter for fetching the invoked role record if the role path is not at the root level.
    // e.g. if invoked role path is `Thread/Participant`, and the `contextId` of the message is `threadX/messageY/attachmentZ`,
    // then we need to add a prefix filter as `threadX` for the `contextId`
    // because the `contextId` of the Participant record would be in the form of be `threadX/participantA`
    if (ancestorSegmentCountOfRolePath > 0) {
      const contextIdSegments = contextId!.split('/'); // NOTE: currently contextId segment count is never shorter than the role path count.
      const contextIdPrefix = contextIdSegments.slice(0, ancestorSegmentCountOfRolePath).join('/');
      const contextIdPrefixFilter = FilterUtility.constructPrefixFilterAsRangeFilter(contextIdPrefix);

      roleRecordFilter.contextId = contextIdPrefixFilter;
    }


    const { messages: matchingMessages } = await messageStore.query(tenant, [roleRecordFilter]);

    if (matchingMessages.length === 0) {
      throw new DwnError(
        DwnErrorCode.ProtocolAuthorizationMatchingRoleRecordNotFound,
        `No matching role record found for protocol path ${protocolRole}`
      );
    }
  }

  /**
   * Returns all the ProtocolActions that would authorized the incoming message
   * (but we still need to later verify if there is a rule defined that matches one of the actions).
   * NOTE: the reason why there could be multiple actions is because:
   * - In case of an initial RecordsWrite, the RecordsWrite can be authorized by an allow `create` or `write` rule.
   * - In case of a non-initial RecordsWrite by the original record author, the RecordsWrite can be authorized by a `write` or `co-update` rule.
   *
   * It is important to recognize that the `write` access that allowed the original record author to create the record maybe revoked
   * (e.g. by role revocation) by the time a "non-initial" write by the same author is attempted.
   */
  private static async getActionsSeekingARuleMatch(
    tenant: string,
    incomingMessage: RecordsDelete | RecordsQuery | RecordsRead | RecordsSubscribe | RecordsWrite,
    messageStore: MessageStore,
  ): Promise<ProtocolAction[]> {

    switch (incomingMessage.message.descriptor.method) {
    case DwnMethodName.Delete:
      const recordId = (incomingMessage as RecordsDelete).message.descriptor.recordId;
      const initialWrite = await RecordsWrite.fetchInitialRecordsWrite(messageStore, tenant, recordId);

      // if there is no initial write to delete, then no action rule can authorize the incoming message
      // NOTE: purely defensive programming: currently not reachable
      // because RecordsDelete handler already have an existence check prior to this method being called.
      if (initialWrite === undefined) {
        return [];
      }

      if (incomingMessage.author === initialWrite.author) {
        // A delete by the original record author can be authorized by either a 'delete' or 'co-delete' rule.
        return [ProtocolAction.Delete, ProtocolAction.CoDelete];
      } else {
        // A delete by someone who is not the original record author can only be authorized by a 'co-delete' rule.
        return [ProtocolAction.CoDelete];
      }

    case DwnMethodName.Query:
      return [ProtocolAction.Query];

    case DwnMethodName.Read:
      return [ProtocolAction.Read];

    case DwnMethodName.Subscribe:
      return [ProtocolAction.Subscribe];

    case DwnMethodName.Write:
      const incomingRecordsWrite = incomingMessage as RecordsWrite;

      if (await incomingRecordsWrite.isInitialWrite()) {
        return [ProtocolAction.Write, ProtocolAction.Create];
      } else {
        // else incoming RecordsWrite not initial write

        const recordId = (incomingMessage as RecordsWrite).message.recordId;
        const initialWrite = await RecordsWrite.fetchInitialRecordsWrite(messageStore, tenant, recordId);

        // if there is no initial write to update from, then no action rule can authorize the incoming message
        if (initialWrite === undefined) {
          return [];
        }

        if (incomingMessage.author === initialWrite.author) {
        // 'write', 'update' or 'co-update' action authorizes the incoming message
          return [ProtocolAction.Write, ProtocolAction.CoUpdate, ProtocolAction.Update];
        } else {
          // An update by someone who is not the record author can only be authorized by a 'co-update' rule.
          return [ProtocolAction.CoUpdate];
        }
      }
    }

    // purely defensive programming: should not be reachable
    return [];
  }

  /**
   * Verifies the given message is authorized by one of the action rules in the given protocol rule set.
   * @throws {Error} if action not allowed.
   */
  private static async authorizeAgainstAllowedActions(
    tenant: string,
    incomingMessage: RecordsDelete | RecordsQuery | RecordsRead | RecordsSubscribe | RecordsWrite,
    ruleSet: ProtocolRuleSet,
    ancestorMessageChain: RecordsWriteMessage[],
    messageStore: MessageStore,
  ): Promise<void> {
    const incomingMessageMethod = incomingMessage.message.descriptor.method;
    const actionsSeekingARuleMatch = await ProtocolAuthorization.getActionsSeekingARuleMatch(tenant, incomingMessage, messageStore);
    const author = incomingMessage.author;
    const actionRules = ruleSet.$actions;

    // We have already checked that the message is not from tenant, owner, or permissionsGrant
    if (actionRules === undefined) {
      throw new DwnError(
        DwnErrorCode.ProtocolAuthorizationActionRulesNotFound,
        `no action rule defined for ${incomingMessageMethod}, ${author} is unauthorized`
      );
    }

    const invokedRole = incomingMessage.signaturePayload?.protocolRole;

    // Iterate through the action rules to find a rule that authorizes the incoming message.
    for (const actionRule of actionRules) {
      // If the action rule does not have an allowed action that matches an action that can authorize the message, skip to evaluate next action rule.
      const ruleHasAMatchingAllowedAction = actionRule.can.some(allowedAction => actionsSeekingARuleMatch.includes(allowedAction as ProtocolAction));
      if (!ruleHasAMatchingAllowedAction) {
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
          // else the incoming message must be a RecordsDelete because only `co-update` and `co-delete` are allowed recipient actions
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

      // else we need to check the actor (e.g. author/recipient) allowed by current action rule in the corresponding ancestor message
      const ancestorRuleSuccess: boolean = await ProtocolAuthorization.checkActor(author, actionRule, ancestorMessageChain);
      if (ancestorRuleSuccess) {
        return;
      }
    }

    // No action rules were satisfied, author is not authorized
    throw new DwnError(
      DwnErrorCode.ProtocolAuthorizationActionNotAllowed,
      `inbound message action ${incomingMessageMethod} not allowed for author ${incomingMessage.author}`
    );
  }

  /**
   * Verifies that writes adhere to the $size constraints if provided
   * @throws {Error} if size is exceeded.
   */
  private static verifySizeLimit(
    incomingMessage: RecordsWrite,
    ruleSet: ProtocolRuleSet
  ): void {
    const { min = 0, max } = ruleSet.$size || {};

    const dataSize = incomingMessage.message.descriptor.dataSize;

    if (dataSize < min) {
      throw new DwnError(DwnErrorCode.ProtocolAuthorizationMinSizeInvalid, `data size ${dataSize} is less than allowed ${min}`);
    }

    if (max === undefined) {
      return;
    }

    if (dataSize > max) {
      throw new DwnError(DwnErrorCode.ProtocolAuthorizationMaxSizeInvalid, `data size ${dataSize} is more than allowed ${max}`);
    }
  }

  /**
   * If the given RecordsWrite is not a role record, this method does nothing and succeeds immediately.
   *
   * Else it verifies the validity of the given `RecordsWrite` as a role record, including:
   * 1. The same role has not been assigned to the same entity/recipient.
   */
  private static async verifyAsRoleRecordIfNeeded(
    tenant: string,
    incomingMessage: RecordsWrite,
    ruleSet: ProtocolRuleSet,
    messageStore: MessageStore,
  ): Promise<void> {
    if (!ruleSet.$role) {
      return;
    }

    // else this is a role record

    const incomingRecordsWrite = incomingMessage;
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

    const parentContextId = Records.getParentContextFromOfContextId(incomingRecordsWrite.message.contextId)!;

    // if this is not the root record, add a prefix filter to the query
    if (parentContextId !== '') {
      const prefixFilter = FilterUtility.constructPrefixFilterAsRangeFilter(parentContextId);
      filter.contextId = prefixFilter;
    }

    const { messages: matchingMessages } = await messageStore.query(tenant, [filter]);
    const matchingRecords = matchingMessages as RecordsWriteMessage[];
    const matchingRecordsExceptIncomingRecordId = matchingRecords.filter((recordsWriteMessage) =>
      recordsWriteMessage.recordId !== incomingRecordsWrite.message.recordId
    );
    if (matchingRecordsExceptIncomingRecordId.length > 0) {
      throw new DwnError(
        DwnErrorCode.ProtocolAuthorizationDuplicateRoleRecipient,
        `DID '${recipient}' is already recipient of a role record at protocol path '${protocolPath} under the parent context ${parentContextId}.`
      );
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

    if (ancestorRecordsWrite === undefined) {
      // If this is reached, there is likely an issue with the protocol definition.
      // The protocolPath to the actionRule should start with actionRule.of
      // consider moving this check to ProtocolsConfigure message ingestion
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