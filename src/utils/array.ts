export async function fromAsync<T>(iterator: AsyncGenerator<T>): Promise<Array<T>> {
  const array = [ ];
  for await (const value of iterator) {
    array.push(value);
  }
  return array;
}
