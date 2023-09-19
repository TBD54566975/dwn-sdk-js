import type { Filter } from '../types/message-types.js';
import type { MessageStore } from '../types/message-store.js';
import type { RecordsRead } from '../interfaces/records-read.js';
import type { InternalRecordsWriteMessage, RecordsReadMessage, RecordsWriteMessage } from '../types/records-types.js';
import type { ProtocolActionRule, ProtocolDefinition, ProtocolRuleSet, ProtocolsConfigureMessage, ProtocolType, ProtocolTypes } from '../types/protocols-types.js';

import { RecordsGrantAuthorization } from './records-grant-authorization.js';
import { RecordsWrite } from '../interfaces/records-write.js';
import { DwnError, DwnErrorCode } from './dwn-error.js';
import { DwnInterfaceName, DwnMethodName, Message } from './message.js';
import { ProtocolAction, ProtocolActor } from '../types/protocols-types.js';

const methodToAllowedActionMap: Record<string, ProtocolAction> = {
  [DwnMethodName.Write] : ProtocolAction.Write,
  [DwnMethodName.Read]  : ProtocolAction.Read,
};

export class ProtocolAuthorization {

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

    // verify declared protocol type exists in protocol and that it conforms to type specification
    ProtocolAuthorization.verifyType(
      incomingMessage.message,
      protocolDefinition.types
    );

    // validate `protocolPath`
    ProtocolAuthorization.verifyProtocolPath(
      incomingMessage,
      ancestorMessageChain,
    );

    // get the rule set for the inbound message
    const inboundMessageRuleSet = ProtocolAuthorization.getRuleSet(
      recordsWrite,
      protocolDefinition,
    );

    // verify method invoked against the allowed actions
    await ProtocolAuthorization.verifyAllowedActions(
      tenant,
      incomingMessage,
      recordsWrite,
      inboundMessageRuleSet,
      ancestorMessageChain,
      messageStore,
    );

    await ProtocolAuthorization.verifyUniqueRoleRecipient(
      tenant,
      incomingMessage,
      inboundMessageRuleSet,
      messageStore,
    );

    // verify allowed condition of incoming message
    await ProtocolAuthorization.verifyActionCondition(tenant, incomingMessage, messageStore);
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
    const protocolPathArray = protocolPath.split('/');

    // traverse rule sets using protocolPath
    let currentRuleSet: ProtocolRuleSet = protocolDefinition.structure;
    let i = 0;
    while (i < protocolPathArray.length) {
      const currentTypeName = protocolPathArray[i];
      const nextRuleSet: ProtocolRuleSet | undefined = currentRuleSet[currentTypeName];

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
  ): void {
    // skip verification if this is not a RecordsWrite
    if (inboundMessage.message.descriptor.method !== DwnMethodName.Write) {
      return;
    }

    const declaredProtocolPath = (inboundMessage as RecordsWrite).message.descriptor.protocolPath!;
    const declaredTypeName = ProtocolAuthorization.getTypeName(declaredProtocolPath);

    let ancestorProtocolPath: string = '';
    for (const ancestor of ancestorMessageChain) {
      const protocolPath = ancestor.descriptor.protocolPath!;
      const ancestorTypeName = ProtocolAuthorization.getTypeName(protocolPath);
      ancestorProtocolPath += `${ancestorTypeName}/`; // e.g. `foo/bar/`, notice the trailing slash
    }

    const actualProtocolPath = ancestorProtocolPath + declaredTypeName; // e.g. `foo/bar/baz`

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
    inboundMessage: RecordsReadMessage | InternalRecordsWriteMessage,
    protocolTypes: ProtocolTypes,
  ): void {
    // skip verification if this is not a RecordsWrite
    if (inboundMessage.descriptor.method !== DwnMethodName.Write) {
      return;
    }
    const recordsWriteMessage = inboundMessage as RecordsWriteMessage;

    const typeNames = Object.keys(protocolTypes);
    const declaredProtocolPath = recordsWriteMessage.descriptor.protocolPath!;
    const declaredTypeName = ProtocolAuthorization.getTypeName(declaredProtocolPath);
    if (!typeNames.includes(declaredTypeName)) {
      throw new DwnError(DwnErrorCode.ProtocolAuthorizationInvalidType,
        `record with type ${declaredTypeName} not allowed in protocol`);
    }

    const protocolPath = recordsWriteMessage.descriptor.protocolPath!;
    // existence of `protocolType` has already been verified
    const typeName = ProtocolAuthorization.getTypeName(protocolPath);
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
  private static async verifyAllowedActions(
    tenant: string,
    incomingMessage: RecordsRead | RecordsWrite,
    recordsWrite: RecordsWrite,
    inboundMessageRuleSet: ProtocolRuleSet,
    ancestorMessageChain: RecordsWriteMessage[],
    messageStore: MessageStore,
  ): Promise<void> {
    const inboundMessageAction = methodToAllowedActionMap[incomingMessage.message.descriptor.method];
    const author = incomingMessage.author;

    const actionRules = inboundMessageRuleSet.$actions;
    if (author === tenant) {
      // tenant is always authorized
      return;
    } else if (incomingMessage.author !== undefined && incomingMessage.authorizationPayload?.permissionsGrantId !== undefined) {
      // PermissionsGrant gives the author explicit access to this record
      if (incomingMessage.message.descriptor.method === DwnMethodName.Write) {
        await RecordsGrantAuthorization.authorizeWrite(tenant, incomingMessage as RecordsWrite, incomingMessage.author, messageStore);
      } else {
        await RecordsGrantAuthorization.authorizeRead(
          tenant,
          incomingMessage as RecordsRead,
          recordsWrite,
          incomingMessage.author,
          messageStore
        );
      }
      return;
    } else if (actionRules === undefined) {
      throw new Error(`no action rule defined for ${incomingMessage.message.descriptor.method}, ${author} is unauthorized`);
    }

    for (const actionRule of actionRules) {
      if (actionRule.can !== inboundMessageAction) {
        continue;
      }

      if (actionRule.who === ProtocolActor.Anyone) {
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
    throw new DwnError(DwnErrorCode.ProtocolAuthorizationActionNotAllowed, `inbound message action ${inboundMessageAction} not allowed for author`);
  }

  /**
   * Verifies that writes to a $globalRole record do not have the same recipient as an existing RecordsWrite
   * to the same $globalRole.
   */
  private static async verifyUniqueRoleRecipient(
    tenant: string,
    incomingMessage: RecordsRead | RecordsWrite,
    inboundMessageRuleSet: ProtocolRuleSet,
    messageStore: MessageStore,
  ): Promise<void> {
    if (incomingMessage.message.descriptor.method !== DwnMethodName.Write) {
      return;
    }

    const incomingRecordsWrite = incomingMessage as RecordsWrite;
    if (!inboundMessageRuleSet.$globalRole) {
      return;
    }

    // FIXME(diehuxx): do we enforce presence of recipient for protocol records? I thought we required it
    const recipient = incomingRecordsWrite.message.descriptor.recipient!;
    const protocolPath = incomingRecordsWrite.message.descriptor.protocolPath!;
    const filter = {
      interface         : DwnInterfaceName.Records,
      method            : DwnMethodName.Write,
      isLatestBaseState : true,
      protocol          : incomingRecordsWrite.message.descriptor.protocol!,
      protocolPath,
      recipient,
    };
    const { messages: matchingMessages } = await messageStore.query(tenant, [filter]);
    const matchingRecords = matchingMessages as RecordsWriteMessage[];
    const matchingRecordsExceptIncomingRecordId = matchingRecords.filter((recordsWriteMessage) =>
      recordsWriteMessage.recordId !== incomingRecordsWrite.message.recordId
    );
    if (matchingRecordsExceptIncomingRecordId.length > 0) {
      throw new DwnError(
        DwnErrorCode.ProtocolsAuthorizationDuplicateGlobalRoleRecipient,
        `DID '${recipient}' is already recipient of a $globalRole record at protocol path '${protocolPath}`
      );
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
        const { messages: result } = await messageStore.query(tenant, [ query ]);

        // check the author of the initial write matches the author of the incoming message
        const initialWrite = result[0] as RecordsWriteMessage;
        const authorOfInitialWrite = Message.getAuthor(initialWrite);
        if (recordsWrite.author !== authorOfInitialWrite) {
          throw new Error(`author of incoming message '${recordsWrite.author}' must match to author of initial write '${authorOfInitialWrite}'`);
        }
      }
    }
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