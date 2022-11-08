import { PermissionsRequest } from './messages/permissions-request';
import { handlePermissionsRequest } from './handlers/permissions-request';

export const PermissionsInterface = {
  methodHandlers : { DwnMethodName.PermissionsRequest: handlePermissionsRequest },
  messages       : [ PermissionsRequest ]
};