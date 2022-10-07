/**
 * DID related operations.
 */
export class Did {
  /**
   * Gets the method specific ID segment of a DID. ie. did:<method>:<method-specific-id>
   */
  public static getMethodSpecificId(did: string): string {
    const secondColonIndex = did.indexOf(':', 4); // start search for : from the method portion
    const methodSpecificId = did.substring(secondColonIndex + 1);
    return methodSpecificId;
  }
}
