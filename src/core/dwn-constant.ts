export class DwnConstant {
  /**
   * The maximum size of raw data that will be returned as `encodedData`.
   *
   * We chose 30k, as after encoding it would give plenty of headroom up to the 65k limit in most SQL variants.
   * We currently encode using base64url which is a 33% increase in size.
   */
  public static readonly maxDataSizeAllowedToBeEncoded = 30_000;
}