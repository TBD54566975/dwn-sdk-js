import type { DataEncodedRecordsWriteMessage } from '../types/records-types.js';
import type { PermissionConditions, PermissionRequestData, PermissionScope } from '../types/permission-types.js';

import { Encoder } from '../utils/encoder.js';
import { Message } from '../core/message.js';


/**
 * A class representing a Permission Request for a more convenient abstraction.
 */
export class PermissionRequest {

  /**
   * The ID of the permission request, which is the record ID DWN message.
   */
  public readonly id: string;

  /**
   * The requester for of the permission.
   */
  public readonly requester: string;

  /**
   * Optional string that communicates what the requested grant would be used for.
   */
  public readonly description?: string;

  /**
   * Whether the requested grant is delegated or not.
   * If `true`, the `requestor` will be able to act as the grantor of the permission within the scope of the requested grant.
   */
  public readonly delegated?: boolean;

  /**
   * The scope of the allowed access.
   */
  public readonly scope: PermissionScope;

  /**
   * Optional conditions that must be met when the requested grant is used.
   */
  public readonly conditions?: PermissionConditions;

  constructor(message: DataEncodedRecordsWriteMessage) {
    // properties derived from the generic DWN message properties
    this.id = message.recordId;
    this.requester = Message.getSigner(message)!;

    // properties from the data payload itself.
    const permissionRequestEncodedData = message.encodedData;
    const permissionRequestData = Encoder.base64UrlToObject(permissionRequestEncodedData) as PermissionRequestData;
    this.delegated = permissionRequestData.delegated;
    this.description = permissionRequestData.description;
    this.scope = permissionRequestData.scope;
    this.conditions = permissionRequestData.conditions;
  }
}

