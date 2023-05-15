/**
 * Array utility methods.
 */
export class ArrayUtility {
  /**
   * Returns `true` if content of the two given byte arrays are equal; `false` otherwise.
   */
  public static byteArraysEqual(array1: Uint8Array, array2:Uint8Array): boolean {
    const equal = array1.length === array2.length && array1.every((value, index) => value === array2[index]);
    return equal;
  }

  /**
   * Asynchronously iterates an {AsyncGenerator} to return all the values in an array.
   */
  public static async fromAsyncGenerator<T>(iterator: AsyncGenerator<T>): Promise<Array<T>> {
    const array: Array<T> = [ ];
    for await (const value of iterator) {
      array.push(value);
    }
    return array;
  }
}