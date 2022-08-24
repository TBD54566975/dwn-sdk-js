import type { Authorization, BaseMessageSchema } from './types';
import type { AuthVerificationResult } from './types';
import type { SignatureInput } from '../jose/jws/general/types';

import { GeneralJwsSigner, GeneralJwsVerifier } from '../jose/jws/general';
import { generateCid, parseCid } from '../utils/cid';
import lodash from 'lodash';
import { DIDResolver } from '../did/did-resolver';
import { CID } from 'multiformats';
import { GeneralJws } from '../jose/jws/general/types';

const { isPlainObject } = lodash;

type PayloadConstraints = {
  /** permissible properties within payload. Note that `descriptorCid` is implied and does not need to be added */
  properties: Set<string>;
};

/**
 * validates and verifies `authorization` of the provided message:
 * - verifies signature
 * - verifies `descriptorCid` matches the actual CID of the descriptor
 * - verifies payload constraints if given
 * @throws {Error} if auth payload is not a valid JSON object
 * @throws {Error} if descriptorCid is missing from Auth payload
 * @throws {Error} if provided descriptorCid does not match expected descriptor CID
 */
export async function verifyAuth(
  message: BaseMessageSchema & Authorization,
  didResolver: DIDResolver,
  payloadConstraints?: PayloadConstraints
): Promise<AuthVerificationResult> {
  // signature verification is computationally intensive, so we're going to start
  // by validating the payload.
  const parsedPayload = await validateSchema(message, payloadConstraints);

  const signers = await authenticate(message.authorization, didResolver);

  await authorize(message, signers);

  return { payload: parsedPayload, signers };
}

async function validateSchema(
  message: BaseMessageSchema & Authorization,
  payloadConstraints?: PayloadConstraints
): Promise<{ descriptorCid: CID, [key: string]: CID }> {

  if (message.authorization.signatures.length !== 1) {
    throw new Error('Expected no more than 1 signature for authorization');
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
      throw new Error(`${field} must be a valid CID`); // TODO: Sanity: why does this must be a CID?
    }
  }

  return parsedPayload;
}

async function authenticate(jws: GeneralJws, didResolver: DIDResolver): Promise<string[]> {
  const verifier = new GeneralJwsVerifier(jws);
  const { signers } = await verifier.verify(didResolver);
  return signers;
}

async function authorize(message: BaseMessageSchema, signers: string[]): Promise<void> {
  // if requester is the same as the target DID, we can directly grant access
  if (signers[0] === message.descriptor.target) {
    return;
  } else {
    throw new Error('message failed authorization, permission grant check not yet implemented');
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