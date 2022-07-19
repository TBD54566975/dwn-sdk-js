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
 * validates and verifies `authorization` of the provided message
 * @throws {Error} if auth payload is not a valid JSON object
 * @throws {Error} if descriptorCid is missing from Auth payload
 * @throws {Error} if provided descriptorCid does not match expected descriptor CID
 */
export async function verifyAuth(
  message: BaseMessageSchema & Authorization,
  didResolver: DIDResolver,
  payloadConstraints?: PayloadConstraints
): Promise<AuthVerificationResult> {

  if (message.authorization.signatures.length !== 1) {
    throw new Error('Expected no more than 1 signature for authorization');
  }

  const verifier = new GeneralJwsVerifier(message.authorization);

  // signature verification is computationally intensive, so we're going to start
  // by validating the payload.

  const payloadBytes: Uint8Array = verifier.decodePayload();
  const payloadStr = new TextDecoder().decode(payloadBytes);
  let payloadJson;

  try {
    payloadJson = JSON.parse(payloadStr);
  } catch {
    throw new Error('auth payload must be a valid JSON object');
  }

  if (!isPlainObject(payloadJson)) {
    throw new Error('auth payload must be a valid JSON object');
  }

  const { descriptorCid } = payloadJson;
  if (!descriptorCid) {
    throw new Error('descriptorCid must be present in authorization payload');
  }

  // the authorization payload should, at minimum, always contain `descriptorCid` regardless
  // of whatever else is present. check to ensure that the provided descriptorCid matches
  // the CID of the actual message

  // parseCid throws an exception if parsing fails
  const providedDescriptorCid = parseCid(descriptorCid);
  const expectedDescriptorCid = await generateCid(message.descriptor);

  if (!providedDescriptorCid.equals(expectedDescriptorCid)) {
    throw new Error('provided descriptorCid does not match expected CID');
  }

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

  const { signers } = await verifier.verify(didResolver);

  return { payload: parsedPayload, signers };
}

/**
 * signs the provided message. Signed payload includes the CID of the message's descriptor by default
 * along with any additional payload properties provided
 * @param message - the message to sign
 * @param signatureInput - the signature material to use (e.g. key and header data)
 * @param payloadProperties - additional properties to include in the signed payload
 * @returns General JWS signature
 */
export async function authenticate(
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