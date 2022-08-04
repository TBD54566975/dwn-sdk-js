/**
 * Removes all properties with `undefined` as its value from the given object.
 */
export function removeUndefinedProperties(obj: object): void {
  Object.keys(obj).forEach(key => {
    if (obj[key] === undefined) {
      delete obj[key];
    }
  });
}
