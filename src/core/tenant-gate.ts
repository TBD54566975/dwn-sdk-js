/**
 * An interface that determines if a DID is a tenant of the DWN.
 */
export interface TenantGate {
  /**
   * @returns `true` if the given DID is a tenant of the DWN; `false` otherwise
   */
  isTenant(did: string): Promise<boolean>;
}

/**
 * A tenant gate that treats every DID as a tenant.
 */
export class AllowAllTenantGate implements TenantGate {
  public async isTenant(_did: string): Promise<boolean> {
    return true;
  }
}
