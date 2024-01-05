/**
 * An interface that gates tenant access to the DWN.
 */
export interface TenantGate {
  /**
   * @returns `true` if the given DID is an active tenant of the DWN; `false` otherwise
   */
  isActiveTenant(did: string): Promise<boolean>;
}

/**
 * A tenant gate that treats every DID as an active tenant.
 */
export class AllowAllTenantGate implements TenantGate {
  public async isActiveTenant(_did: string): Promise<boolean> {
    return true;
  }
}
