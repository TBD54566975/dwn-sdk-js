import { PermissionsRequest, processPermissionsRequest } from './request';

export const PermissionsInterface = {
  methodHandlers : { 'PermissionsRequest': processPermissionsRequest },
  messages       : [ PermissionsRequest ]
};