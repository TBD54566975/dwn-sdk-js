/**
 * a Context object is used to pass request-scoped values and cancellation signals across API boundaries.
 * Context objects are passed all the way down the call-stack
 */
export interface Context {
  /** the attester DID (if present) of the message being processed */
  attester?: string
  /** the author DID (if present) of the message being processed */
  author?: string
  /** used as a means to cancel an async operation. More about `AbortSignal` can be read here:
   * https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal
   */
  signal?: AbortSignal
  /** the recipient DID of the message being processed */
  tenant: string
};

/**
 * DeepPartial is very similar to Partial with the addition of accommodating nested objects
 */
export type DeepPartial<K> = {
  [attr in keyof K]?: K[attr] extends object ? DeepPartial<K[attr]> : K[attr];
};