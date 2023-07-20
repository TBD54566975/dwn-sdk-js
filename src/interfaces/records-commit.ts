import { Message } from '../core/message.js';
import { SignatureInput } from '../types/jws-types.js';
import type {
  CommitStrategy,
  EncryptionInput,
  RecordsCommitMessage,
} from '../types/records-types.js';
import { Jws } from '../utils/jws.js';

export type RecordsCommitOptions = {
  recordId: string;
  parentId: string;
  commitStrategy: CommitStrategy;
  recipient?: string;
  contextId?: string;
  schema?: string;
  data?: Uint8Array;
  dataCid?: string;
  dataSize?: number;
  dateCreated?: string;
  messageTimestamp?: string;
  published?: boolean;
  datePublished?: string;
  dataFormat: string;
  authorizationSignatureInput: SignatureInput;
  attestationSignatureInputs?: SignatureInput[];
  encryptionInput?: EncryptionInput;
}

export class RecordsCommit extends Message<RecordsCommitMessage> {

  readonly attesters: string[];

  private constructor(message: RecordsCommitMessage) {
    super(message);

    this.attesters = RecordsCommit.getAttesters(message);
  }

  /**
   * Creates a RecordsCommit message.
   * @param options.data Data used to compute the `dataCid`, must be the encrypted data bytes if `options.encryptionInput` is given.
   *                     Must specify `options.dataCid` if `undefined`.
   * @param options.dataCid CID of the data that is already stored in the DWN. Must specify `options.data` if `undefined`.
   * @param options.dataSize Size of data in number of bytes. Must be defined if `options.dataCid` is defined; must be `undefined` otherwise.
   * @param options.messageTimestamp If `undefined`, it will be auto-filled with current time.
   */
  public static async create(options: RecordsCommitOptions): Promise<RecordsCommit> {
    throw new Error('unimplemented')
  }

  /**
  * Gets the DID of the author of the given message.
  */
  public static getAttesters(message: RecordsCommitMessage): string[] {
    const attestationSignatures = message.attestation?.signatures ?? [];
    const attesters = attestationSignatures.map((signature) => Jws.getSignerDid(signature));
    return attesters;
  }
}