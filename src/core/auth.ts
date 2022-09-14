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
  // signature verification is computationally intensive, so we're going to start
  // by validating the payload.
  const parsedPayload = await validateSchema(message, payloadConstraints);

  const signers = await authenticate(message.authorization, didResolver);

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

async function getProtocolDefinition(message: CollectionsWriteSchema | CollectionsQuerySchema, messageStore: MessageStore): Promise<any> {
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

  const protocolDefinition = {
    recordTypes: {
      credentialApplication: {
        schema: 'https://identity.foundation/schemas/credential-application'
      },
      credentialResponse: {
        schema: 'https://identity.foundation/schemas/credential-response'
      }
    },
    structures: {
      credentialApplication: {
        contextRequired : true,
        encryption      : true,
        allow           : { // Issuers would have this allow present
          anyone: {
            to: [
              'create'
            ]
          }
        },
        records: {
          credentialResponse: {
            allow: {
              recipient: {
                of : '$.[credential-application]', // only available in contexts, eval'd from the top of the contextual graph root
                to : [
                  'create'
                ]
              }
            }
          }
        }
      }
    }
  };

  return protocolDefinition;
}

/**
 * Performs protocol-based authorization against the given collections message.
 * @throws {Error} if authorization fails.
 */
export async function protocolAuthorize(
  message: CollectionsWriteSchema | CollectionsQuerySchema,
  senderDid: string,
  messageStore: MessageStore
): Promise<void> {
  // fetch the protocol definition
  const protocolDefinition = await getProtocolDefinition(message, messageStore);

  // fetch message chain
  const messageChain: CollectionsWriteSchema[] = [];

  // record schema -> record type map
  const recordSchemaToTypeMap = {};

  // get the rule set for the inbound message by walking down the message chain from the root ancestor record
  // and matching against the corresponding rule set at each level
  let ruleSetForInboundMessage;
  let currentStructureLevelRuleSet = protocolDefinition.structures;
  let currentMessageIndex = 0;
  while (true) {
    const currentRecordSchema = messageChain[currentMessageIndex].descriptor.schema;
    const currentRecordType = recordSchemaToTypeMap[currentRecordSchema];

    if (currentRecordType === undefined) {
      throw new Error(`record with schema ${currentRecordSchema} not an allowed in protocol`);
    }

    if (!(currentRecordType in currentStructureLevelRuleSet)) {
      throw new Error(`record with schema: ${currentRecordSchema} not allowed in structure level ${currentMessageIndex}`);
    }

    // if we are looking at the inbound message itself (the last message in the chain),
    // then we have found the rule set we need to evaluate against
    if (currentMessageIndex === messageChain.length - 1) {
      ruleSetForInboundMessage = currentStructureLevelRuleSet[currentRecordType];
      break;
    }

    // else we keep going down the message chain
    currentStructureLevelRuleSet = currentStructureLevelRuleSet[currentRecordType].records;
    currentMessageIndex++;
  }

  // corresponding rule set is found
  // verify the sender against the `allow` property
  const allowRule = ruleSetForInboundMessage.allow;
  if (allowRule.anyone !== undefined) {
    // good to go to next check
  } else if (allowRule.recipient !== undefined) {
    const messageForRecipientCheck = getMessage(messageChain, allowRule.recipient.of);
    const expectedSenderDid = getRecipient(messageForRecipientCheck);

    // the sender of the inbound message must be the recipient of the message obtained from the allow rule
    if (senderDid !== expectedSenderDid) {
      throw new Error(`inbound message sender ${senderDid} is not the expected ${expectedSenderDid}`);
    }
  } else {
    throw new Error(`no matching allow condition`);
  }

  // recipient - the entity this message is intended for in the context of message exchange
  // (putting it in authorization for now since it requires less code change)

  // validate method invoked against the allowed actions defined in the `to` array property
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

  // make sure the context ID of the inbound message matches the existing context unless it is the first message
  if (messageChain.length > 1) {
    // get the `contextId` specified in the inbound message
    let inboundMessageContextId: string;
    if (message.descriptor.method === 'CollectionsWrite') {
      inboundMessageContextId = (message as CollectionsWriteSchema).descriptor.contextId;
    } else {
      inboundMessageContextId = (message as CollectionsQuerySchema).descriptor.filter.contextId;
    }

    const expectedContextId = messageChain[0].descriptor.contextId;
    if (inboundMessageContextId !== expectedContextId) {
      throw new Error(`inbound message context ID ${inboundMessageContextId} does not match the expected context ID ${expectedContextId}`);
    }
  }

  // !! MONKEY Wrench: create action is only allowed to create, not overwrite.
}


function getRecipient(_message: CollectionsWriteSchema): string {
  return 'someDID';
}

function getMessage(messageChain: CollectionsWriteSchema[], _messagePath: string): CollectionsWriteSchema {
  return messageChain[0];
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