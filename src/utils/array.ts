
/**
 * Asynchronously iterates an {AsyncGenerator} to return all the values in an array.
 */
export async function asyncGeneratorToArray<T>(iterator: AsyncGenerator<T>): Promise<Array<T>> {
  const array: Array<T> = [ ];
  for await (const value of iterator) {
    array.push(value);
  }
  return array;
}

export function sum(iterable: Iterable<number>): number {
  let result = 0;
  for (const value of iterable) {
    result += value;
  }
  return result;
}
