import { DIDResolver } from '../../did/did-resolver';

import type { Ability, Conditions } from './permission';
import type { FlattenedJWS } from 'jose';
import type { MessageStore } from '../../store/message-store';
import type { PermissionsMethod } from './types';

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

  // additional method specific logic here
  await messageStore.put(message);
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
