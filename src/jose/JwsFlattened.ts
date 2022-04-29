/**
 * Represents a flattened JWS JSON serialized model.
 */
type JwsFlattened = {
  protected: string,
  payload: string,
  signature: string
};

export default JwsFlattened;
