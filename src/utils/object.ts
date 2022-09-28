/**
 * Recursively removes all properties with `undefined` as its value from the given object.
 */
export function removeUndefinedProperties(obj: object): void {
  Object.keys(obj).forEach(key => {
    if (obj[key] === undefined) {
      delete obj[key];
    } else if (typeof(obj[key]) === 'object') {
      removeUndefinedProperties(obj[key]); // recursive remove `undefined` properties in nested objects
    }
  });
}
