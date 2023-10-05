import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

import { MemoryCache } from '../../src/utils/memory-cache.js';
import sinon from 'sinon';

// extends chai to test promises
chai.use(chaiAsPromised);

describe('MemoryCache', () => {
  it('should return `undefined` when value expires', async () => {
    const memoryCache = new MemoryCache(0.01); // 0.01 second = 10 millisecond time-to-live

    await memoryCache.set('key', 'aValue');
    let valueInCache = await memoryCache.get('key');
    expect(valueInCache).to.equal('aValue');

    await new Promise(resolve => setTimeout(resolve, 20)); // wait for 10 millisecond for value to expire
    valueInCache = await memoryCache.get('key');
    expect(valueInCache).to.be.undefined;
  });

  it('should continue if set() fails', async () => {
    const timeToLiveInSeconds = 1;
    const memoryCache = new MemoryCache(timeToLiveInSeconds);

    const setStub = sinon.stub(memoryCache['cache'], 'set');
    setStub.throws('a simulated error');

    await memoryCache.set('key', 'aValue');
    expect(setStub.called).to.be.true;
  });
});
