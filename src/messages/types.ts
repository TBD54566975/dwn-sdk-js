import type { GeneralJws } from '../jose/types';

export interface JsonMessage {
  descriptor: {
    method: string;
    [key: string]: any;
  };
  [key:string]: any;
}

export interface JsonDataMessage extends JsonMessage {
  descriptor: {
    method: string;
    dataCid: string;
    [key: string]: any;
  };
  [key:string]: any;
}

export interface Attestation {
  attestation?: GeneralJws;
};

export interface Authorization {
  authorization: GeneralJws;
}