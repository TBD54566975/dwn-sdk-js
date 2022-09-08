/**
 * DeepPartial is very similar to Partial with the addition of accommodating nested objects
 */
export type DeepPartial<K> = {
  [attr in keyof K]?: K[attr] extends object ? DeepPartial<K[attr]> : K[attr];
};