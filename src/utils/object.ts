import flat from 'flat';

type IndexableByString = { [key: string]: unknown };

/**
 * Flattens the given object.
 * e.g. `{ a: { b: { c: 42 } } }` becomes `{ 'a.b.c': 42 }`
 */
export function flatten(obj: unknown): object {
  const flattened = flat.flatten<unknown, IndexableByString>(obj);
  removeEmptyObjects(flattened);
  return flattened;
}

/**
 * Checks whether the given object has any properties.
 */
export function isEmptyObject(obj: unknown): boolean {
  if (typeof(obj) !== 'object') {
    return false;
  }

  for (const _ in obj) {
    return false;
  }

  return true;
}

/**
 * Recursively removes all properties with an empty object or array as its value from the given object.
 */
export function removeEmptyObjects(obj: IndexableByString): void {
  Object.keys(obj).forEach(key => {
    if (isEmptyObject(obj[key])) {
      delete obj[key];
    } else if (typeof(obj[key]) === 'object') {
      removeEmptyObjects(obj[key] as IndexableByString); // recursive remove empty object or array properties in nested objects
    }
  });
}

/**
 * Recursively removes all properties with `undefined` as its value from the given object.
 */
export function removeUndefinedProperties(obj: IndexableByString): void {
  Object.keys(obj).forEach(key => {
    if (obj[key] === undefined) {
      delete obj[key];
    } else if (typeof(obj[key]) === 'object') {
      removeUndefinedProperties(obj[key] as IndexableByString); // recursive remove `undefined` properties in nested objects
    }
  });
}
