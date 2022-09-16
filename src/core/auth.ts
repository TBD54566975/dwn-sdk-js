import type { Authorization, BaseMessageSchema } from './types';
import type { AuthVerificationResult } from './types';
import type { SignatureInput } from '../jose/jws/general/types';

import { CID } from 'multiformats';
import { CollectionsQuerySchema, CollectionsWriteSchema } from '../interfaces/collections/types';
import { DIDResolver } from '../did/did-resolver';
import { GeneralJws } from '../jose/jws/general/types';
import { GeneralJwsSigner, GeneralJwsVerifier } from '../jose/jws/general';
import { generateCid, parseCid } from '../utils/cid';
import { MessageStore } from '../store/message-store';
import { protocolAuthorize } from './protocol-authorization';
import lodash from 'lodash';

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
    await authorizeCollectionsMessage(message as CollectionsWriteSchema, signers, messageStore);
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
  message: CollectionsWriteSchema,
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