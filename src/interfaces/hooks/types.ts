import type { BaseMessage } from '../../core/types.js';
import { DwnMethodName } from '../../core/message.js';

/**
 * Descriptor structure for HooksWrite
 */
export type HooksWriteDescriptor = {
  method: DwnMethodName.HooksWrite;
  dateCreated: string;

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
export type HooksWriteMessage = BaseMessage & {
  descriptor: HooksWriteDescriptor;
};