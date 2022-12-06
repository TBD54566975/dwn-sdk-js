import type { AuthVerificationResult } from './types';
import type { BaseMessage } from './types';

import { CID } from 'multiformats';
import { Did } from '../did/did';
import { DidResolver } from '../did/did-resolver';
import { GeneralJws } from '../jose/jws/general/types';
import { GeneralJwsVerifier } from '../jose/jws/general';
import { Message } from './message';
import { MessageStore } from '../store/message-store';
import { generateCid, parseCid } from '../utils/cid';

type AuthorizationPayloadConstraints = {
  /** permissible properties within payload. Note that `descriptorCid` is implied and does not need to be added */
  allowedProperties: Set<string>;
};

/**
 * Authenticates then authorizes the given message using the "canonical" auth flow.
 * Some message auth require special handling such as `CollectionsWrite` and `CollectionsQuery`,
 * which would be incompatible with this auth flow.
 * @throws {Error} if auth fails
 */
export async function canonicalAuth(
  incomingMessage: Message,
  didResolver: DidResolver,
  messageStore: MessageStore, // TODO: wait what? messageStore not used?
  authorizationPayloadConstraints?: AuthorizationPayloadConstraints
): Promise<AuthVerificationResult> {
  // signature verification is computationally intensive, so we're going to start by validating the payload.
  const parsedPayload = await validateAuthorizationIntegrity(incomingMessage.message, authorizationPayloadConstraints);

  const signers = await authenticate(incomingMessage.message.authorization, didResolver);
  const author = signers[0];

  await authorize(incomingMessage);

  return { payload: parsedPayload, author };
}

/**
 * Validates the data integrity of the `authorization` property.
 * NOTE: `target` and `descriptorCid` are both checked by default
 * NOTE signature is not verified.
 */
export async function validateAuthorizationIntegrity(
  message: BaseMessage,
  authorizationPayloadConstraints?: AuthorizationPayloadConstraints
): Promise<{target: string, descriptorCid: CID, [key: string]: any }> {

  if (message.authorization.signatures.length !== 1) {
    throw new Error('expected no more than 1 signature for authorization');
  }

  const payloadJson = GeneralJwsVerifier.decodePlainObjectPayload(message.authorization);
  const { target, descriptorCid } = payloadJson;

  // `target` validation
  Did.validate(target);

  // `descriptorCid` validation - ensure that the provided descriptorCid matches the CID of the actual message
  const providedDescriptorCid = parseCid(descriptorCid); // parseCid throws an exception if parsing fails
  const expectedDescriptorCid = await generateCid(message.descriptor);
  if (!providedDescriptorCid.equals(expectedDescriptorCid)) {
    throw new Error(`provided descriptorCid ${providedDescriptorCid} does not match expected CID ${expectedDescriptorCid}`);
  }

  // check to ensure that no other unexpected properties exist in payload.
  const allowedProperties = authorizationPayloadConstraints?.allowedProperties ?? new Set();
  const customProperties = { ...payloadJson };
  delete customProperties.target;
  delete customProperties.descriptorCid;
  for (const propertyName in customProperties) {
    {if (!allowedProperties.has(propertyName)) {
      throw new Error(`${propertyName} not allowed in auth payload.`);
    }}

    try {
      parseCid(payloadJson[propertyName]);
    } catch (e) {
      throw new Error(`${propertyName} must be a valid CID`);
    }
  }

  return payloadJson;
}

export async function authenticate(jws: GeneralJws, didResolver: DidResolver): Promise<string[]> {
  const verifier = new GeneralJwsVerifier(jws);
  const { signers } = await verifier.verify(didResolver);
  return signers;
}

export async function authorize(incomingMessage: Message): Promise<void> {
  // if author/requester is the same as the target DID, we can directly grant access
  if (incomingMessage.author === incomingMessage.target) {
    return;
  } else {
    throw new Error('message failed authorization, permission grant check not yet implemented');
  }
}
