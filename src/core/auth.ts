import type { BaseMessage } from './types.js';
import type { CID } from 'multiformats';
import type { DidResolver } from '../did/did-resolver.js';
import type { GeneralJws } from '../jose/jws/general/types.js';
import type { Message } from './message.js';

import { GeneralJwsVerifier } from '../jose/jws/general/verifier.js';
import { Jws } from '../utils/jws.js';
import { computeCid, parseCid } from '../utils/cid.js';
import { DwnError, DwnErrorCode } from './dwn-error.js';

type AuthorizationPayloadConstraints = {
  /** permissible properties within payload. Note that `descriptorCid` is implied and does not need to be added */
  allowedProperties: Set<string>;
};

/**
 * Authenticates then authorizes the given message using the "canonical" auth flow.
 * Some message auth require special handling such as `RecordsWrite` and `RecordsQuery`,
 * which would be incompatible with this auth flow.
 * @throws {Error} if auth fails
 */
export async function canonicalAuth(
  tenant: string,
  incomingMessage: Message<BaseMessage>,
  didResolver: DidResolver
): Promise<void> {
  await authenticate(incomingMessage.message.authorization, didResolver);
  await authorize(tenant, incomingMessage);
}

/**
 * Validates the structural integrity of the `authorization` property.
 * NOTE: signature is not verified.
 * @returns the parsed JSON payload object if validation succeeds.
 */
export async function validateAuthorizationIntegrity(
  message: BaseMessage,
  authorizationPayloadConstraints?: AuthorizationPayloadConstraints
): Promise<{ descriptorCid: CID, [key: string]: any }> {
  if (message.authorization === undefined) {
    throw new DwnError(DwnErrorCode.AuthorizationMissing, 'Property `authorization` is missing.');
  }

  if (message.authorization.signatures.length !== 1) {
    throw new Error('expected no more than 1 signature for authorization');
  }

  const payloadJson = Jws.decodePlainObjectPayload(message.authorization);
  const { descriptorCid } = payloadJson;

  // `descriptorCid` validation - ensure that the provided descriptorCid matches the CID of the actual message
  const expectedDescriptorCid = await computeCid(message.descriptor);
  if (descriptorCid !== expectedDescriptorCid) {
    throw new Error(`provided descriptorCid ${descriptorCid} does not match expected CID ${expectedDescriptorCid}`);
  }

  // check to ensure that no other unexpected properties exist in payload.
  const allowedProperties = authorizationPayloadConstraints?.allowedProperties ?? new Set();
  const customProperties = { ...payloadJson };
  delete customProperties.descriptorCid;
  for (const propertyName in customProperties) {
    {
      if (!allowedProperties.has(propertyName)) {
        throw new Error(`${propertyName} not allowed in auth payload.`);
      }
    }

    try {
      parseCid(payloadJson[propertyName]);
    } catch (e) {
      throw new Error(`${propertyName} must be a valid CID`);
    }
  }

  return payloadJson;
}

/**
 * Validates the signature(s) of the given JWS.
 * @throws {Error} if fails authentication
 */
export async function authenticate(jws: GeneralJws | undefined, didResolver: DidResolver): Promise<void> {
  if (jws === undefined) {
    throw new DwnError(DwnErrorCode.AuthenticateJwsMissing, 'Missing JWS.');
  }

  const verifier = new GeneralJwsVerifier(jws);
  await verifier.verify(didResolver);
}

/**
 * Authorizes the incoming message.
 * @throws {Error} if fails authentication
 */
export async function authorize(tenant: string, incomingMessage: Message<BaseMessage>): Promise<void> {
  // if author/requester is the same as the target tenant, we can directly grant access
  if (incomingMessage.author === tenant) {
    return;
  } else {
    throw new Error('message failed authorization, permission grant check not yet implemented');
  }
}
