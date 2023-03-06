/**
 * Class containing data comparison utilities.
 */
export class Comparer {
  /**
   * Returns `true` if content of the two given byte arrays are equal; `false` otherwise.
   */
  public static byteArraysEqual(array1: Uint8Array, array2:Uint8Array): boolean {
    const equal = array1.length === array2.length && array1.every((value, index) => value === array2[index]);
    return equal;
  }
}