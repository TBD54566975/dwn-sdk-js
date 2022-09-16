import type { BaseMessageSchema } from './types';

import { base64url } from 'multiformats/bases/base64';
import { CollectionsQuerySchema, CollectionsWriteSchema } from '../interfaces/collections/types';
import { MessageStore } from '../store/message-store';

const methodToAllowedActionMap = {
  'CollectionsWrite' : 'write',
  'CollectionsQuery' : 'query'
};

/**
 * Performs protocol-based authorization against the given collections message.
 * @throws {Error} if authorization fails.
 */
export async function protocolAuthorize(
  message: CollectionsWriteSchema | CollectionsQuerySchema,
  requesterDid: string,
  messageStore: MessageStore
): Promise<void> {
  // fetch the protocol definition
  const protocolDefinition = await fetchProtocolDefinition(message, messageStore);

  // fetch ancestor message chain
  const ancestorMessageChain: CollectionsWriteSchema[] = await constructAncestorMessageChain(message, messageStore);

  // record schema -> record type map
  const recordSchemaToTypeMap: Map<string, string> = new Map();
  for (const recordTypeName in protocolDefinition.recordTypes) {
    const schema = protocolDefinition.recordTypes[recordTypeName].schema;
    recordSchemaToTypeMap[schema] = recordTypeName;
  }

  // get the rule set for the inbound message
  const inboundMessageRuleSet = getRuleSet(message, protocolDefinition, ancestorMessageChain, recordSchemaToTypeMap);

  // corresponding rule set is found if code reaches here

  // verify the requester of the inbound message against allowed requester rule
  verifyAllowedRequester(requesterDid, inboundMessageRuleSet, ancestorMessageChain, recordSchemaToTypeMap);

  // verify method invoked against the allowed actions
  verifyAllowedActions(message, inboundMessageRuleSet);
}

/**
 * Fetches the protocol definition based on the protocol specified in the given message.
 * NOTE: this is a basic temporary implementation reusing Collections,
 * there will be a dedicated protocol interface for creating and fetching protocol definitions.
 */
async function fetchProtocolDefinition(message: CollectionsWriteSchema | CollectionsQuerySchema, messageStore: MessageStore): Promise<any> {
  // get the protocol URI
  let protocolUri: string;
  if (message.descriptor.method === 'CollectionsWrite') {
    protocolUri = (message as CollectionsWriteSchema).descriptor.protocol;
  } else {
    protocolUri = (message as CollectionsQuerySchema).descriptor.filter.protocol;
  }

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
  const protocols = await messageStore.query(query) as CollectionsWriteSchema[];

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
async function constructAncestorMessageChain(message: CollectionsWriteSchema | CollectionsQuerySchema, messageStore: MessageStore): Promise<any> {
  const ancestorMessageChain: CollectionsWriteSchema[] = [];

  let protocol;
  let contextId;
  let currentParentId;
  if (message.descriptor.method === 'CollectionsWrite') {
    const collectionsWriteMessage = (message as CollectionsWriteSchema);
    protocol = collectionsWriteMessage.descriptor.protocol;
    contextId = collectionsWriteMessage.descriptor.contextId;
    currentParentId = collectionsWriteMessage.descriptor.parentId;
  } else {
    const collectionsQueryMessage = (message as CollectionsQuerySchema);
    protocol = collectionsQueryMessage.descriptor.filter.protocol;
    contextId = collectionsQueryMessage.descriptor.filter.contextId;
    currentParentId = collectionsQueryMessage.descriptor.filter.parentId;
  }

  if (contextId === undefined) {
    throw new Error('`contextId` must exist for a protocol scoped message but is not specified');
  }

  // keep walking up the chain from the inbound message's parent, until there is no more parent
  while (currentParentId !== undefined) {
    // fetch parent
    const query = {
      target   : message.descriptor.target,
      method   : 'CollectionsWrite',
      protocol,
      contextId,
      recordId : currentParentId
    };
    const parentMessages = await messageStore.query(query) as CollectionsWriteSchema[];

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
  message: CollectionsWriteSchema | CollectionsQuerySchema,
  protocolDefinition: any,
  ancestorMessageChain: CollectionsWriteSchema[],
  recordSchemaToTypeMap: Map<string, string>
): any {
  // walk down the ancestor message chain from the root ancestor record and match against the corresponding rule set at each level
  // to make sure the chain structure is allowed
  let allowedRecordTypesAtCurrentLevel = protocolDefinition.structures;
  let currentMessageIndex = 0;
  while (ancestorMessageChain[currentMessageIndex] !== undefined) {
    const currentRecordSchema = ancestorMessageChain[currentMessageIndex].descriptor.schema;
    const currentRecordType = recordSchemaToTypeMap[currentRecordSchema];

    if (currentRecordType === undefined) {
      throw new Error(`record with schema ${currentRecordSchema} not allowed in protocol`);
    }

    if (!(currentRecordType in allowedRecordTypesAtCurrentLevel)) {
      throw new Error(`record with schema: ${currentRecordSchema} not allowed in structure level ${currentMessageIndex}`);
    }

    // else we keep going down the message chain
    allowedRecordTypesAtCurrentLevel = allowedRecordTypesAtCurrentLevel[currentRecordType].records;
    currentMessageIndex++;
  }

  // if the coe reaches here, currentStructureLevelRuleSet should have an entry for the type specified by the inbound message

  // get the rule set of the inbound message from its parent rule set
  let inboundMessageSchema;
  if (message.descriptor.method === 'CollectionsWrite') {
    inboundMessageSchema = (message as CollectionsWriteSchema).descriptor.schema;
  } else {
    inboundMessageSchema = (message as CollectionsQuerySchema).descriptor.filter.schema;
  }
  const inboundMessageRecordType = recordSchemaToTypeMap[inboundMessageSchema];
  const inboundMessageRuleSet = allowedRecordTypesAtCurrentLevel[inboundMessageRecordType];

  if (inboundMessageRuleSet === undefined) {
    throw new Error(`inbound message with schema ${inboundMessageSchema} not allowed in protocol`);
  }

  return inboundMessageRuleSet;
}

/**
 * Verifies the requester of the given message is allowed actions based on the rule set.
 * @throws {Error} if requester not allowed.
 */
function verifyAllowedRequester(
  requesterDid: string,
  inboundMessageRuleSet: any,
  ancestorMessageChain: CollectionsWriteSchema[],
  recordSchemaToTypeMap: Map<string, string>
): void {
  const allowRule = inboundMessageRuleSet.allow;
  if (allowRule.anyone !== undefined) {
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
    throw new Error(`no matching allow condition`);
  }
}

/**
 * Verifies the actions specified in the given message matches the allowed actions in the rule set.
 * @throws {Error} if action not allowed.
 */
function verifyAllowedActions(message: BaseMessageSchema, inboundMessageRuleSet: any,): void {
  const allowRule = inboundMessageRuleSet.allow;

  let allowedActions: string[];
  if (allowRule.anyone !== undefined) {
    allowedActions = allowRule.anyone.to;
  } else if (allowRule.recipient !== undefined) {
    allowedActions = allowRule.recipient.to;
  } // not possible to have `else` because of the above check already

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
function getMessage(messageChain: CollectionsWriteSchema[], messagePath: string, recordSchemaToTypeMap: Map<string, string>): CollectionsWriteSchema {
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
