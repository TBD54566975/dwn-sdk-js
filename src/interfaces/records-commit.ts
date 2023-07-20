import { DwnInterfaceName, DwnMethodName, Message } from '../core/message.js';
import { Cid, Encoder } from '../index.js';
import { GeneralJwsSigner } from '../jose/jws/general/signer.js';
import { GeneralJws, SignatureInput } from '../types/jws-types.js';
import type {
  CommitStrategy,
  EncryptionInput,
  RecordsCommitMessage,
  RecordsCommitDescriptor,
  RecordsAttestationPayload,
  EncryptionProperty,
  RecordsAuthorizationPayload,
} from '../types/records-types.js';
import { Jws } from '../utils/jws.js';
import { removeUndefinedProperties } from '../utils/object.js';
import { getCurrentTimeInHighPrecision } from '../utils/time.js';
import { normalizeSchemaUrl } from '../utils/url.js';

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
    if ((options.data === undefined && options.dataCid === undefined) ||
        (options.data !== undefined && options.dataCid !== undefined)) {
      throw new Error('one and only one parameter between `data` and `dataCid` is allowed');
    }

    if ((options.dataCid === undefined && options.dataSize !== undefined) ||
        (options.dataCid !== undefined && options.dataSize === undefined)) {
      throw new Error('`dataCid` and `dataSize` must both be defined or undefined at the same time');
    }

    const { recordId } = options;

    const dataCid = options.dataCid ?? await Cid.computeDagPbCidFromBytes(options.data!);
    const dataSize = options.dataSize ?? options.data!.length;

    const currentTime = getCurrentTimeInHighPrecision();

    const descriptor: RecordsCommitDescriptor = {
      interface        : DwnInterfaceName.Records,
      method           : DwnMethodName.Commit,
      recipient        : options.recipient,
      schema           : options.schema !== undefined ? normalizeSchemaUrl(options.schema) : undefined,
      parentId         : options.parentId,
      commitStrategy   : options.commitStrategy,
      dataCid,
      dataSize,
      dateCreated      : options.dateCreated ?? currentTime,
      messageTimestamp : options.messageTimestamp ?? currentTime,
      dataFormat       : options.dataFormat
    };

    removeUndefinedProperties(descriptor);

    //TODO: `contextId` computation
    let contextId: string | undefined;

    const descriptorCid = await Cid.computeCid(descriptor);
    const attestation = await RecordsCommit.createAttestation(descriptorCid, options.attestationSignatureInputs);

    //TODO: encryption
    const encryption = undefined;

    // `authorization` generation
    const authorization = await RecordsCommit.createAuthorization(
      recordId,
      contextId,
      descriptorCid,
      attestation,
      encryption,
      options.authorizationSignatureInput
    );

    const message: RecordsCommitMessage = {
      recordId,
      descriptor,
      authorization
    };

    if (contextId !== undefined) { message.contextId = contextId; } // assign `contextId` only if it is defined
    if (attestation !== undefined) { message.attestation = attestation; } // assign `attestation` only if it is defined
    if (encryption !== undefined) { message.encryption = encryption; } // assign `encryption` only if it is defined

    Message.validateJsonSchema(message);

    return new RecordsCommit(message)
  }

  /**
   * Creates the `authorization` property of a RecordsCommit message.
   */
  public static async createAuthorization(
    recordId: string,
    contextId: string | undefined,
    descriptorCid: string,
    attestation: GeneralJws | undefined,
    encryption: EncryptionProperty | undefined,
    signatureInput: SignatureInput
  ): Promise<GeneralJws> {
    const authorizationPayload: RecordsAuthorizationPayload = {
      recordId,
      descriptorCid
    };

    const attestationCid = attestation ? await Cid.computeCid(attestation) : undefined;
    const encryptionCid = encryption ? await Cid.computeCid(encryption) : undefined;

    if (contextId !== undefined) { authorizationPayload.contextId = contextId; } // assign `contextId` only if it is defined
    if (attestationCid !== undefined) { authorizationPayload.attestationCid = attestationCid; } // assign `attestationCid` only if it is defined
    if (encryptionCid !== undefined) { authorizationPayload.encryptionCid = encryptionCid; } // assign `encryptionCid` only if it is defined

    const authorizationPayloadBytes = Encoder.objectToBytes(authorizationPayload);

    const signer = await GeneralJwsSigner.create(authorizationPayloadBytes, [signatureInput]);
    return signer.getJws();
  }

  /**
   * Creates the `attestation` property of a RecordsCommit message if given signature inputs; returns `undefined` otherwise.
   */
  public static async createAttestation(descriptorCid: string, signatureInputs?: SignatureInput[]): Promise<GeneralJws | undefined> {
    if (signatureInputs === undefined || signatureInputs.length === 0) {
      return undefined;
    }

    const attestationPayload: RecordsAttestationPayload = { descriptorCid };
    const attestationPayloadBytes = Encoder.objectToBytes(attestationPayload);

    const signer = await GeneralJwsSigner.create(attestationPayloadBytes, signatureInputs);
    return signer.getJws();
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