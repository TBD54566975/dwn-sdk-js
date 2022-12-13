import type { GeneralJws, SignatureInput } from '../jose/jws/general/types.js';

import { CID } from 'multiformats/cid';
import { DidResolver } from '../did/did-resolver.js';
import { MessageStore } from '../store/message-store.js';

/**
 * Intersection type for all concrete message types.
 */
export type BaseMessage = {
  descriptor: Descriptor
  authorization: GeneralJws;
};

/**
 * Type of common decoded `authorization`property payload.
 */
export type BaseDecodedAuthorizationPayload = {
  target: string;
  descriptorCid: string;
};

/**
 * Intersection type for all DWN message descriptor.
 */
export type Descriptor = {
  method: string;
};

/**
 * Message that references `dataCid`.
 */
export type DataReferencingMessage = {
  descriptor: {
    dataCid: string;
  };

  encodedData: string;
};

/**
 * Message that includes `attestation` property.
 */
export type AttestableMessage = {
  attestation: GeneralJws;
};

/**
 * concrete Message classes should implement this interface if the Message contains authorization
 */
export interface Authorizable {
  /**
   * validates and verifies the `authorization` property of a given message
   * @param didResolver - used to resolve `kid`'s
   * @throws {Error} if auth fails
   *
   */
  verifyAuth(didResolver: DidResolver, messageStore: MessageStore): Promise<void>;
}

/**
 * concrete Message classes should implement this interface if the Message contains `attestation`
 */
export interface Attestable {
  attest(): Promise<void>;
  verifyAttestation(didResolver: DidResolver): Promise<string>;
}

export type AuthCreateOptions = {
  signatureInput: SignatureInput
};

export type RequestSchema = {
  messages: BaseMessage[]
};