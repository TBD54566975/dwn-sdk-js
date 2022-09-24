import type { Authorization } from '../../core/types';

/**
 * Descriptor structure for HandlersWrite
 */
export type HandlersWriteDescriptor = {
  method: 'HandlersWrite';
  target: string;

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
 * Structure for HandlersWrite message.
 */
export type HandlersWriteSchema = Authorization & {
  descriptor: HandlersWriteDescriptor;
};