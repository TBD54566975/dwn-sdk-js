import { FlattenedJWS } from 'jose';
import { Ability, Conditions } from './permission';
import { PermissionsMethod } from './types';

/**
 * TODO: add documentation
 * @param message
 */
export async function PermissionsRequest(message: PermissionsRequestMessage) {
  throw new Error('Method not implemented');
}

export type PermissionsRequestMessage = {
  descriptor: PermissionsRequestDescriptor,
  attestation: FlattenedJWS
};

export type PermissionsRequestDescriptor = {
  method: PermissionsMethod,
  objectId: string,
  requester: string,
  ability: Ability,
  conditions?: Conditions
};
