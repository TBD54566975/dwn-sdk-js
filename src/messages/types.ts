import type { DeepPartial } from '../types';
import type { GeneralJws, SignatureInput } from '../jose/jws/general/types';

import { DIDResolver } from '../did/did-resolver';
import { PermissionsRequestSchema } from '../interfaces/permissions/request/types';

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

  data: string;
};

/**
 * Intersection type for message schema types that include `attestation`
 */
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


export type MessageSchema = PermissionsRequestSchema | GenericMessageSchema;

export type AuthVerificationResult = {
  signers: string[];
};

/**
 * concrete Message classes should implement this interface if the Message contains authorization
 */
export interface Authorizable {
  verifyAuth(didResolver: DIDResolver): Promise<AuthVerificationResult>;
}

/**
 * concrete Message classes should implement this interface if the Message contains authorization
 */
export interface Attestable {
  attest(): Promise<void>;
  verifyAttestation(didResolver: DIDResolver): Promise<string>;
}

export interface AuthCreateOpts {
  signatureInput: SignatureInput
}