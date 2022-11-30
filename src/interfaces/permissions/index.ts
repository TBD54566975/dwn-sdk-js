import { handlePermissionsRequest } from './handlers/permissions-request';
import { PermissionsRequest } from './messages/permissions-request';

export const PermissionsInterface = {
  methodHandlers : { 'PermissionsRequest': handlePermissionsRequest },
  messages       : [ PermissionsRequest ]
};