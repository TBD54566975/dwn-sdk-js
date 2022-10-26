import type { AuthorizableMessage } from '../../core/types';

/**
 * Descriptor structure for HooksWrite
 */
export type HooksWriteDescriptor = {
  method: 'HooksWrite';
  target: string;
  dateCreated: number;

  /**
   * Leave as `undefined` for customer handler.
   * ie. DWN processing will use `undefined` check to attempt to invoke the registered handler.
   */
  uri?: string;

  /**
   * Intentionally all required properties for first iteration.
   */
  filter: {
    method: string;
  }
};

/**
 * Structure for HooksWrite message.
 */
export type HooksWriteMessage = AuthorizableMessage & {
  descriptor: HooksWriteDescriptor;
};