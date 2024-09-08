import type { AuthorizationModel } from '../types/message-types.js';
import type { DidResolver } from '@web5/dids';

import { GeneralJwsVerifier } from '../jose/jws/general/verifier.js';
import { RecordsWrite } from '../interfaces/records-write.js';
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
    // verify the signature of the grantor of the author-delegated grant
    const authorDelegatedGrant = await RecordsWrite.parse(authorizationModel.authorDelegatedGrant);
    await GeneralJwsVerifier.verifySignatures(authorDelegatedGrant.message.authorization.signature, didResolver);
  }

  if (authorizationModel.ownerDelegatedGrant !== undefined) {
    // verify the signature of the grantor of the owner-delegated grant
    const ownerDelegatedGrant = await RecordsWrite.parse(authorizationModel.ownerDelegatedGrant);
    await GeneralJwsVerifier.verifySignatures(ownerDelegatedGrant.message.authorization.signature, didResolver);
  }
}