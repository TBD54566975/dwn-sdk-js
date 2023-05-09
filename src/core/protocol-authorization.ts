import type { MessageStore } from '../store/message-store.js';
import type { RecordsRead } from '../interfaces/records/messages/records-read.js';
import type { Filter, TimestampedMessage } from './types.js';
import type { ProtocolDefinition, ProtocolRuleSet, ProtocolsConfigureMessage, ProtocolType, ProtocolTypes } from '../interfaces/protocols/types.js';
import type { RecordsReadMessage, RecordsWriteMessage } from '../interfaces/records/types.js';

import { RecordsWrite } from '../interfaces/records/messages/records-write.js';
import { DwnError, DwnErrorCode } from './dwn-error.js';
import { DwnInterfaceName, DwnMethodName, Message } from './message.js';
import { ProtocolAction, ProtocolActor } from '../interfaces/protocols/types.js';

const methodToAllowedActionMap: Record<string, string> = {
  [DwnMethodName.Write] : ProtocolAction.Write,
  [DwnMethodName.Read]  : ProtocolAction.Read,
};

export class ProtocolAuthorization {

  /**
   * Performs protocol-based authorization against the given message.
   * @throws {Error} if authorization fails.
   */
  public static async authorize(
    tenant: string,
    incomingMessage: RecordsRead | RecordsWrite,
    requesterDid: string | undefined,
    messageStore: MessageStore
  ): Promise<void> {
    // fetch ancestor message chain
    const ancestorMessageChain: RecordsWriteMessage[] =
      await ProtocolAuthorization.constructAncestorMessageChain(tenant, incomingMessage, messageStore);

    // fetch the protocol definition
    const protocolDefinition = await ProtocolAuthorization.fetchProtocolDefinition(
      tenant,
      incomingMessage,
      ancestorMessageChain,
      messageStore
    );

    // validate `protocolPath`
    ProtocolAuthorization.verifyProtocolPath(
      incomingMessage,
      ancestorMessageChain,
      protocolDefinition.types
    );

    // get the rule set for the inbound message
    const inboundMessageRuleSet = ProtocolAuthorization.getRuleSet(
      incomingMessage.message,
      protocolDefinition,
      ancestorMessageChain
    );

    // Verify `dataFormat` and `schema` for the given `type`
    ProtocolAuthorization.verifyType(
      incomingMessage.message,
      protocolDefinition.types
    );

    // verify method invoked against the allowed actions
    ProtocolAuthorization.verifyAllowedActions(
      tenant,
      requesterDid,
      incomingMessage.message.descriptor.method,
      inboundMessageRuleSet,
      ancestorMessageChain,
    );

    // verify allowed condition of incoming message
    await ProtocolAuthorization.verifyActionCondition(tenant, incomingMessage, messageStore);
  }

  /**
   * Fetches the protocol definition based on the protocol specified in the given message.
   */
  private static async fetchProtocolDefinition(
    tenant: string,
    incomingMessage: RecordsRead | RecordsWrite,
    ancestorMessageChain: RecordsWriteMessage[],
    messageStore: MessageStore
  ): Promise<ProtocolDefinition> {
    // get the protocol URI
    let protocolUri: string;
    if (incomingMessage.message.descriptor.method === DwnMethodName.Write) {
      protocolUri = (incomingMessage as RecordsWrite).message.descriptor.protocol!;
    } else {
      protocolUri = ancestorMessageChain[ancestorMessageChain.length-1].descriptor.protocol!;
    }

    // fetch the corresponding protocol definition
    const query: Filter = {
      interface : DwnInterfaceName.Protocols,
      method    : DwnMethodName.Configure,
      protocol  : protocolUri
    };
    const protocols = await messageStore.query(tenant, query) as ProtocolsConfigureMessage[];

    if (protocols.length === 0) {
      throw new Error(`unable to find protocol definition for ${protocolUri}`);
    }

    const protocolMessage = protocols[0];
    return protocolMessage.descriptor.definition;
  }

  /**
   * Constructs a chain of ancestor messages
   * @returns the ancestor chain of messages where the first element is the root of the chain; returns empty array if no parent is specified.
   */
  private static async constructAncestorMessageChain(
    tenant: string,
    incomingMessage: RecordsRead | RecordsWrite,
    messageStore: MessageStore
  )
    : Promise<RecordsWriteMessage[]> {
    const ancestorMessageChain: RecordsWriteMessage[] = [];

    // Get first RecordsWrite in ancestor chain, or use incoming write message
    let recordsWrite: RecordsWrite;
    if (incomingMessage.message.descriptor.method === DwnMethodName.Write) {
      recordsWrite = incomingMessage as RecordsWrite;
    } else {
      const recordsRead = incomingMessage as RecordsRead;
      const query = {
        interface : DwnInterfaceName.Records,
        method    : DwnMethodName.Write,
        recordId  : recordsRead.message.descriptor.recordId,
      };
      const existingMessages = await messageStore.query(tenant, query) as TimestampedMessage[];
      const recordsWriteMessage = await RecordsWrite.getNewestMessage(existingMessages) as RecordsWriteMessage;
      recordsWrite = await RecordsWrite.parse(recordsWriteMessage);
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
      const parentMessages = await messageStore.query(tenant, query) as RecordsWriteMessage[];

      if (parentMessages.length === 0) {
        throw new Error(`no parent found with ID ${currentParentId}`);
      }

      const parent = parentMessages[0];
      ancestorMessageChain.push(parent);

      currentParentId = parent.descriptor.parentId;
    }

    return ancestorMessageChain.reverse(); // root ancestor first
  }

  /**
   * Gets the rule set corresponding to the given message chain.
   */
  private static getRuleSet(
    inboundMessage: RecordsReadMessage | RecordsWriteMessage,
    protocolDefinition: ProtocolDefinition,
    ancestorMessageChain: RecordsWriteMessage[],
  ): ProtocolRuleSet {
    let protocolPath: string;
    if (inboundMessage.descriptor.method === DwnMethodName.Write) {
      protocolPath = (inboundMessage as RecordsWriteMessage).descriptor.protocolPath!;
    } else {
      protocolPath = ancestorMessageChain[ancestorMessageChain.length-1].descriptor.protocolPath!;
    }
    const protocolPathArray = protocolPath.split('/');

    // traverse rule sets using protocolPath
    let currentRuleSet: ProtocolRuleSet = protocolDefinition;
    let i = 0;
    while (i < protocolPathArray.length) {
      const currentTypeId = protocolPathArray[i];
      const nextRuleSet = currentRuleSet.records?.[currentTypeId];

      if (nextRuleSet === undefined) {
        const partialProtocolPath = protocolPathArray.slice(0, i + 1).join('/');
        throw new DwnError(DwnErrorCode.ProtocolAuthorizationMissingRuleSet,
          `No rule set defined for protocolPath ${partialProtocolPath}`);
      }

      currentRuleSet = nextRuleSet;
      i++;
    }

    return currentRuleSet;
  }

  /**
   * Verifies the `protocolPath` declared in the given message (if it is a RecordsWrite) matches the path of actual ancestor chain.
   * @throws {DwnError} if fails verification.
   */
  private static verifyProtocolPath(
    inboundMessage: RecordsRead | RecordsWrite,
    ancestorMessageChain: RecordsWriteMessage[],
    types: ProtocolTypes,
  ): void {
    // skip verification if this is not a RecordsWrite
    if (inboundMessage.message.descriptor.method !== DwnMethodName.Write) {
      return;
    }

    const typeIds = Object.keys(types);
    const declaredProtocolPath = (inboundMessage as RecordsWrite).message.descriptor.protocolPath!;
    const declaredTypeId = ProtocolAuthorization.getTypeId(declaredProtocolPath);
    if (!typeIds.includes(declaredTypeId)) {
      throw new DwnError(DwnErrorCode.ProtocolAuthorizationInvalidType,
        `record with type ${declaredTypeId} not allowed in protocol`);
    }

    let ancestorProtocolPath: string = '';
    for (const ancestor of ancestorMessageChain) {
      const protocolPath = ancestor.descriptor.protocolPath!;
      const ancestorTypeId = ProtocolAuthorization.getTypeId(protocolPath);
      ancestorProtocolPath += `${ancestorTypeId}/`; // e.g. `foo/bar/`, notice the trailing slash
    }

    const actualProtocolPath = ancestorProtocolPath + declaredTypeId; // e.g. `foo/bar/baz`

    if (declaredProtocolPath !== actualProtocolPath) {
      throw new DwnError(
        DwnErrorCode.ProtocolAuthorizationIncorrectProtocolPath,
        `Declared protocol path '${declaredProtocolPath}' is not the same as actual protocol path '${actualProtocolPath}'.`
      );
    }
  }

  /**
   * Verifies the `dataFormat` and `schema` declared in the given message (if it is a RecordsWrite) matches dataFormat
   * and schema of the type in the given protocol.
   * @throws {DwnError} if fails verification.
   */
  private static verifyType(
    inboundMessage: RecordsReadMessage | RecordsWriteMessage,
    protocolTypes: ProtocolTypes,
  ): void {
    // skip verification if this is not a RecordsWrite
    if (inboundMessage.descriptor.method !== DwnMethodName.Write) {
      return;
    }
    const recordsWriteMessage = inboundMessage as RecordsWriteMessage;

    const protocolPath = recordsWriteMessage.descriptor.protocolPath!;
    const typeName = ProtocolAuthorization.getTypeId(protocolPath);
    // existence of type has already been verified
    const protocolType: ProtocolType = protocolTypes[typeName];

    // no `schema` specified in protocol definition means that any schema is allowed
    const { schema } = recordsWriteMessage.descriptor;
    if (protocolType.schema !== undefined && protocolType.schema !== schema) {
      throw new DwnError(
        DwnErrorCode.ProtocolAuthorizationInvalidSchema,
        `type '${typeName}' must have schema '${protocolType.schema}', \
        instead has '${schema}'`
      );
    }

    // no `dataFormats` specified in protocol definition means that all dataFormats are allowed
    const { dataFormat } = recordsWriteMessage.descriptor;
    if (protocolType.dataFormats !== undefined && !protocolType.dataFormats.includes(dataFormat)) {
      throw new DwnError(
        DwnErrorCode.ProtocolAuthorizationIncorrectDataFormat,
        `type '${typeName}' must have data format in (${protocolType.dataFormats}), \
        instead has '${dataFormat}'`
      );
    }
  }

  /**
   * Verifies the actions specified in the given message matches the allowed actions in the rule set.
   * @throws {Error} if action not allowed.
   */
  private static verifyAllowedActions(
    tenant: string,
    requesterDid: string | undefined,
    incomingMessageMethod: DwnMethodName,
    inboundMessageRuleSet: ProtocolRuleSet,
    ancestorMessageChain: RecordsWriteMessage[],
  ): void {
    const actionRules = inboundMessageRuleSet.$actions;

    if (actionRules === undefined) {
      // if no allow rule is defined, owner of DWN can do everything
      if (requesterDid === tenant) {
        return;
      } else {
        throw new Error(`no allow rule defined for ${incomingMessageMethod}, ${requesterDid} is unauthorized`);
      }
    }

    const allowedActions = new Set<string>();
    for (const allowRule of actionRules) {
      switch (allowRule.who) {
      case ProtocolActor.Anyone:
        allowedActions.add(allowRule.can);
        break;
      case ProtocolActor.Author:
        const messageForAuthorCheck = ProtocolAuthorization.getMessage(
          ancestorMessageChain,
          allowRule.of!,
        );

        if (messageForAuthorCheck !== undefined) {
          const expectedRequesterDid = Message.getAuthor(messageForAuthorCheck);

          if (requesterDid === expectedRequesterDid) {
            allowedActions.add(allowRule.can);
          }
        }
        break;
      case ProtocolActor.Recipient:
        const messageForRecipientCheck = ProtocolAuthorization.getMessage(
          ancestorMessageChain,
            allowRule.of!,
        );
        if (messageForRecipientCheck !== undefined) {
          const expectedRequesterDid = messageForRecipientCheck.descriptor.recipient;

          if (requesterDid === expectedRequesterDid) {
            allowedActions.add(allowRule.can);
          }
        }
        break;
        // default:
        //    JSON schema validations ensure that there are no other cases
      }
    }

    const inboundMessageAction = methodToAllowedActionMap[incomingMessageMethod];
    if (!allowedActions.has(inboundMessageAction)) {
      throw new Error(`inbound message action '${inboundMessageAction}' not in list of allowed actions (${new Array(...allowedActions).join(',')})`);
    }
  }

  /**
   * Verifies if the desired action can be taken.
   * Currently the only check is: if the write is not the initial write, the author must be the same as the initial write
   * @throws {Error} if fails verification
   */
  private static async verifyActionCondition(tenant: string, incomingMessage: RecordsRead | RecordsWrite, messageStore: MessageStore): Promise<void> {
    if (incomingMessage.message.descriptor.method === DwnMethodName.Read) {
      // Currently no conditions for reads
    } else if (incomingMessage.message.descriptor.method === DwnMethodName.Write) {
      const recordsWrite = incomingMessage as RecordsWrite;
      const isInitialWrite = await recordsWrite.isInitialWrite();
      if (!isInitialWrite) {
        // fetch the initialWrite
        const query = {
          entryId: recordsWrite.message.recordId
        };
        const result = await messageStore.query(tenant, query) as RecordsWriteMessage[];

        // check the author of the initial write matches the author of the incoming message
        const initialWrite = result[0];
        const authorOfInitialWrite = Message.getAuthor(initialWrite);
        if (recordsWrite.author !== authorOfInitialWrite) {
          throw new Error(`author of incoming message '${recordsWrite.author}' must match to author of initial write '${authorOfInitialWrite}'`);
        }
      }
    }
  }

  /**
   * Gets the message from the message chain based on the path specified.
   * Returns undefined if matching message does not existing in ancestor chain
   * @param protocolPath `/` delimited path starting from the root ancestor.
   *                    Each path segment denotes the expected record type declared in protocol definition.
   *                    e.g. `A/B/C` means that the root ancestor must be of type A, its child must be of type B, followed by a child of type C.
   *                    NOTE: the path scheme use here may be temporary dependent on final protocol spec.
   */
  private static getMessage(
    ancestorMessageChain: RecordsWriteMessage[],
    protocolPath: string,
  ): RecordsWriteMessage | undefined {
    const expectedAncestors = protocolPath.split('/');

    // consider moving this check to ProtocolsConfigure message ingestion
    if (expectedAncestors.length > ancestorMessageChain.length) {
      return undefined;
    }

    let i = 0;
    while (true) {
      const expectedDefinitionId = expectedAncestors[i];
      const ancestorMessage = ancestorMessageChain[i];

      const actualDefinitionId = ProtocolAuthorization.getTypeId(ancestorMessage.descriptor.protocolPath!);
      if (actualDefinitionId !== expectedDefinitionId) {
        throw new Error(`mismatching record schema: expecting ${expectedDefinitionId} but actual ${actualDefinitionId}`);
      }

      // we have found the message if we are looking at the last message specified by the path
      if (i + 1 === expectedAncestors.length) {
        return ancestorMessage;
      }

      i++;
    }
  }

  private static getTypeId(protocolPath: string): string {
    return protocolPath.split('/').slice(-1)[0];
  }
}