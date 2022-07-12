import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { MemoryCache } from '../../src/utils/cache';

// extends chai to test promises
chai.use(chaiAsPromised);

describe('MemoryCache', () => {
  it('should return `undefined` when key-value pair expires',  async () => {
    const memoryCache = new MemoryCache(0.01); // 0.01 second = 10 millisecond time-to-live

    await memoryCache.set('key', 'aValue');
    let valueInCache = await memoryCache.get('key');
    expect(valueInCache).to.equal('aValue');

    await new Promise(resolve => setTimeout(resolve, 10)); // wait for 10 millisecond to key-value to expire
    valueInCache = await memoryCache.get('key');
    expect(valueInCache).to.be.undefined;
  });
});
