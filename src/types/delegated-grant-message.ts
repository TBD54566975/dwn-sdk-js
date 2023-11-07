import type { GeneralJws } from './jws-types.js';
import type { PermissionsGrantDescriptor } from './permissions-grant-descriptor.js';

export type DelegatedGrantMessage = {
  authorization: {
    /**
     * The signature of the message signer.
     */
    signature: GeneralJws;
  };

  descriptor: PermissionsGrantDescriptor & {
    delegated: true;
  };
};
