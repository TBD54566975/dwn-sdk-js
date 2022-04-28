/**
 * Represents a flattened JWS JSON serialized model.
 */
type JwkEd25519 = {
  protected: string,
  payload: string,
  signature: string
}

export default JwkEd25519;
