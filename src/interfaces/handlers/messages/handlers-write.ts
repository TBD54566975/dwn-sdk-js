import type { AuthCreateOptions } from '../../../core/types';
import type { HandlersWriteSchema } from '../../handlers/types';

/**
 * Input to `HandlersWrite.create()`.
 */
export type HandlersWriteOptions = AuthCreateOptions & {
  target: string,
  /**
   * leave as `undefined` for customer handler.
   * ie. DWN processing will use `undefined` check to attempt to invoke the registered handler.
   */
  uri?: string,
  filter: {
    method: string,
    protocol: string,
    schema: string
  }
};

/**
 * Class that provides `HandlersWrite` related operations.
 */
export class HandlersWrite {
  /**
   * Creates a HandlersWrite message
   */
  static async create(_options: HandlersWriteOptions): Promise<HandlersWriteSchema> {
    throw new Error('not implemented');
  }
}
