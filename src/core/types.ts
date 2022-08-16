import type { DeepPartial } from '../types';
import type { GeneralJws, SignatureInput } from '../jose/jws/general/types';

import { CID } from 'multiformats/cid';
import { DIDResolver } from '../did/did-resolver';

/**
 * Intersection type for all concrete message schema types (e.g. PermissionsRequestSchema)
 */
export type BaseMessageSchema = {
  descriptor: {
    method: string;
  };
};

/**
 * Intersection type for message schema types that include `data`
 */
export type Data = {
  descriptor: {
    dataCid: string;
  };

  encodedData: string;
};

export type Attestation = {
  attestation?: GeneralJws;
};

/**
 * Intersection type for message schema types that include `authorization`
 */
export type Authorization = {
  authorization: GeneralJws;
};

export type GenericMessageSchema = BaseMessageSchema & DeepPartial<Data> & Partial<Attestation> & Partial<Authorization> & {
  descriptor: {
    [key: string]: unknown;
  }
};

export type AuthVerificationResult = {
  /** DIDs of all signers */
  signers: string[];
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
  verifyAuth(didResolver: DIDResolver): Promise<AuthVerificationResult>;
}

/**
 * concrete Message classes should implement this interface if the Message contains authorization
 */
export interface Attestable {
  attest(): Promise<void>;
  verifyAttestation(didResolver: DIDResolver): Promise<string>;
}

export type AuthCreateOptions = {
  signatureInput: SignatureInput
};

export type RequestSchema = {
  messages: BaseMessageSchema[]
  target: string
};