import type { CID } from 'multiformats';
import type { DidResolver } from '../did/did-resolver.js';
import type { GeneralJws } from '../types/jws-types.js';
import type { AuthorizationModel, Descriptor } from '../types/message-types.js';

import { Cid } from '../utils/cid.js';
import { GeneralJwsVerifier } from '../jose/jws/general/verifier.js';
import { Jws } from '../utils/jws.js';
import { PermissionsGrant } from '../interfaces/permissions-grant.js';
import { validateJsonSchema } from '../schema-validator.js';
import { DwnError, DwnErrorCode } from './dwn-error.js';

/**
 * Validates the structural integrity of the message signature given.
 * NOTE: signature is not verified.
 * @param payloadJsonSchemaKey The key to look up the JSON schema referenced in `compile-validators.js` and perform payload schema validation on.
 * @returns the parsed JSON payload object if validation succeeds.
 */
export async function validateMessageSignatureIntegrity(
  messageSignature: GeneralJws,
  messageDescriptor: Descriptor,
  payloadJsonSchemaKey: string = 'GenericSignaturePayload',
): Promise<{ descriptorCid: CID, [key: string]: any }> {

  if (messageSignature.signatures.length !== 1) {
    throw new Error('expected no more than 1 signature for authorization purpose');
  }

  // validate payload integrity
  const payloadJson = Jws.decodePlainObjectPayload(messageSignature);

  validateJsonSchema(payloadJsonSchemaKey, payloadJson);

  // `descriptorCid` validation - ensure that the provided descriptorCid matches the CID of the actual message
  const { descriptorCid } = payloadJson;
  const expectedDescriptorCid = await Cid.computeCid(messageDescriptor);
  if (descriptorCid !== expectedDescriptorCid) {
    throw new Error(`provided descriptorCid ${descriptorCid} does not match expected CID ${expectedDescriptorCid}`);
  }

  return payloadJson;
}

/**
 * Verifies all the signature(s) within the authorization property.
 *
 * @throws {Error} if fails authentication
 */
export async function authenticate(authorizationModel: AuthorizationModel | undefined, didResolver: DidResolver): Promise<void> {

  if (authorizationModel === undefined) {
    throw new DwnError(DwnErrorCode.AuthenticateJwsMissing, 'Missing JWS.');
  }

  const authorSignatureVerifier = new GeneralJwsVerifier(authorizationModel.authorSignature);
  await authorSignatureVerifier.verify(didResolver);

  if (authorizationModel.ownerSignature !== undefined) {
    const ownerSignatureVerifier = new GeneralJwsVerifier(authorizationModel.ownerSignature);
    await ownerSignatureVerifier.verify(didResolver);
  }

  if (authorizationModel.authorDelegatedGrant !== undefined) {
    // verify the signature of the author delegated grant
    const authorDelegatedGrant = await PermissionsGrant.parse(authorizationModel.authorDelegatedGrant);
    const grantedByAuthorSignatureVerifier = new GeneralJwsVerifier(authorDelegatedGrant.message.authorization.authorSignature);
    await grantedByAuthorSignatureVerifier.verify(didResolver);
  }
}

/**
 * Authorizes the incoming message.
 * @throws {Error} if fails authentication
 */
export async function authorize(tenant: string, incomingMessage: { author: string | undefined }): Promise<void> {
  // if author is the same as the target tenant, we can directly grant access
  if (incomingMessage.author === tenant) {
    return;
  } else {
    throw new Error('message failed authorization, permission grant check not yet implemented');
  }
}
