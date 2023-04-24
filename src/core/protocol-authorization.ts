import type { MessageStore } from '../store/message-store.js';
import type { RecordsRead } from '../interfaces/records/messages/records-read.js';
import type { Filter, TimestampedMessage } from './types.js';
import type { ProtocolDefinition, ProtocolRuleSet, ProtocolsConfigureMessage } from '../interfaces/protocols/types.js';
import type { RecordsReadMessage, RecordsWriteMessage } from '../interfaces/records/types.js';

import { RecordsWrite } from '../interfaces/records/messages/records-write.js';
import { DwnError, DwnErrorCode } from './dwn-error.js';
import { DwnInterfaceName, DwnMethodName, Message } from './message.js';

const methodToAllowedActionMap: Record<string, string> = {
  [DwnMethodName.Write] : 'write',
  [DwnMethodName.Read]  : 'read',
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

    // record schema -> schema label map
    const recordSchemaToLabelMap: Map<string, string> = new Map();
    for (const schemaLabel in protocolDefinition.labels) {
      const schema = protocolDefinition.labels[schemaLabel].schema;
      recordSchemaToLabelMap.set(schema, schemaLabel);
    }

    // validate `protocolPath`
    ProtocolAuthorization.verifyProtocolPath(incomingMessage, ancestorMessageChain, recordSchemaToLabelMap);

    // get the rule set for the inbound message
    const inboundMessageRuleSet = ProtocolAuthorization.getRuleSet(
      incomingMessage.message,
      protocolDefinition,
      ancestorMessageChain,
      recordSchemaToLabelMap
    );

    // verify method invoked against the allowed actions
    ProtocolAuthorization.verifyAllowedActions(
      tenant,
      requesterDid,
      incomingMessage.message.descriptor.method,
      inboundMessageRuleSet,
      ancestorMessageChain,
      recordSchemaToLabelMap
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
    recordSchemaToLabelMap: Map<string, string>
  ): ProtocolRuleSet {
    // make a copy of the ancestor messages and include the inbound write in the chain
    const messageChain = [...ancestorMessageChain];
    if (inboundMessage.descriptor.method === DwnMethodName.Write) {
      messageChain.push(inboundMessage as RecordsWriteMessage);
    }

    // walk down the ancestor message chain from the root ancestor record and match against the corresponding rule set at each level
    // to make sure the chain structure is allowed
    let allowedRecordsAtCurrentLevel: { [key: string]: ProtocolRuleSet} | undefined = protocolDefinition.records;
    let currentMessageIndex = 0;
    while (true) {
      const currentRecordSchema = messageChain[currentMessageIndex].descriptor.schema!;
      const currentRecordType = recordSchemaToLabelMap.get(currentRecordSchema)!;

      if (allowedRecordsAtCurrentLevel === undefined || !(currentRecordType in allowedRecordsAtCurrentLevel)) {
        throw new Error(`record with schema: '${currentRecordSchema}' not allowed in structure level ${currentMessageIndex}`);
      }

      // if we are looking at the inbound message itself (the last message in the chain),
      // then we have found the access control object we need to evaluate against
      if (currentMessageIndex === messageChain.length - 1) {
        return allowedRecordsAtCurrentLevel[currentRecordType];
      }

      // else we keep going down the message chain
      allowedRecordsAtCurrentLevel = allowedRecordsAtCurrentLevel[currentRecordType].records;
      currentMessageIndex++;
    }
  }

  /**
   * Verifies the `protocolPath` declared in the given message (if it is a RecordsWrite) matches the path of actual ancestor chain.
   * @throws {DwnError} if fails verification.
   */
  private static verifyProtocolPath(
    inboundMessage: RecordsRead | RecordsWrite,
    ancestorMessageChain: RecordsWriteMessage[],
    recordSchemaToLabelMap: Map<string, string>
  ): void {
    // skip verification if this is not a RecordsWrite
    if (inboundMessage.message.descriptor.method !== DwnMethodName.Write) {
      return;
    }

    const currentRecordSchema = inboundMessage.message.descriptor.schema!;
    const currentRecordSchemaLabel = recordSchemaToLabelMap.get(currentRecordSchema);
    if (currentRecordSchemaLabel === undefined) {
      throw new DwnError(DwnErrorCode.ProtocolAuthorizationInvalidSchema, `record with schema '${currentRecordSchema}' not allowed in protocol`);
    }

    const declaredProtocolPath = (inboundMessage as RecordsWrite).message.descriptor.protocolPath!;
    let ancestorProtocolPath: string = '';
    for (const ancestor of ancestorMessageChain) {
      const ancestorSchemaLabel = recordSchemaToLabelMap.get(ancestor.descriptor.schema!);
      ancestorProtocolPath += `${ancestorSchemaLabel}/`; // e.g. `foo/bar/`, notice the trailing slash
    }

    const actualProtocolPath = ancestorProtocolPath + currentRecordSchemaLabel; // e.g. `foo/bar/baz`

    if (declaredProtocolPath !== actualProtocolPath) {
      throw new DwnError(
        DwnErrorCode.ProtocolAuthorizationIncorrectProtocolPath,
        `Declared protocol path '${declaredProtocolPath}' is not the same as actual protocol path '${actualProtocolPath}'.`
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
    recordSchemaToLabelMap: Map<string, string>
  ): void {
    const allowRule = inboundMessageRuleSet.allow;

    if (allowRule === undefined) {
      // if no allow rule is defined, owner of DWN can do everything
      if (requesterDid === tenant) {
        return;
      } else {
        throw new Error(`no allow rule defined for ${incomingMessageMethod}, ${requesterDid} is unauthorized`);
      }
    }

    const allowedActions = new Set<string>();
    if (allowRule.anyone !== undefined) {
      allowRule.anyone.to.forEach(action => allowedActions.add(action));
    }

    if (allowRule.author !== undefined) {
      const messageForAuthorCheck = ProtocolAuthorization.getMessage(
        ancestorMessageChain,
        allowRule.author.of,
        recordSchemaToLabelMap
      );
      if (messageForAuthorCheck !== undefined) {
        const expectedRequesterDid = Message.getAuthor(messageForAuthorCheck);

        if (requesterDid === expectedRequesterDid) {
          allowRule.author.to.forEach(action => allowedActions.add(action));
        }
      }
    }

    if (allowRule.recipient !== undefined) {
      const messageForRecipientCheck = ProtocolAuthorization.getMessage(
        ancestorMessageChain,
        allowRule.recipient.of,
        recordSchemaToLabelMap
      );
      if (messageForRecipientCheck !== undefined) {
        const expectedRequesterDid = messageForRecipientCheck.descriptor.recipient;

        if (requesterDid === expectedRequesterDid) {
          allowRule.recipient.to.forEach(action => allowedActions.add(action));
        }
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
   * @param messagePath `/` delimited path starting from the root ancestor.
   *                    Each path segment denotes the expected record type declared in protocol definition.
   *                    e.g. `A/B/C` means that the root ancestor must be of type A, its child must be of type B, followed by a child of type C.
   *                    NOTE: the path scheme use here may be temporary dependent on final protocol spec.
   */
  private static getMessage(
    ancestorMessageChain: RecordsWriteMessage[],
    messagePath: string,
    recordSchemaToLabelMap: Map<string, string>
  ): RecordsWriteMessage | undefined {
    const expectedAncestors = messagePath.split('/');

    // consider moving this check to ProtocolsConfigure message ingestion
    if (expectedAncestors.length > ancestorMessageChain.length) {
      return undefined;
    }

    let i = 0;
    while (true) {
      const expectedAncestorType = expectedAncestors[i];
      const ancestorMessage = ancestorMessageChain[i];

      const actualAncestorType = recordSchemaToLabelMap.get(ancestorMessage.descriptor.schema!);
      if (actualAncestorType !== expectedAncestorType) {
        throw new Error(`mismatching record schema: expecting ${expectedAncestorType} but actual ${actualAncestorType}`);
      }

      // we have found the message if we are looking at the last message specified by the path
      if (i + 1 === expectedAncestors.length) {
        return ancestorMessage;
      }

      i++;
    }
  }

}