import type { AuthorizationModel } from '../types/message-types.js';
import type { DidResolver } from '../did/did-resolver.js';

import { GeneralJwsVerifier } from '../jose/jws/general/verifier.js';
import { PermissionsGrant } from '../interfaces/permissions-grant.js';
import { DwnError, DwnErrorCode } from './dwn-error.js';

/**
 * Verifies all the signature(s) within the authorization property.
 *
 * @throws {Error} if fails authentication
 */
export async function authenticate(authorizationModel: AuthorizationModel | undefined, didResolver: DidResolver): Promise<void> {

  if (authorizationModel === undefined) {
    throw new DwnError(DwnErrorCode.AuthenticateJwsMissing, 'Missing JWS.');
  }

  await GeneralJwsVerifier.verifySignatures(authorizationModel.signature, didResolver);

  if (authorizationModel.ownerSignature !== undefined) {
    await GeneralJwsVerifier.verifySignatures(authorizationModel.ownerSignature, didResolver);
  }

  if (authorizationModel.authorDelegatedGrant !== undefined) {
    // verify the signature of the grantor of the delegated grant
    const authorDelegatedGrant = await PermissionsGrant.parse(authorizationModel.authorDelegatedGrant);
    await GeneralJwsVerifier.verifySignatures(authorDelegatedGrant.message.authorization.signature, didResolver);
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
    throw new DwnError(DwnErrorCode.AuthorizationUnknownAuthor, 'message failed authorization, permission grant check not yet implemented');
  }
}
