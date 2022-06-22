import type { Authorization, JsonMessage } from '../../../messages/types';
import type { Conditions, Scope } from '../types';

export type PermissionsRequestDescriptor = {
  description: string
  grantedTo: string
  grantedBy: string
  method: 'PermissionsRequest'
  scope: Scope
  conditions: Conditions
  objectId?: string
};

export interface JsonPermissionsRequest extends JsonMessage {
  descriptor: PermissionsRequestDescriptor;
}