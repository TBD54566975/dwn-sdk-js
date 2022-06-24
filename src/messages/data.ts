import { base64url } from 'multiformats/bases/base64';
import { CID } from 'multiformats/cid';
import { importer } from 'ipfs-unixfs-importer';

export class Data {
  data: string | number | boolean | Uint8Array | object;

  constructor(data: any) {
    if (!data) {
      throw new Error('data cannot be null');
    }

    this.data = data;
  }

  toBytes(): Uint8Array {
    const { encode } = new TextEncoder();

    if (this.data instanceof Uint8Array) {
      return this.data;
    } else if (this.data instanceof ArrayBuffer) {
      return new Uint8Array(this.data);
    } else if (typeof this.data === 'object') {
      const stringifiedData = JSON.stringify(this.data);
      return encode(stringifiedData);
    } else {
      return encode(this.data.toString());
    }
  }

  base64UrlEncode(): string {
    const dataBytes = this.toBytes();

    return base64url.baseEncode(dataBytes);
  }

  async getCid(): Promise<CID> {
    const dataBytes = this.toBytes();
    const chunk = importer([{ content: dataBytes }], null, { onlyHash: true, cidVersion: 1 });
    let root;

    for await (root of chunk);

    return root.cid;
  }
}