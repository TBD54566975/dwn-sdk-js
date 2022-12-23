/**
 * Compares two string given in lexicographical order.
 * @returns 1 if `a` is larger than `b`; -1 if `a` is smaller/older than `b`; 0 otherwise (same message)
 */
export function lexicographicalCompare(a: string, b: string): number {
  if (a > b) {
    return 1;
  } else if (a < b) {
    return -1;
  } else {
    return 0;
  }
}
