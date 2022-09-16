import type { Authorization, BaseMessageSchema } from './types';
import type { AuthVerificationResult } from './types';
import type { SignatureInput } from '../jose/jws/general/types';

import { GeneralJwsSigner, GeneralJwsVerifier } from '../jose/jws/general';
import { generateCid, parseCid } from '../utils/cid';
import lodash from 'lodash';
import { DIDResolver } from '../did/did-resolver';
import { CID } from 'multiformats';
import { GeneralJws } from '../jose/jws/general/types';
import { CollectionsQuerySchema, CollectionsWriteSchema } from '../interfaces/collections/types';
import { MessageStore } from '../store/message-store';
import { base64url } from 'multiformats/bases/base64';

const { isPlainObject } = lodash;

type PayloadConstraints = {
  /** permissible properties within payload. Note that `descriptorCid` is implied and does not need to be added */
  properties: Set<string>;
};

/**
 * Authenticates then authorizes the given Permissions message.
 * @throws {Error} if auth fails
 */
export async function verifyAuth(
  message: BaseMessageSchema & Authorization,
  didResolver: DIDResolver,
  messageStore: MessageStore,
  payloadConstraints?: PayloadConstraints
): Promise<AuthVerificationResult> {
  // signature verification is computationally intensive, so we're going to start by validating the payload.
  const parsedPayload = await validateSchema(message, payloadConstraints);

  const signers = await authenticate(message.authorization, didResolver);

  // authorization
  switch (message.descriptor.method) {
  case 'PermissionsRequest':
    await authorizePermissionsMessage(message, signers);
    break;
  case 'CollectionsWrite':
  case 'CollectionsQuery':
    await authorizeCollectionsMessage(message as CollectionsQuerySchema | CollectionsWriteSchema, signers, messageStore);
    break;
  default:
    throw new Error(`unknown message method type for auth: ${message.descriptor.method}`);
  }

  return { payload: parsedPayload, signers };
}

async function validateSchema(
  message: BaseMessageSchema & Authorization,
  payloadConstraints?: PayloadConstraints
): Promise<{ descriptorCid: CID, [key: string]: CID }> {

  if (message.authorization.signatures.length !== 1) {
    throw new Error('expected no more than 1 signature for authorization');
  }

  const payloadJson = GeneralJwsVerifier.decodeJsonPayload(message.authorization);

  if (!isPlainObject(payloadJson)) {
    throw new Error('auth payload must be a valid JSON object');
  }

  // the authorization payload should, at minimum, always contain `descriptorCid` regardless
  // of whatever else is present.
  const { descriptorCid } = payloadJson;
  if (!descriptorCid) {
    throw new Error('descriptorCid must be present in authorization payload');
  }

  // check to ensure that the provided descriptorCid matches the CID of the actual message

  // parseCid throws an exception if parsing fails
  const providedDescriptorCid = parseCid(descriptorCid);
  const expectedDescriptorCid = await generateCid(message.descriptor);

  if (!providedDescriptorCid.equals(expectedDescriptorCid)) {
    throw new Error('provided descriptorCid does not match expected CID');
  }

  // property bag for all properties inspected
  const parsedPayload = { descriptorCid: providedDescriptorCid };

  payloadConstraints = payloadConstraints || { properties: new Set([]) };

  // add `descriptorCid` because it's always required
  payloadConstraints.properties.add('descriptorCid');

  // check to ensure that no unexpected properties exist in payload.
  for (const field in payloadJson) {
    if (!payloadConstraints.properties.has(field)) {
      throw new Error(`${field} not allowed in auth payload.`);
    }

    try {
      parsedPayload[field] = parseCid(payloadJson[field]);
    } catch (e) {
      throw new Error(`${field} must be a valid CID`);
    }
  }

  return parsedPayload;
}

async function authenticate(jws: GeneralJws, didResolver: DIDResolver): Promise<string[]> {
  const verifier = new GeneralJwsVerifier(jws);
  const { signers } = await verifier.verify(didResolver);
  return signers;
}

async function authorizePermissionsMessage(message: BaseMessageSchema, signers: string[]): Promise<void> {
  // if requester is the same as the target DID, we can directly grant access
  if (signers[0] === message.descriptor.target) {
    return;
  } else {
    throw new Error('message failed authorization, permission grant check not yet implemented');
  }
}

async function authorizeCollectionsMessage(
  message: CollectionsWriteSchema | CollectionsQuerySchema,
  signers: string[],
  messageStore: MessageStore
): Promise<void> {
  // if requester is the same as the target DID, we can directly grant access
  if (signers[0] === message.descriptor.target) {
    return;
  }

  // fall through to protocol-based authorization
  await protocolAuthorize(message, signers[0], messageStore);
}

const methodToAllowedActionMap = {
  'CollectionsWrite' : 'write',
  'CollectionsQuery' : 'query'
};

async function fetchProtocolDefinition(message: CollectionsWriteSchema | CollectionsQuerySchema, messageStore: MessageStore): Promise<any> {
  // fail if not a protocol-based object
  let protocolUri: string;
  if (message.descriptor.method === 'CollectionsWrite') {
    protocolUri = (message as CollectionsWriteSchema).descriptor.protocol;
  } else {
    protocolUri = (message as CollectionsQuerySchema).descriptor.filter.protocol;
  }

  if (protocolUri === undefined) {
    throw new Error('message does not have a protocol property for protocol-based authorization');
  }

  // fetch the corresponding protocol definition, temporary stubbing using collections
  // get existing records matching the `recordId`
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
 * Constructs a chain of existing messages
 * @returns the existing chain of message where the first element is the root of the chain; returns empty array if no parent is specified.
 */
async function constructExistingMessageChain(message: CollectionsWriteSchema | CollectionsQuerySchema, messageStore: MessageStore): Promise<any> {
  const existingMessageChain: CollectionsWriteSchema[] = [];

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
    throw new Error('`contextId` must exist for protocol scoped records but is not specified');
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
    existingMessageChain.push(parent);

    currentParentId = parent.descriptor.parentId;
  }

  return existingMessageChain.reverse(); // root ancestor first
}

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

  // fetch existing message chain
  const existingMessageChain: CollectionsWriteSchema[] = await constructExistingMessageChain(message, messageStore);

  // record schema -> record type map
  const recordSchemaToTypeMap: Map<string, string> = new Map();
  for (const recordTypeName in protocolDefinition.recordTypes) {
    const schema = protocolDefinition.recordTypes[recordTypeName].schema;
    recordSchemaToTypeMap[schema] = recordTypeName;
  }

  // get the rule set for the inbound message
  const inboundMessageRuleSet = getRuleSet(message, protocolDefinition, existingMessageChain, recordSchemaToTypeMap);

  // corresponding rule set is found if code reaches here

  // verify the requester of the inbound message against allowed requester rule
  verifyAllowedRequester(requesterDid, inboundMessageRuleSet, existingMessageChain, recordSchemaToTypeMap);

  // verify method invoked against the allowed actions
  verifyAllowedActions(message, inboundMessageRuleSet);
}

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

function verifyAllowedRequester(
  requesterDid: string,
  inboundMessageRuleSet: any,
  existingMessageChain: CollectionsWriteSchema[],
  recordSchemaToTypeMap: Map<string, string>
): void {
  const allowRule = inboundMessageRuleSet.allow;
  if (allowRule.anyone !== undefined) {
    // good to go to next check
  } else if (allowRule.recipient !== undefined) {
    const messageForRecipientCheck = getMessage(existingMessageChain, allowRule.recipient.of, recordSchemaToTypeMap);
    const expectedRequesterDid = messageForRecipientCheck.descriptor.recipient;

    // the requester of the inbound message must be the recipient of the message obtained from the allow rule
    if (requesterDid !== expectedRequesterDid) {
      throw new Error(`unexpected inbound message author: ${requesterDid}, expected ${expectedRequesterDid}`);
    }
  } else {
    throw new Error(`no matching allow condition`);
  }
}

function getRuleSet(
  message: CollectionsWriteSchema | CollectionsQuerySchema,
  protocolDefinition: any,
  existingMessageChain: CollectionsWriteSchema[],
  recordSchemaToTypeMap: Map<string, string>
): any {
  // get the rule set for the inbound message by walking down the existing message chain from the root ancestor record
  // and matching against the corresponding rule set at each level
  let currentStructureLevelRuleSet = protocolDefinition.structures;
  let currentMessageIndex = 0;
  while (existingMessageChain[currentMessageIndex] !== undefined) {
    const currentRecordSchema = existingMessageChain[currentMessageIndex].descriptor.schema;
    const currentRecordType = recordSchemaToTypeMap[currentRecordSchema];

    if (currentRecordType === undefined) {
      throw new Error(`record with schema ${currentRecordSchema} not allowed in protocol`);
    }

    if (!(currentRecordType in currentStructureLevelRuleSet)) {
      throw new Error(`record with schema: ${currentRecordSchema} not allowed in structure level ${currentMessageIndex}`);
    }

    // else we keep going down the message chain
    currentStructureLevelRuleSet = currentStructureLevelRuleSet[currentRecordType].records;
    currentMessageIndex++;
  }

  // get the rule set of the inbound message from its parent rule set
  let inboundMessageSchema;
  if (message.descriptor.method === 'CollectionsWrite') {
    inboundMessageSchema = (message as CollectionsWriteSchema).descriptor.schema;
  } else {
    inboundMessageSchema = (message as CollectionsQuerySchema).descriptor.filter.schema;
  }
  const inboundMessageRecordType = recordSchemaToTypeMap[inboundMessageSchema];
  const inboundMessageRuleSet = currentStructureLevelRuleSet[inboundMessageRecordType];

  return inboundMessageRuleSet;
}

/**
 * Gets the message from the message chain based on the path specified.
 * @param messagePath `/` delimited path starting from the root ancestor.
 *                    Each path segment denotes the expected record type declared in protocol definition.
 *                    e.g. `A/B/C` means that the root ancestor must be of type A, its child must be of type B, followed by a child of type C.
 *                    NOTE: the path scheme use here is currently experimental and may change.
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

/**
 * signs the provided message. Signed payload includes the CID of the message's descriptor by default
 * along with any additional payload properties provided
 * @param message - the message to sign
 * @param signatureInput - the signature material to use (e.g. key and header data)
 * @param payloadProperties - additional properties to include in the signed payload
 * @returns General JWS signature
 */
export async function sign(
  message: BaseMessageSchema,
  signatureInput: SignatureInput,
  payloadProperties?: { [key: string]: CID }

): Promise<GeneralJws> {
  const descriptorCid = await generateCid(message.descriptor);

  const authPayload = { ...payloadProperties, descriptorCid: descriptorCid.toString() };
  const authPayloadStr = JSON.stringify(authPayload);
  const authPayloadBytes = new TextEncoder().encode(authPayloadStr);

  const signer = await GeneralJwsSigner.create(authPayloadBytes, [signatureInput]);

  return signer.getJws();
}