/**
 * A JWS in flattened JWS JSON format.
 */
export type JwsFlattened = {
  protected: string,
  payload: string,
  signature: string
};
