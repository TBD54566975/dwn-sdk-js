/**
 * Represents a flattened JWS JSON serialized model.
 */
export default interface JwsFlattenedModel {
  protected: string,
  payload: string,
  signature: string
}
