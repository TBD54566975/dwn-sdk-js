import type { InterfaceMethod } from '../types';

import { PermissionsRequest, processPermissionsRequest } from './request';

export const methods: InterfaceMethod[] = [ processPermissionsRequest ];
export const messages = [ PermissionsRequest ];