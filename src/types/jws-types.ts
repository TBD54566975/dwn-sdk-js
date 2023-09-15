import type { Signer } from '../types/signer.js';
/**
 * General JWS definition. Payload is returned as an empty
 * string when JWS Unencoded Payload Option
 * [RFC7797](https://www.rfc-editor.org/rfc/rfc7797) is used.
 */
export type GeneralJws = {
  payload: string
  signatures: SignatureEntry[]
};

/**
 * An entry of the `signatures` array in a general JWS.
 */
export type SignatureEntry = {
  /**
   * The "protected" member MUST be present and contain the value
   * BASE64URL(UTF8(JWS Protected Header)) when the JWS Protected
   * Header value is non-empty; otherwise, it MUST be absent.  These
   * Header Parameter values are integrity protected.
   */
  protected: string

  /**
   * The "signature" member MUST be present and contain the value
   * BASE64URL(JWS Signature).
   */
  signature: string
};

export type JwsHeaderParameters = {
  /**
   * JWS "alg" (Algorithm) Header Parameter.
   *
   * This parameter is not used by the DWN but is unfortunately a required header property for a JWS as per:
   * https://datatracker.ietf.org/doc/html/rfc7515#section-4.1.1
   *
   * Valid signature algorithm values can be found at https://www.iana.org/assignments/jose/jose.xhtml
   */
  alg: string

  /**
   * JWS "kid" (Key ID) Parameter.
   *
   * This property is not a required property per JWS specification, but is required for DWN authentication.
   * This needs to be a fully-qualified ID (ie. prefixed with DID) so that author can be parsed out for processing such as `recordId` computation.
   */
  kid: string
};

/**
 * Input required to sign a DWN message.
 */
export type SignatureInput = {
  protectedHeader: JwsHeaderParameters

  /**
   * Signer used to produce the signature.
   * You can use `PrivateKeySigner` if you have the private key readily available.
   */
  signer: Signer
};