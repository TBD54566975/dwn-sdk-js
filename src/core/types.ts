import type { GeneralJws, SignatureInput } from '../jose/jws/general/types';

import { CID } from 'multiformats/cid';
import { DidResolver } from '../did/did-resolver';
import { MessageStore } from '../store/message-store';

/**
 * Intersection type for all concrete message types.
 */
export type BaseMessage = {
  descriptor: {
    target: string;
    method: string;
  };
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
 * Message that includes `authorization` property.
 */
export type AuthorizableMessage = {
  authorization: GeneralJws;
};


export type AuthVerificationResult = {
  /** Author DID */
  author: string;
  /** parsed JWS payload */
  payload: { descriptorCid: CID, [key: string]: CID }
};

/**
 * concrete Message classes should implement this interface if the Message contains authorization
 */
export interface Authorizable {
  /**
   * validates and verifies the `authorization` property of a given message
   * @param didResolver - used to resolve `kid`'s
   */
  verifyAuth(didResolver: DidResolver, messageStore: MessageStore): Promise<AuthVerificationResult>;
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