import { PermissionsRequest, processPermissionsRequest } from './request';

export const PermissionsInterface = {
  methods  : [ processPermissionsRequest ],
  messages : [ PermissionsRequest ]
};