import { DIDResolver } from '../did/did-resolver';
import type { GeneralJws, SignatureInput } from '../jose/jws/general/types';

export interface JsonMessage {
  descriptor: {
    method: string;
    [key: string]: unknown;
  };
  [key:string]: unknown;
}

export interface JsonDataMessage extends JsonMessage {
  descriptor: {
    method: string;
    dataCid: string;
    [key: string]: unknown;
  };
  [key:string]: any;
}

export interface Attestation {
  attestation?: GeneralJws;
};

export interface Authorization {
  authorization: GeneralJws;
}

export type AuthVerificationResult = {
  signers: string[];
};

export interface Authorizable {
  verifyAuth(didResolver: DIDResolver): Promise<AuthVerificationResult>;
}

export interface Attestable {
  attest(): Promise<void>;
  verifyAttestation(didResolver: DIDResolver): Promise<string>;
}

export interface AuthCreateOpts {
  signingMaterial: SignatureInput
}