import { PermissionsRequest, processPermissionsRequest } from './request';

export const PermissionsInterface = {
  methods  : { 'PermissionsRequest': processPermissionsRequest },
  messages : [ PermissionsRequest ]
};