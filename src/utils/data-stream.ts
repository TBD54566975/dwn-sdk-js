import { Encoder } from './encoder.js';
import { Readable } from 'readable-stream';

/**
 * Utility class for readable data stream, intentionally named to disambiguate from ReadableStream, readable-stream, Readable etc.
 */
export class DataStream {
  /**
   * Reads the entire readable stream given into array of bytes.
   */
  public static async toBytes(readableStream: Readable): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const chunks = [];
      readableStream.on('data', chunk => {
        chunks.push(chunk);
      });

      readableStream.on('end', () => {
        const uint8Array = new Uint8Array(chunks);
        resolve(uint8Array);
      });

      readableStream.on('error', reject);
    });
  }

  /**
   * Creates a readable stream from the bytes given.
   */
  public static fromBytes(bytes: Uint8Array): Readable {
    const readableStream = new Readable({
      read(_size): void {
        this.push(bytes);
        this.push(null);
      }
    });

    return readableStream;
  }

  /**
   * Creates a readable stream from the bytes given.
   */
  public static fromObject(object: { [key: string]: any }): Readable {
    const bytes = Encoder.objectToBytes(object);
    return DataStream.fromBytes(bytes);
  }
}