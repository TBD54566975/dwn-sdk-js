import type { GenericMessage, GenericSignaturePayload } from '../types/message-types.js';

/**
 * A signer that is capable of generating a digital signature over any given bytes.
 */
export interface RecordsMethod<M extends GenericMessage> {
  /**
   * Valid JSON message representing this RecordsQuery.
   */
  get message(): M;

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
