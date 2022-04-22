import { DIDResolver } from '../../did/did-resolver';

import type { Ability, Conditions } from './permission';
import type { FlattenedJWS } from 'jose';
import type { PermissionsMethod } from './types';
import { MessageStore } from '../../store/message-store';

/**
 * TODO: add documentation
 * @param message
 */
export async function PermissionsRequest(
  message: PermissionsRequestMessage,
  didResolver: DIDResolver,
  messageStore: MessageStore
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
