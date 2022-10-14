import { CollectionsWriteMessage } from '../interfaces/collections/types';
import { MessageStore } from '../store/message-store';
import { ProtocolDefinition, ProtocolRuleSet, ProtocolsConfigureMessage } from '../interfaces/protocols/types';

const methodToAllowedActionMap = {
  'CollectionsWrite': 'write',
};

export class ProtocolAuthorization {

  /**
   * Performs protocol-based authorization against the given collections message.
   * @throws {Error} if authorization fails.
   */
  public static async authorize(
    message: CollectionsWriteMessage,
    requesterDid: string,
    messageStore: MessageStore
  ): Promise<void> {
  // fetch the protocol definition
    const protocolDefinition = await ProtocolAuthorization.fetchProtocolDefinition(message, messageStore);

    // fetch ancestor message chain
    const ancestorMessageChain: CollectionsWriteMessage[] = await ProtocolAuthorization.constructAncestorMessageChain(message, messageStore);

    // record schema -> schema label map
    const recordSchemaToLabelMap: Map<string, string> = new Map();
    for (const schemaLabel in protocolDefinition.labels) {
      const schema = protocolDefinition.labels[schemaLabel].schema;
      recordSchemaToLabelMap[schema] = schemaLabel;
    }

    // get the rule set for the inbound message
    const inboundMessageRuleSet = ProtocolAuthorization.getRuleSet(message, protocolDefinition, ancestorMessageChain, recordSchemaToLabelMap);

    // verify the requester of the inbound message against allowed requester rule
    ProtocolAuthorization.verifyAllowedRequester(
      requesterDid, message.descriptor.target, inboundMessageRuleSet, ancestorMessageChain, recordSchemaToLabelMap
    );

    // verify method invoked against the allowed actions
    ProtocolAuthorization.verifyAllowedActions(requesterDid, message, inboundMessageRuleSet);
  }

  /**
   * Fetches the protocol definition based on the protocol specified in the given message.
   */
  private static async fetchProtocolDefinition(message: CollectionsWriteMessage, messageStore: MessageStore): Promise<ProtocolDefinition> {
  // get the protocol URI
    const protocolUri = message.descriptor.protocol;

    // fetch the corresponding protocol definition
    const query = {
      target   : message.descriptor.target,
      method   : 'ProtocolsConfigure',
      protocol : protocolUri
    };
    const protocols = await messageStore.query(query) as ProtocolsConfigureMessage[];

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
  private static async constructAncestorMessageChain(message: CollectionsWriteMessage, messageStore: MessageStore)
    : Promise<CollectionsWriteMessage[]> {
    const ancestorMessageChain: CollectionsWriteMessage[] = [];

    const protocol = message.descriptor.protocol;
    const contextId = message.descriptor.contextId;

    if (contextId === undefined) {
      throw new Error('`contextId` must exist for a protocol scoped message but is not specified');
    }

    // keep walking up the chain from the inbound message's parent, until there is no more parent
    let currentParentId = message.descriptor.parentId;
    while (currentParentId !== undefined) {
    // fetch parent
      const query = {
        target   : message.descriptor.target,
        method   : 'CollectionsWrite',
        protocol,
        contextId,
        recordId : currentParentId
      };
      const parentMessages = await messageStore.query(query) as CollectionsWriteMessage[];

      if (parentMessages.length !== 1) {
        throw new Error(`must have exactly one parent but found ${parentMessages.length}}`);
      }

      const parent = parentMessages[0];
      ancestorMessageChain.push(parent);

      currentParentId = parent.descriptor.parentId;
    }

    return ancestorMessageChain.reverse(); // root ancestor first
  }

  /**
   * Gets the rule set corresponding to the inbound message.
   */
  private static getRuleSet(
    inboundMessage: CollectionsWriteMessage,
    protocolDefinition: ProtocolDefinition,
    ancestorMessageChain: CollectionsWriteMessage[],
    recordSchemaToLabelMap: Map<string, string>
  ): ProtocolRuleSet {
  // make a copy of the ancestor messages and include the inbound message in the chain
    const messageChain = [...ancestorMessageChain, inboundMessage];

    // walk down the ancestor message chain from the root ancestor record and match against the corresponding rule set at each level
    // to make sure the chain structure is allowed
    let allowedRecordsAtCurrentLevel = protocolDefinition.records;
    let currentMessageIndex = 0;
    while (true) {
      const currentRecordSchema = messageChain[currentMessageIndex].descriptor.schema;
      const currentRecordType = recordSchemaToLabelMap[currentRecordSchema];

      if (currentRecordType === undefined) {
        throw new Error(`record with schema '${currentRecordSchema}' not allowed in protocol`);
      }

      if (!(currentRecordType in allowedRecordsAtCurrentLevel)) {
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
   * Verifies the requester of the given message is allowed actions based on the rule set.
   * @throws {Error} if requester not allowed.
   */
  private static verifyAllowedRequester(
    requesterDid: string,
    targetDid: string,
    inboundMessageRuleSet: ProtocolRuleSet,
    ancestorMessageChain: CollectionsWriteMessage[],
    recordSchemaToLabelMap: Map<string, string>
  ): void {
    const allowRule = inboundMessageRuleSet.allow;
    if (allowRule === undefined) {
    // if no allow rule is defined, still allow if requester is the same as target, but throw otherwise
      if (requesterDid !== targetDid) {
        throw new Error(`no allow rule defined for requester, ${requesterDid} is unauthorized`);
      }
    } else if (allowRule.anyone !== undefined) {
    // good to go to next check
    } else if (allowRule.recipient !== undefined) {
    // get the message to check for recipient based on the path given
      const messageForRecipientCheck = ProtocolAuthorization.getMessage(ancestorMessageChain, allowRule.recipient.of, recordSchemaToLabelMap);
      const expectedRequesterDid = messageForRecipientCheck.descriptor.recipient;

      // the requester of the inbound message must be the recipient of the message obtained from the allow rule
      if (requesterDid !== expectedRequesterDid) {
        throw new Error(`unexpected inbound message author: ${requesterDid}, expected ${expectedRequesterDid}`);
      }
    } else {
      throw new Error(`no matching allow requester condition`);
    }
  }

  /**
   * Verifies the actions specified in the given message matches the allowed actions in the rule set.
   * @throws {Error} if action not allowed.
   */
  private static verifyAllowedActions(requesterDid: string, message: CollectionsWriteMessage, inboundMessageRuleSet: ProtocolRuleSet): void {
    const allowRule = inboundMessageRuleSet.allow;

    if (allowRule === undefined) {
    // if no allow rule is defined, owner of DWN can do everything
      if (requesterDid === message.descriptor.target) {
        return;
      } else {
        throw new Error(`no allow rule defined for ${message.descriptor.method}, ${requesterDid} is unauthorized`);
      }
    }

    let allowedActions: string[];
    if (allowRule.anyone !== undefined) {
      allowedActions = allowRule.anyone.to;
    } else if (allowRule.recipient !== undefined) {
      allowedActions = allowRule.recipient.to;
    } // not possible to have `else` because of same check already done by verifyAllowedRequester()

    const inboundMessageAction = methodToAllowedActionMap[message.descriptor.method];
    if (!allowedActions.includes(inboundMessageAction)) {
      throw new Error(`inbound message action '${inboundMessageAction}' not in list of allowed actions ${allowedActions}`);
    }
  }

  /**
   * Gets the message from the message chain based on the path specified.
   * @param messagePath `/` delimited path starting from the root ancestor.
   *                    Each path segment denotes the expected record type declared in protocol definition.
   *                    e.g. `A/B/C` means that the root ancestor must be of type A, its child must be of type B, followed by a child of type C.
   *                    NOTE: the path scheme use here may be temporary dependent on final protocol spec.
   */
  private static getMessage(
    ancestorMessageChain: CollectionsWriteMessage[],
    messagePath: string,
    recordSchemaToLabelMap: Map<string, string>
  ): CollectionsWriteMessage {
    const expectedAncestors = messagePath.split('/');

    // consider moving this check to ProtocolsConfigure message ingestion
    if (expectedAncestors.length > ancestorMessageChain.length) {
      throw new Error('specified path to expected recipient is longer than actual length of ancestor message chain');
    }

    let i = 0;
    while (true) {
      const expectedAncestorType = expectedAncestors[i];
      const ancestorMessage = ancestorMessageChain[i];

      const actualAncestorType = recordSchemaToLabelMap[ancestorMessage.descriptor.schema];
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