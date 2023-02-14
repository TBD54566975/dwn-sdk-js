import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

import { TestDataGenerator } from './test-data-generator.js';
import { DataStream, Encoder } from '../../src/index.js';

// extends chai to test promises
chai.use(chaiAsPromised);

describe('DataStream', () => {
  it('should be able to convert an object to a readable stream using `fromObject() and read back the bytes using `toBytes`', async () => {
    const originalObject = {
      a: TestDataGenerator.randomString(32)
    };

    const stream = DataStream.fromObject(originalObject);
    const readBytes = await DataStream.toBytes(stream);
    const readObject = JSON.parse(Encoder.bytesToString(readBytes));
    expect(readObject.a).to.equal(originalObject.a);
  });
});
