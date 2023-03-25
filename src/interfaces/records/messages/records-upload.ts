import type { BaseMessage } from '../../../core/types.js';
import type { MessageStore } from '../../../store/message-store.js';
import type { GeneralJws, SignatureInput } from '../../../jose/jws/general/types.js';
import type { RecordsAttestationPayload, RecordsAuthorizationPayload, RecordsUploadCompleteDescriptor, RecordsUploadCompleteMessage, RecordsUploadPartDescriptor, RecordsUploadPartMessage, RecordsUploadStartDescriptor, RecordsUploadStartMessage } from '../types.js';

import { Encoder } from '../../../utils/encoder.js';
import { GeneralJwsSigner } from '../../../jose/jws/general/signer.js';
import { Jws } from '../../../utils/jws.js';
import { Message } from '../../../core/message.js';
import { ProtocolAuthorization } from '../../../core/protocol-authorization.js';
import { removeUndefinedProperties } from '../../../utils/object.js';

import { authorize, validateAuthorizationIntegrity } from '../../../core/auth.js';
import { Cid, computeCid } from '../../../utils/cid.js';
import { DwnInterfaceName, DwnMethodName, DwnStateName } from '../../../core/message.js';

type RecordsUploadMessageVariant = RecordsUploadCompleteMessage | RecordsUploadPartMessage | RecordsUploadStartMessage;

type RecordsUploadDescriptorVariant = RecordsUploadCompleteDescriptor | RecordsUploadPartDescriptor | RecordsUploadStartDescriptor;

type RecordsUploadOptions = {
  protocol?: string;
  schema?: string;
  recipient?: string;
  authorizationSignatureInput: SignatureInput;
  attestationSignatureInputs?: SignatureInput[];
};

export type RecordsUploadStartOptions = RecordsUploadOptions & {
  recordId?: string;
  dataFormat: string;
};

export type RecordsUploadPartOptions = RecordsUploadOptions & {
  recordId: string;
  index: number;
  data?: Uint8Array;
  dataCid?: string;
  dataSize?: number;
};

export type RecordsUploadCompleteOptions = RecordsUploadOptions & {
  recordId: string;
  count: number;
  dataCid: string;
  dataSize: number;
};

export class RecordsUpload extends Message {
  /**
   * RecordsUpload message adhering to the DWN specification.
   */
  readonly message: RecordsUploadMessageVariant;
  readonly attesters: string[];

  private constructor(message: RecordsUploadMessageVariant) {
    super(message);

    this.attesters = RecordsUpload.getAttesters(message);

    // consider converting isUploadStart() & isUploadComplete() & getEntryId() into properties for performance and convenience
  }

  public static async parse(message: RecordsUploadMessageVariant): Promise<RecordsUpload> {
    // asynchronous checks that are required by the constructor to initialize members properly
    await validateAuthorizationIntegrity(message, { allowedProperties: new Set([ 'recordId', 'attestationCid' ]) });
    await RecordsUpload.validateAttestationIntegrity(message);

    const recordsUpload = new RecordsUpload(message);

    await recordsUpload.validateIntegrity(); // RecordsUpload specific data integrity check

    return recordsUpload;
  }

  /**
   * Creates a RecordsUpload start message.
   * @param options.recordId If `undefined`, will be auto-filled as a originating message as convenience for developer.
   * @param options.dataFormat Format of the data. Must be provided.
   */
  public static async createStart(options: RecordsUploadStartOptions): Promise<RecordsUpload> {
    const descriptor: RecordsUploadStartDescriptor = {
      interface  : DwnInterfaceName.Records,
      method     : DwnMethodName.Upload,
      state      : DwnStateName.Start,
      protocol   : options.protocol,
      schema     : options.schema,
      recipient  : options.recipient,
      dataFormat : options.dataFormat
    };

    // delete all descriptor properties that are `undefined` else the code will encounter the following IPLD issue when attempting to generate CID:
    // Error: `undefined` is not supported by the IPLD Data Model and cannot be encoded
    removeUndefinedProperties(descriptor);

    const author = Jws.extractDid(options.authorizationSignatureInput.protectedHeader.kid);

    // `recordId` computation
    const recordId = options.recordId ?? await RecordsUpload.getEntryId(author, descriptor);

    // `attestation` generation
    const descriptorCid = await computeCid(descriptor);
    const attestation = await RecordsUpload.createAttestation(descriptorCid, options.attestationSignatureInputs);

    // `authorization` generation
    const authorization = await RecordsUpload.createAuthorization(
      recordId,
      descriptorCid,
      attestation,
      options.authorizationSignatureInput
    );

    const message: RecordsUploadStartMessage = {
      recordId,
      descriptor,
      authorization
    };

    if (attestation !== undefined) { message.attestation = attestation; } // assign `attestation` only if it is defined

    Message.validateJsonSchema(message);

    return new RecordsUpload(message);
  }

  /**
   * Creates a RecordsUpload part message.
   * @param options.recordId The ID of the upload. Must be provided.
   * @param options.index Where this part exists in the overall data. Must be provided.
   * @param options.data Data used to compute the `dataCid`. Must specify `option.dataCid` if `undefined`.
   * @param options.dataCid CID of the data that is already stored in the DWN. Must specify `option.data` if `undefined`.
   * @param options.dataSize Size of data in number of bytes. Must be defined if `option.dataCid` is defined; must be `undefined` otherwise.
   */
  public static async createPart(options: RecordsUploadPartOptions): Promise<RecordsUpload> {
    if ((options.data === undefined && options.dataCid === undefined) ||
        (options.data !== undefined && options.dataCid !== undefined)) {
      throw new Error('one and only one parameter between `data` and `dataCid` is allowed');
    }

    if ((options.dataCid === undefined && options.dataSize !== undefined) ||
        (options.dataCid !== undefined && options.dataSize === undefined)) {
      throw new Error('`dataCid` and `dataSize` must both be defined or undefined at the same time');
    }

    const dataCid = options.dataCid ?? await Cid.computeDagPbCidFromBytes(options.data!);
    const dataSize = options.dataSize ?? options.data!.length;

    const descriptor: RecordsUploadPartDescriptor = {
      interface : DwnInterfaceName.Records,
      method    : DwnMethodName.Upload,
      state     : DwnStateName.Part,
      protocol  : options.protocol,
      schema    : options.schema,
      recipient : options.recipient,
      index     : options.index,
      dataCid,
      dataSize
    };

    // delete all descriptor properties that are `undefined` else the code will encounter the following IPLD issue when attempting to generate CID:
    // Error: `undefined` is not supported by the IPLD Data Model and cannot be encoded
    removeUndefinedProperties(descriptor);

    // `attestation` generation
    const descriptorCid = await computeCid(descriptor);
    const attestation = await RecordsUpload.createAttestation(descriptorCid, options.attestationSignatureInputs);

    // `authorization` generation
    const authorization = await RecordsUpload.createAuthorization(
      options.recordId,
      descriptorCid,
      attestation,
      options.authorizationSignatureInput
    );

    const message: RecordsUploadPartMessage = {
      recordId: options.recordId,
      descriptor,
      authorization
    };

    if (attestation !== undefined) { message.attestation = attestation; } // assign `attestation` only if it is defined

    Message.validateJsonSchema(message);

    return new RecordsUpload(message);
  }

  /**
   * Creates a RecordsUpload message.
   * @param options.recordId The ID of the upload. Must be provided.
   * @param options.count Number of parts for the upload. Must be provided.
   * @param options.dataCid CID of the data that has already been uploaded to the DWN. Must be provided.
   * @param options.dataSize Size of data in number of bytes. Must be provided.
   */
  public static async createComplete(options: RecordsUploadCompleteOptions): Promise<RecordsUpload> {
    const descriptor: RecordsUploadCompleteDescriptor = {
      interface : DwnInterfaceName.Records,
      method    : DwnMethodName.Upload,
      state     : DwnStateName.Complete,
      protocol  : options.protocol,
      schema    : options.schema,
      recipient : options.recipient,
      count     : options.count,
      dataCid   : options.dataCid,
      dataSize  : options.dataSize
    };

    // delete all descriptor properties that are `undefined` else the code will encounter the following IPLD issue when attempting to generate CID:
    // Error: `undefined` is not supported by the IPLD Data Model and cannot be encoded
    removeUndefinedProperties(descriptor);

    // `attestation` generation
    const descriptorCid = await computeCid(descriptor);
    const attestation = await RecordsUpload.createAttestation(descriptorCid, options.attestationSignatureInputs);

    // `authorization` generation
    const authorization = await RecordsUpload.createAuthorization(
      options.recordId,
      descriptorCid,
      attestation,
      options.authorizationSignatureInput
    );

    const message: RecordsUploadCompleteMessage = {
      recordId: options.recordId,
      descriptor,
      authorization
    };

    if (attestation !== undefined) { message.attestation = attestation; } // assign `attestation` only if it is defined

    Message.validateJsonSchema(message);

    return new RecordsUpload(message);
  }

  public async authorize(tenant: string, messageStore: MessageStore): Promise<void> {
    if (this.message.descriptor.protocol !== undefined) {
      await ProtocolAuthorization.authorize(tenant, this, this.author, messageStore);
    } else {
      await authorize(tenant, this);
    }
  }

  /**
   * Validates the integrity of the RecordsUpload message assuming the message passed basic schema validation.
   * There is opportunity to integrate better with `validateSchema(...)`
   */
  private async validateIntegrity(): Promise<void> {
    // make sure the same `recordId` in message is the same as the `recordId` in `authorization`
    if (this.message.recordId !== this.authorizationPayload.recordId) {
      throw new Error(
        `recordId in message ${this.message.recordId} does not match recordId in authorization: ${this.authorizationPayload.recordId}`
      );
    }

    // if `attestation` is given in message, make sure the correct `attestationCid` is in the `authorization`
    if (this.message.attestation !== undefined) {
      const expectedAttestationCid = await computeCid(this.message.attestation);
      const actualAttestationCid = this.authorizationPayload.attestationCid;
      if (actualAttestationCid !== expectedAttestationCid) {
        throw new Error(
          `CID ${expectedAttestationCid} of attestation property in message does not match attestationCid in authorization: ${actualAttestationCid}`
        );
      }
    }
  }

  /**
   * Validates the structural integrity of the `attestation` property.
   * NOTE: signature is not verified.
   */
  private static async validateAttestationIntegrity(message: RecordsUploadMessageVariant): Promise<void> {
    if (message.attestation === undefined) {
      return;
    }

    // TODO: multi-attesters to be unblocked by #205 - Revisit database interfaces (https://github.com/TBD54566975/dwn-sdk-js/issues/205)
    if (message.attestation.signatures.length !== 1) {
      throw new Error(`Currently implementation only supports 1 attester, but got ${message.attestation.signatures.length}`);
    }

    const payloadJson = Jws.decodePlainObjectPayload(message.attestation);
    const { descriptorCid } = payloadJson;

    // `descriptorCid` validation - ensure that the provided descriptorCid matches the CID of the actual message
    const expectedDescriptorCid = await computeCid(message.descriptor);
    if (descriptorCid !== expectedDescriptorCid) {
      throw new Error(`descriptorCid ${descriptorCid} does not match expected descriptorCid ${expectedDescriptorCid}`);
    }

    // check to ensure that no other unexpected properties exist in payload.
    const propertyCount = Object.keys(payloadJson).length;
    if (propertyCount > 1) {
      throw new Error(`Only 'descriptorCid' is allowed in attestation payload, but got ${propertyCount} properties.`);
    }
  };

  /**
   * Computes the deterministic Entry ID of this message.
   */
  public async getEntryId(): Promise<string> {
    const entryId = await RecordsUpload.getEntryId(this.author, this.message.descriptor);
    return entryId;
  };

  /**
   * Computes the deterministic Entry ID of this message.
   */
  public static async getEntryId(author: string, descriptor: RecordsUploadDescriptorVariant): Promise<string> {
    const entryIdInput = { ...descriptor };
    (entryIdInput as any).author = author;

    const cid = await computeCid(entryIdInput);
    return cid;
  };

  /**
   * Checks if the given message is the start entry of an upload.
   */
  public async isUploadStart(): Promise<boolean> {
    if (this.message.descriptor.state !== DwnStateName.Start) {
      return false;
    }

    const entryId = await this.getEntryId();
    return entryId === this.message.recordId;
  }

  /**
   * Checks if the given message is the start entry of an upload.
   */
  public static async isUploadStart(message: BaseMessage): Promise<boolean> {
    // can't be the upload start if the message is not a Records Upload
    if (message.descriptor.interface !== DwnInterfaceName.Records ||
        message.descriptor.method !== DwnMethodName.Upload) {
      return false;
    }

    if (message.descriptor.state !== DwnStateName.Start) {
      return false;
    }

    const recordsUploadStartMessage = message as RecordsUploadStartMessage;
    const author = Message.getAuthor(message);
    const entryId = await RecordsUpload.getEntryId(author, recordsUploadStartMessage.descriptor);
    return entryId === recordsUploadStartMessage.recordId;
  }

  /**
   * Checks if the given message is a part entry of an upload.
   */
  public async isUploadPart(): Promise<boolean> {
    if (this.message.descriptor.state !== DwnStateName.Part) {
      return false;
    }

    const entryId = await this.getEntryId();
    return entryId === this.message.recordId;
  }

  /**
   * Checks if the given message is a part entry of an upload.
   */
  public static async isUploadPart(message: BaseMessage): Promise<boolean> {
    // can't be an upload part if the message is not a Records Upload
    if (message.descriptor.interface !== DwnInterfaceName.Records ||
        message.descriptor.method !== DwnMethodName.Upload) {
      return false;
    }

    if (message.descriptor.state !== DwnStateName.Part) {
      return false;
    }

    const recordsUploadPartMessage = message as RecordsUploadPartMessage;
    const author = Message.getAuthor(message);
    const entryId = await RecordsUpload.getEntryId(author, recordsUploadPartMessage.descriptor);
    return entryId === recordsUploadPartMessage.recordId;
  }

  /**
   * Checks if the given message is the complete entry of an upload.
   */
  public async isUploadComplete(): Promise<boolean> {
    if (this.message.descriptor.state !== DwnStateName.Complete) {
      return false;
    }

    const entryId = await this.getEntryId();
    return entryId === this.message.recordId;
  }

  /**
   * Checks if the given message is the complete entry of an upload.
   */
  public static async isUploadComplete(message: BaseMessage): Promise<boolean> {
    // can't be the upload complete if the message is not a Records Upload
    if (message.descriptor.interface !== DwnInterfaceName.Records ||
        message.descriptor.method !== DwnMethodName.Upload) {
      return false;
    }

    if (message.descriptor.state !== DwnStateName.Complete) {
      return false;
    }

    const recordsUploadCompleteMessage = message as RecordsUploadCompleteMessage;
    const author = Message.getAuthor(message);
    const entryId = await RecordsUpload.getEntryId(author, recordsUploadCompleteMessage.descriptor);
    return entryId === recordsUploadCompleteMessage.recordId;
  }

  /**
   * Creates the `attestation` property of a RecordsUpload message if given signature inputs; returns `undefined` otherwise.
   */
  private static async createAttestation(descriptorCid: string, signatureInputs?: SignatureInput[]): Promise<GeneralJws | undefined> {
    if (signatureInputs === undefined || signatureInputs.length === 0) {
      return undefined;
    }

    const attestationPayload: RecordsAttestationPayload = { descriptorCid };
    const attestationPayloadBytes = Encoder.objectToBytes(attestationPayload);

    const signer = await GeneralJwsSigner.create(attestationPayloadBytes, signatureInputs);
    return signer.getJws();
  }

  /**
   * Creates the `authorization` property of a RecordsUpload message.
   */
  private static async createAuthorization(
    recordId: string,
    descriptorCid: string,
    attestation: GeneralJws | undefined,
    signatureInput: SignatureInput
  ): Promise<GeneralJws> {
    const authorizationPayload: RecordsAuthorizationPayload = {
      recordId,
      descriptorCid
    };

    const attestationCid = attestation ? await computeCid(attestation) : undefined;

    if (attestationCid !== undefined) { authorizationPayload.attestationCid = attestationCid; } // assign `attestationCid` only if it is defined

    const authorizationPayloadBytes = Encoder.objectToBytes(authorizationPayload);

    const signer = await GeneralJwsSigner.create(authorizationPayloadBytes, [signatureInput]);
    return signer.getJws();
  }

  /**
   * Gets the upload start from the given list or record upload.
   */
  public static async getUploadStart(messages: BaseMessage[]): Promise<RecordsUploadStartMessage> {
    for (const message of messages) {
      if (await RecordsUpload.isUploadStart(message)) {
        return message as RecordsUploadStartMessage;
      }
    }

    throw new Error(`upload start is not found`);
  }

  /**
   * Gets the upload complete from the given list or record upload.
   */
  public static async getUploadComplete(messages: BaseMessage[]): Promise<RecordsUploadCompleteMessage> {
    for (const message of messages) {
      if (await RecordsUpload.isUploadComplete(message)) {
        return message as RecordsUploadCompleteMessage;
      }
    }

    throw new Error(`upload complete is not found`);
  }

  /**
   * Verifies that immutable properties of the two given messages are identical.
   * @throws {Error} if immutable properties between two RecordsWrite message
   */
  public static verifyEqualityOfImmutableProperties(existingMessage: RecordsUploadMessageVariant, newMessage: RecordsUploadMessageVariant): void {
    for (const immutableDescriptorProperty of [ 'protocol', 'schema', 'recipient' ]) {
      const existingValue = existingMessage.descriptor[immutableDescriptorProperty];
      const newValue = newMessage.descriptor[immutableDescriptorProperty];
      if ((existingValue !== undefined || newValue !== undefined) && newValue !== existingValue) {
        throw new Error(`${immutableDescriptorProperty} is an immutable property: cannot change '${existingValue}' to '${newValue}'`);
      }
    }
  }

  /**
   * Verifies that unique properties of the two given messages are not the same.
   * @throws {Error} if unique properties between two RecordsWrite message
   */
  public static verifyExclusivityOfUniqueProperties(existingMessage: RecordsUploadMessageVariant, newMessage: RecordsUploadMessageVariant): void {
    for (const uniqueDescriptorProperty of [ 'index' ]) {
      const existingValue = existingMessage.descriptor[uniqueDescriptorProperty];
      const newValue = newMessage.descriptor[uniqueDescriptorProperty];
      if ((existingValue !== undefined || newValue !== undefined) && newValue === existingValue) {
        throw new Error(`${uniqueDescriptorProperty} is a unique property: cannot reuse '${existingValue}'`);
      }
    }
  }

  /**
   * Gets the DID of the author of the given message.
   */
  public static getAttesters(message: RecordsUploadMessageVariant): string[] {
    const attestationSignatures = message.attestation?.signatures ?? [];
    const attesters = attestationSignatures.map((signature) => Jws.getSignerDid(signature));
    return attesters;
  }
}
