import { base64url } from 'multiformats/bases/base64';
import { CollectionsWriteMessage } from '../interfaces/collections/types';
import { MessageStore } from '../store/message-store';

const methodToAllowedActionMap = {
  'CollectionsWrite': 'write',
};

/**
 * Performs protocol-based authorization against the given collections message.
 * @throws {Error} if authorization fails.
 */
export async function protocolAuthorize(
  message: CollectionsWriteMessage,
  requesterDid: string,
  messageStore: MessageStore
): Promise<void> {
  // fetch the protocol definition
  const protocolDefinition = await fetchProtocolDefinition(message, messageStore);

  // fetch ancestor message chain
  const ancestorMessageChain: CollectionsWriteMessage[] = await constructAncestorMessageChain(message, messageStore);

  // record schema -> record type map
  const recordSchemaToTypeMap: Map<string, string> = new Map();
  for (const recordTypeName in protocolDefinition.recordTypes) {
    const schema = protocolDefinition.recordTypes[recordTypeName].schema;
    recordSchemaToTypeMap[schema] = recordTypeName;
  }

  // get the rule set for the inbound message
  const inboundMessageRuleSet = getRuleSet(message, protocolDefinition, ancestorMessageChain, recordSchemaToTypeMap);

  // verify the requester of the inbound message against allowed requester rule
  verifyAllowedRequester(requesterDid, message.descriptor.target, inboundMessageRuleSet, ancestorMessageChain, recordSchemaToTypeMap);

  // verify method invoked against the allowed actions
  verifyAllowedActions(requesterDid, message, inboundMessageRuleSet);
}

/**
 * Fetches the protocol definition based on the protocol specified in the given message.
 * NOTE: this is a basic temporary implementation reusing Collections,
 * there will be a dedicated protocol interface for creating and fetching protocol definitions.
 */
async function fetchProtocolDefinition(message: CollectionsWriteMessage, messageStore: MessageStore): Promise<any> {
  // get the protocol URI
  const protocolUri = (message as CollectionsWriteMessage).descriptor.protocol;

  // fail if not a protocol-based object
  if (protocolUri === undefined) {
    throw new Error('message does not have a protocol property for protocol-based authorization');
  }

  // fetch the corresponding protocol definition, temporary stubbing using collections
  const query = {
    target   : message.descriptor.target,
    method   : 'CollectionsWrite',
    schema   : 'dwn-protocol',
    recordId : protocolUri
  };
  const protocols = await messageStore.query(query) as CollectionsWriteMessage[];

  if (protocols.length === 0) {
    throw new Error(`unable to find protocol definition for ${protocolUri}}`);
  }

  const protocolMessage = protocols[0];
  const decodedProtocolBytes = base64url.baseDecode(protocolMessage.encodedData);
  const protocolDefinition = JSON.parse(new TextDecoder().decode(decodedProtocolBytes));

  return protocolDefinition;
}

/**
 * Constructs a chain of ancestor messages
 * @returns the ancestor chain of messages where the first element is the root of the chain; returns empty array if no parent is specified.
 */
async function constructAncestorMessageChain(message: CollectionsWriteMessage, messageStore: MessageStore): Promise<any> {
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
function getRuleSet(
  inboundMessage: CollectionsWriteMessage,
  protocolDefinition: any,
  ancestorMessageChain: CollectionsWriteMessage[],
  recordSchemaToTypeMap: Map<string, string>
): any {
  // make a copy of the ancestor messages and include the inbound message in the chain
  const messageChain = [...ancestorMessageChain, inboundMessage];

  // walk down the ancestor message chain from the root ancestor record and match against the corresponding rule set at each level
  // to make sure the chain structure is allowed
  let allowedRecordTypesAtCurrentLevel = protocolDefinition.structures;
  let currentMessageIndex = 0;
  while (true) {
    const currentRecordSchema = messageChain[currentMessageIndex].descriptor.schema;
    const currentRecordType = recordSchemaToTypeMap[currentRecordSchema];

    if (currentRecordType === undefined) {
      throw new Error(`record with schema ${currentRecordSchema} not allowed in protocol`);
    }

    if (!(currentRecordType in allowedRecordTypesAtCurrentLevel)) {
      throw new Error(`record with schema: ${currentRecordSchema} not allowed in structure level ${currentMessageIndex}`);
    }

    // if we are looking at the inbound message itself (the last message in the chain),
    // then we have found the access control object we need to evaluate against
    if (currentMessageIndex === messageChain.length - 1) {
      return allowedRecordTypesAtCurrentLevel[currentRecordType];
    }

    // else we keep going down the message chain
    allowedRecordTypesAtCurrentLevel = allowedRecordTypesAtCurrentLevel[currentRecordType].records;
    currentMessageIndex++;
  }
}

/**
 * Verifies the requester of the given message is allowed actions based on the rule set.
 * @throws {Error} if requester not allowed.
 */
function verifyAllowedRequester(
  requesterDid: string,
  targetDid: string,
  inboundMessageRuleSet: any,
  ancestorMessageChain: CollectionsWriteMessage[],
  recordSchemaToTypeMap: Map<string, string>
): void {
  const allowRule = inboundMessageRuleSet.allow;
  if (allowRule === undefined) {
    // if no allow rule is defined, still allow if requester is the same as target, but throw otherwise
    if (requesterDid !== targetDid) {
      throw new Error(`no allow rule defined, ${requesterDid} is unauthorized`);
    }
  } else if (allowRule.anyone !== undefined) {
    // good to go to next check
  } else if (allowRule.recipient !== undefined) {
    // get the message to check for recipient based on the path given
    const messageForRecipientCheck = getMessage(ancestorMessageChain, allowRule.recipient.of, recordSchemaToTypeMap);
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
function verifyAllowedActions(requesterDid: string, message: CollectionsWriteMessage, inboundMessageRuleSet: any,): void {
  const allowRule = inboundMessageRuleSet.allow;

  if (allowRule === undefined) {
    // if no allow rule is defined, owner of DWN can do everything
    if (requesterDid === message.descriptor.target) {
      return;
    } else {
      throw new Error(`no allow rule defined, ${requesterDid} is unauthorized`);
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
    throw new Error(`inbound message action ${inboundMessageAction} not in list of allowed actions ${allowedActions}`);
  }
}

/**
 * Gets the message from the message chain based on the path specified.
 * @param messagePath `/` delimited path starting from the root ancestor.
 *                    Each path segment denotes the expected record type declared in protocol definition.
 *                    e.g. `A/B/C` means that the root ancestor must be of type A, its child must be of type B, followed by a child of type C.
 *                    NOTE: the path scheme use here may be temporary dependent on final protocol spec.
 */
function getMessage(
  messageChain: CollectionsWriteMessage[],
  messagePath: string,
  recordSchemaToTypeMap: Map<string, string>
): CollectionsWriteMessage {
  const ancestors = messagePath.split('/');

  let i = 0;
  while (true) {
    const expectedAncestorType = ancestors[i];
    const ancestorMessage = messageChain[i];

    if (expectedAncestorType === undefined) {
      throw new Error('expected ancestor cannot be undefined');
    }

    if (ancestorMessage === undefined) {
      throw new Error('ancestor message cannot be found');
    }

    const actualAncestorType = recordSchemaToTypeMap[ancestorMessage.descriptor.schema];
    if (actualAncestorType !== expectedAncestorType) {
      throw new Error(`mismatching message type: expecting ${expectedAncestorType} but actual ${actualAncestorType}`);
    }

    // we have found the message if we are looking at the last message specified by the path
    if (i + 1 === ancestors.length) {
      return ancestorMessage;
    }

    i++;
  }
}
