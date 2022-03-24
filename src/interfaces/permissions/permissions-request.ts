import { FlattenedJWS } from 'jose';
import { DIDResolver } from '../../did/did-resolver';
import { Ability, Conditions } from './permission';
import { PermissionsMethod } from './types';

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
  attestation: FlattenedJWS
};

export type PermissionsRequestDescriptor = {
  method: PermissionsMethod,
  requester: string,
  ability: Ability,
  objectId?: string,
  conditions?: Conditions
};
