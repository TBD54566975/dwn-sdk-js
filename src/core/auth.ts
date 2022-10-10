import type { AuthorizableMessage, BaseMessage } from './types';
import type { AuthVerificationResult } from './types';

import { CID } from 'multiformats';
import { DidResolver } from '../did/did-resolver';
import { GeneralJws } from '../jose/jws/general/types';
import { GeneralJwsVerifier } from '../jose/jws/general';
import { generateCid, parseCid } from '../utils/cid';
import { MessageStore } from '../store/message-store';
import lodash from 'lodash';

const { isPlainObject } = lodash;

type PayloadConstraints = {
  /** permissible properties within payload. Note that `descriptorCid` is implied and does not need to be added */
  properties: Set<string>;
};

/**
 * Authenticates then authorizes the given message using the "canonical" auth flow.
 * Some message auth require special handling such as `CollectionsWrite` and `CollectionsQuery`,
 * which would be incompatible with this auth flow.
 * @throws {Error} if auth fails
 */
export async function canonicalAuth(
  message: BaseMessage & AuthorizableMessage,
  didResolver: DidResolver,
  messageStore: MessageStore,
  payloadConstraints?: PayloadConstraints
): Promise<AuthVerificationResult> {
  // signature verification is computationally intensive, so we're going to start by validating the payload.
  const parsedPayload = await validateSchema(message, payloadConstraints);

  const signers = await authenticate(message.authorization, didResolver);
  const author = signers[0];

  await authorize(message, author);

  return { payload: parsedPayload, author };
}

export async function validateSchema(
  message: BaseMessage & AuthorizableMessage,
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

export async function authenticate(jws: GeneralJws, didResolver: DidResolver): Promise<string[]> {
  // TODO: should we add an explicit check to ensure that there's only 1 signer?, Issue #65 https://github.com/TBD54566975/dwn-sdk-js/issues/65
  const verifier = new GeneralJwsVerifier(jws);
  const { signers } = await verifier.verify(didResolver);
  return signers;
}

export async function authorize(message: BaseMessage, author: string): Promise<void> {
  // if author/requester is the same as the target DID, we can directly grant access
  if (author === message.descriptor.target) {
    return;
  } else {
    throw new Error('message failed authorization, permission grant check not yet implemented');
  }
}
