/**
 * A signer that is capable of generating a digital signature over any given bytes.
 */
export interface Signer {
  /**
   * The ID of the key used by this signer.
   * This needs to be a fully-qualified ID (ie. prefixed with DID) so that author can be parsed out for processing such as `recordId` computation.
   * Example: did:example:alice#key1
   * This value will be used as the "kid" parameter in JWS produced.
   * While this property is not a required property per JWS specification, it is required for DWN authentication.
   */
  keyId: string

  /**
   * The name of the signature algorithm used by this signer.
   * This value will be used as the "alg" parameter in JWS produced.
   * This parameter is not used by the DWN but is unfortunately a required header property for a JWS as per:
   * https://datatracker.ietf.org/doc/html/rfc7515#section-4.1.1
   * Valid signature algorithm values can be found at https://www.iana.org/assignments/jose/jose.xhtml
   */
  algorithm: string;

  /**
   * Signs the given content and returns the signature as bytes.
   */
  sign (content: Uint8Array): Promise<Uint8Array>;
}
