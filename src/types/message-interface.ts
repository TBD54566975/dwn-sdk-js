import type { GenericMessage, GenericSignaturePayload } from './message-types.js';

/**
 * An generic interface that represents a DWN message and convenience methods for working with it.
 */
export interface MessageInterface<M extends GenericMessage> {
  /**
   * Valid JSON message representing this DWN message.
   */
  get message(): M;

  /**
   * Gets the signer of this message.
   * This is not to be confused with the logical author of the message.
   */
  get signer(): string | undefined;

  /**
   * DID of the logical author of this message.
   * NOTE: we say "logical" author because a message can be signed by a delegate of the actual author,
   * in which case the author DID would not be the same as the signer/delegate DID,
   * but be the DID of the grantor (`grantedBy`) of the delegated grant presented.
   */
  get author(): string | undefined;

  /**
   * Decoded payload of the signature of this message.
   */
  get signaturePayload(): GenericSignaturePayload | undefined;
}
