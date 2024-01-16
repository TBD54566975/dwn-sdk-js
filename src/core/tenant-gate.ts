/**
 * The result of the isActiveTenant() call.
 */
export type ActiveTenantCheckResult = {
  /**
   * `true` if the given DID is an active tenant of the DWN; `false` otherwise.
   */
  isActiveTenant: boolean;

  /**
   * An optional detail message if the given DID is not an active tenant of the DWN.
   */
  detail?: string;
};

/**
 * An interface that gates tenant access to the DWN.
 */
export interface TenantGate {
  /**
   * @returns `true` if the given DID is an active tenant of the DWN; `false` otherwise
   */
  isActiveTenant(did: string): Promise<ActiveTenantCheckResult>;
}

/**
 * A tenant gate that treats every DID as an active tenant.
 */
export class AllowAllTenantGate implements TenantGate {
  public async isActiveTenant(_did: string): Promise<ActiveTenantCheckResult> {
    return { isActiveTenant: true };
  }
}
