import type { SignatureInput } from '../types/jws-types.js';
import type { SnapshotDefinition, SnapshotsCreateDescriptor, SnapshotsCreateMessage } from '../types/snapshots-types.js';

import { Cid } from '../utils/cid.js';
import { getCurrentTimeInHighPrecision } from '../utils/time.js';
import { validateAuthorizationIntegrity } from '../core/auth.js';

import { DwnInterfaceName, DwnMethodName, Message } from '../core/message.js';

export type SnapshotsCreateOptions = {
  messageTimestamp? : string;
  definition : SnapshotDefinition;
  authorizationSignatureInput: SignatureInput;
};

export class SnapshotsCreate extends Message<SnapshotsCreateMessage> {

  public static async parse(message: SnapshotsCreateMessage): Promise<SnapshotsCreate> {
    await validateAuthorizationIntegrity(message);

    return new SnapshotsCreate(message);
  }

  public static async create(options: SnapshotsCreateOptions): Promise<SnapshotsCreate> {

    const definitionCid = await Cid.computeCid(options.definition);

    const descriptor: SnapshotsCreateDescriptor = {
      interface        : DwnInterfaceName.Snapshots,
      method           : DwnMethodName.Create,
      messageTimestamp : options.messageTimestamp ?? getCurrentTimeInHighPrecision(),
      definitionCid
    };

    const authorization = await Message.signAsAuthorization(descriptor, options.authorizationSignatureInput);
    const message = { descriptor, authorization };

    Message.validateJsonSchema(message);

    const snapshotsCreate = new SnapshotsCreate(message);
    return snapshotsCreate;
  }
}
