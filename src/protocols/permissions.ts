import type { ProtocolDefinition } from '../types/protocols-types.js';
import type { PermissionConditions, PermissionGrantModel, PermissionRequestModel, PermissionRevocationModel, PermissionScope, RecordsPermissionScope } from '../types/permissions-grant-descriptor.js';

import { Encoder } from '../utils/encoder.js';
import { Time } from '../utils/time.js';
import { normalizeProtocolUrl, normalizeSchemaUrl } from '../utils/url.js';

/**
 * Options for creating a permission request.
 */
export type PermissionRequestCreateOptions = {
  dateRequested?: string;
  description?: string;
  grantedBy: string;
  grantedTo: string;
  delegated?: boolean;
  scope: PermissionScope;
  conditions?: PermissionConditions;
};

/**
 * Options for creating a permission grant.
 */
export type PermissionGrantCreateOptions = {
  description?: string;
  dateGranted?: string;

  /**
   * Expire time in UTC ISO-8601 format with microsecond precision.
   */
  dateExpires: string;

  grantedBy: string;
  grantedTo: string;
  delegated?: boolean;
  permissionRequestId?: string;
  scope: PermissionScope;
  conditions?: PermissionConditions;
};

/**
 * Options for creating a permission revocation.
 */
export type PermissionRevocationCreateOptions = {
  dateRevoked?: string;
  permissionGrantId: string;
};

/**
 * This is a first-class DWN protocol for managing permission grants of a given DWN.
 */
export class PermissionsProtocol {
  /**
   * The URI of the DWN Permissions protocol.
   */
  public static readonly uri = 'https://tbd.website/dwn/permissions';

  /**
   * The protocol path of the `request` record.
   */
  public static readonly requestPath = 'request';

  /**
   * The protocol path of the `grant` record.
   */
  public static readonly grantPath = 'grant';

  /**
   * The protocol path of the `revocation` record.
   */
  public static readonly revocationPath = 'grant/revocation';

  /**
   * The definition of the Permissions protocol.
   */
  public static readonly definition: ProtocolDefinition = {
    published : true,
    protocol  : PermissionsProtocol.uri,
    types     : {
      request: {
        dataFormats: ['application/json']
      },
      grant: {
        dataFormats: ['application/json']
      },
      revocation: {
        dataFormats: ['application/json']
      }
    },
    structure: {
      request: {
        $size: {
          max: 10000
        },
        $actions: [
          {
            who : 'anyone',
            can : ['create']
          }
        ]
      },
      grant: {
        $size: {
          max: 10000
        },
        $actions: [
          {
            who : 'recipient',
            of  : 'grant',
            can : ['read', 'query']
          }
        ],
        revocation: {
          $size: {
            max: 10000
          },
          $actions: [
            {
              who : 'anyone',
              can : ['read']
            }
          ]
        }
      }
    }
  };

  public static parseRequest(base64UrlEncodedRequest: string): PermissionRequestModel {
    return Encoder.base64UrlToObject(base64UrlEncodedRequest);
  }

  public static createRequest(options: PermissionRequestCreateOptions): PermissionRequestModel {
    const permissionRequestModel: PermissionRequestModel = {
      dateRequested : options.dateRequested ?? Time.getCurrentTimestamp(),
      description   : options.description,
      grantedBy     : options.grantedBy,
      grantedTo     : options.grantedTo,
      delegated     : options.delegated ?? false,
      scope         : options.scope,
      conditions    : options.conditions,
    };

    return permissionRequestModel;
  }

  /**
   * Create a permission grant.
   */
  public static createGrant(options: PermissionGrantCreateOptions): PermissionGrantModel {

    const scope = { ...options.scope } as RecordsPermissionScope;
    scope.protocol = scope.protocol !== undefined ? normalizeProtocolUrl(scope.protocol) : undefined;
    scope.schema = scope.schema !== undefined ? normalizeSchemaUrl(scope.schema) : undefined;

    const permissionGrantModel: PermissionGrantModel = {
      dateGranted         : options.dateGranted ?? Time.getCurrentTimestamp(),
      dateExpires         : options.dateExpires,
      description         : options.description,
      grantedBy           : options.grantedBy,
      grantedTo           : options.grantedTo,
      delegated           : options.delegated,
      permissionRequestId : options.permissionRequestId,
      scope               : scope,
      conditions          : options.conditions,
    };

    return permissionGrantModel;
  }

  /**
   * Create a permission revocation.
   */
  public static createRevocation(options: PermissionRevocationCreateOptions): PermissionRevocationModel {

    const permissionRevocationModel: PermissionRevocationModel = {
      dateRevoked       : options.dateRevoked ?? Time.getCurrentTimestamp(),
      permissionGrantId : options.permissionGrantId,
    };

    return permissionRevocationModel;
  }
};