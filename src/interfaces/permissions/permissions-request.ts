import { DIDResolver } from '../../did/did-resolver';

import type { Ability, Conditions } from './permission';
import type { JwsFlattened } from '../../jose/jws';
import type { MessageStore } from '../../store/message-store';

/**
 * TODO: add documentation
 * @param message
 */
export async function PermissionsRequest(
  message: PermissionsRequestMessage,
  didResolver: DIDResolver,
  messageStore: MessageStore
): Promise<void> {

  const { attestation, descriptor } = message;
  const { requester } = descriptor;

  const { didDocument } = await didResolver.resolve(requester);

  // additional method specific logic here
  await messageStore.put(message);
}

export type PermissionsRequestMessage = {
  descriptor: PermissionsRequestDescriptor,
  attestation: JwsFlattened
};

export type PermissionsRequestDescriptor = {
  method: 'PermissionsRequest',
  requester: string,
  ability: Ability,
  objectId?: string,
  conditions?: Conditions
};
