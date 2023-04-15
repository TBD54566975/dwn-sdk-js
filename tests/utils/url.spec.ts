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
    });
  });
});
