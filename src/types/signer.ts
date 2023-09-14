/**
 * A signer interface that can signing over arbitrary bytes.
 */
export interface Signer {
  /**
   * Signs the given content and returns the signature as bytes.
   */
  sign (content: Uint8Array): Promise<Uint8Array>;
}
