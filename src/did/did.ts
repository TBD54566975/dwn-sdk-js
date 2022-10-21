/**
 * DID related operations.
 */
export class Did {
  /**
   * Gets the method specific ID segment of a DID. ie. did:<method-name>:<method-specific-id>
   */
  public static getMethodSpecificId(did: string): string {
    const secondColonIndex = did.indexOf(':', 4); // start search for : from the method portion
    const methodSpecificId = did.substring(secondColonIndex + 1);
    return methodSpecificId;
  }

  /**
   * Gets the method name from a DID. ie. did:<method-name>:<method-specific-id>
   */
  public static getMethodName(did: string): string {
    const secondColonIndex = did.indexOf(':', 4); // start search for : from the method portion
    const methodName = did.substring(4, secondColonIndex);
    return methodName;
  }
}
