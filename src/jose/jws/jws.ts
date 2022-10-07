import type { BaseMessage } from '../../core/types';
import type { SignatureInput } from '../../jose/jws/general/types';

import { CID } from 'multiformats';
import { GeneralJws } from '../../jose/jws/general/types';
import { GeneralJwsSigner } from '../../jose/jws/general';
import { generateCid } from '../../utils/cid';

/**
 * Class containing JWS related operations.
 */
export class Jws {
  /**
   * signs the provided message. Signed payload includes the CID of the message's descriptor by default
   * along with any additional payload properties provided
   * @param message - the message to sign
   * @param signatureInput - the signature material to use (e.g. key and header data)
   * @param payloadProperties - additional properties to include in the signed payload
   * @returns General JWS signature
   */
  public static async sign(
    message: BaseMessage,
    signatureInput: SignatureInput,
    payloadProperties?: { [key: string]: CID }

  ): Promise<GeneralJws> {
    const descriptorCid = await generateCid(message.descriptor);

    const authPayload = { ...payloadProperties, descriptorCid: descriptorCid.toString() };
    const authPayloadStr = JSON.stringify(authPayload);
    const authPayloadBytes = new TextEncoder().encode(authPayloadStr);

    const signer = await GeneralJwsSigner.create(authPayloadBytes, [signatureInput]);

    return signer.getJws();
  }
}
