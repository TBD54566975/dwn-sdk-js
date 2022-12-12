import { handlePermissionsRequest } from './handlers/permissions-request.js';
import { PermissionsRequest } from './messages/permissions-request.js';

export const PermissionsInterface = {
  methodHandlers : { 'PermissionsRequest': handlePermissionsRequest },
  messages       : [ PermissionsRequest ]
};