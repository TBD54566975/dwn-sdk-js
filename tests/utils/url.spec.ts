import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

import { normalizeProtocolUrl } from '../../src/utils/url.js';

chai.use(chaiAsPromised);

describe('url', () => {
  describe('normalizeProtocolUrl', () => {
    it('returns hostname and path with trailing slash removed', () => {
      expect(normalizeProtocolUrl('example.com')).to.equal('example.com');
      expect(normalizeProtocolUrl('example.com/')).to.equal('example.com');
      expect(normalizeProtocolUrl('https://example.com')).to.equal('example.com');
      expect(normalizeProtocolUrl('https://example.com/')).to.equal('example.com');
      expect(normalizeProtocolUrl('example.com?foo=bar')).to.equal('example.com');
      expect(normalizeProtocolUrl('example.com/?foo=bar')).to.equal('example.com');

      expect(normalizeProtocolUrl('example.com/path')).to.equal('example.com/path');
      expect(normalizeProtocolUrl('example.com/path/')).to.equal('example.com/path');
      expect(normalizeProtocolUrl('https://example.com/path')).to.equal('example.com/path');
      expect(normalizeProtocolUrl('https://example.com/path')).to.equal('example.com/path');
      expect(normalizeProtocolUrl('example.com/path?foo=bar')).to.equal('example.com/path');
      expect(normalizeProtocolUrl('example.com/path/?foo=bar')).to.equal('example.com/path');

      expect(normalizeProtocolUrl('example')).to.equal('example');
      expect(normalizeProtocolUrl('/example/')).to.equal('example');

      // weird edge cases. if we see these in the wild, someone is misusing DWNs
      expect(normalizeProtocolUrl('://')).to.equal('://');
      expect(normalizeProtocolUrl('http://')).to.equal('http/');
      expect(normalizeProtocolUrl('foo://')).to.equal('foo/');
      expect(normalizeProtocolUrl('foo://bar')).to.equal('bar');
      expect(normalizeProtocolUrl('://foo')).to.equal('://foo');
    });
  });
});
