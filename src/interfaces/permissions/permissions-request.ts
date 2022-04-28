import { DIDResolver } from '../../did/did-resolver';
import type { Ability, Conditions } from './permission';
import type { PermissionsMethod } from './types';
import type JwsFlattened from '../../crypto/JwsFlattened';

/**
 * TODO: add documentation
 * @param message
 */
export async function PermissionsRequest(
  message: PermissionsRequestMessage,
  didResolver: DIDResolver
) {

  const { attestation, descriptor } = message;
  const { requester } = descriptor;

  const { didDocument } = await didResolver.resolve(requester);
}

export type PermissionsRequestMessage = {
  descriptor: PermissionsRequestDescriptor,
  attestation: JwsFlattened
};

export type PermissionsRequestDescriptor = {
  method: PermissionsMethod,
  requester: string,
  ability: Ability,
  objectId?: string,
  conditions?: Conditions
};
