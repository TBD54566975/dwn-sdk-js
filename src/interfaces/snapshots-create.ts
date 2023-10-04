import type { Signer } from '../types/signer.js';
import type { SnapshotDefinition, SnapshotsCreateDescriptor, SnapshotsCreateMessage } from '../types/snapshots-types.js';

import { Cid } from '../utils/cid.js';
import { getCurrentTimeInHighPrecision } from '../utils/time.js';
import { validateMessageSignatureIntegrity } from '../core/auth.js';

import { DwnInterfaceName, DwnMethodName, Message } from '../core/message.js';

export type SnapshotsCreateOptions = {
  messageTimestamp? : string;
  definition : SnapshotDefinition;
  authorizationSigner: Signer;
};

export class SnapshotsCreate extends Message<SnapshotsCreateMessage> {

  public static async parse(message: SnapshotsCreateMessage): Promise<SnapshotsCreate> {
    await validateMessageSignatureIntegrity(message.authorization.authorSignature, message.descriptor);

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

    const authorization = await Message.signAuthorizationAsAuthor(descriptor, options.authorizationSigner);
    const message = { descriptor, authorization };

    Message.validateJsonSchema(message);

    const snapshotsCreate = new SnapshotsCreate(message);
    return snapshotsCreate;
  }
}
