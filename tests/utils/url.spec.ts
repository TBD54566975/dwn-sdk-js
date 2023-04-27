import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

import { normalizeProtocolUrl, validateProtocolUrlNormalized } from '../../src/utils/url.js';

chai.use(chaiAsPromised);

describe('url', () => {
  describe('validateProtocolUrlNormalized', () => {
    it('errors when URI is not normalized', () => {
      expect(() => validateProtocolUrlNormalized('https://example.com')).to.not.throw();
      expect(() => validateProtocolUrlNormalized('example.com')).to.throw();
      expect(() => validateProtocolUrlNormalized(':foo:')).to.throw();
    });
  });

  describe('normalizeProtocolUrl', () => {
    it('returns hostname and path with trailing slash removed', () => {
      expect(normalizeProtocolUrl('example.com')).to.equal('http://example.com');
      expect(normalizeProtocolUrl('example.com/')).to.equal('http://example.com');
      expect(normalizeProtocolUrl('http://example.com')).to.equal('http://example.com');
      expect(normalizeProtocolUrl('http://example.com/')).to.equal('http://example.com');
      expect(normalizeProtocolUrl('example.com?foo=bar')).to.equal('http://example.com');
      expect(normalizeProtocolUrl('example.com/?foo=bar')).to.equal('http://example.com');

      expect(normalizeProtocolUrl('example.com/path')).to.equal('http://example.com/path');
      expect(normalizeProtocolUrl('example.com/path/')).to.equal('http://example.com/path');
      expect(normalizeProtocolUrl('http://example.com/path')).to.equal('http://example.com/path');
      expect(normalizeProtocolUrl('http://example.com/path')).to.equal('http://example.com/path');
      expect(normalizeProtocolUrl('example.com/path?foo=bar')).to.equal('http://example.com/path');
      expect(normalizeProtocolUrl('example.com/path/?foo=bar')).to.equal('http://example.com/path');
      expect(normalizeProtocolUrl('example.com/path#baz')).to.equal('http://example.com/path');
      expect(normalizeProtocolUrl('example.com/path/#baz')).to.equal('http://example.com/path');

      expect(normalizeProtocolUrl('example')).to.equal('http://example');
      expect(normalizeProtocolUrl('/example/')).to.equal('http://example');

      expect(() => normalizeProtocolUrl('://http')).to.throw(Error);
      expect(() => normalizeProtocolUrl(':foo:')).to.throw(Error);
    });
  });
});