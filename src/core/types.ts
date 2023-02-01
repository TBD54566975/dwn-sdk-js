import type { GeneralJws, SignatureInput } from '../jose/jws/general/types.js';

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
  descriptorCid: string;
};

/**
 * Intersection type for all DWN message descriptor.
 */
export type Descriptor = {
  interface: string;
  method: string;
};

/**
 * Messages that have `dateModified` in their `descriptor` property.
 */
export type TimestampedMessage = BaseMessage & {
  descriptor: {
    dateModified: string;
  }
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

export type AuthCreateOptions = {
  signatureInput: SignatureInput
};
