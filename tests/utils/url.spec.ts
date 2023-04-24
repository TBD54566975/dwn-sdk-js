import chaiAsPromised from 'chai-as-promised';
import chai, { expect } from 'chai';

import { normalizeProtocolUri, validateProtocolUriNormalized } from '../../src/utils/url.js';

chai.use(chaiAsPromised);

describe('url', () => {
  describe('validateProtocolUriNormalized', () => {
    it('errors when URI is not normalized', () => {
      expect(() => validateProtocolUriNormalized('https://example.com')).to.not.throw();
      expect(() => validateProtocolUriNormalized('example.com')).to.throw();
      expect(() => validateProtocolUriNormalized(':foo:')).to.throw();
    });
  });

  describe('normalizeProtocolUri', () => {
    it('returns hostname and path with trailing slash removed', () => {
      expect(normalizeProtocolUri('example.com')).to.equal('http://example.com');
      expect(normalizeProtocolUri('example.com/')).to.equal('http://example.com');
      expect(normalizeProtocolUri('http://example.com')).to.equal('http://example.com');
      expect(normalizeProtocolUri('http://example.com/')).to.equal('http://example.com');
      expect(normalizeProtocolUri('example.com?foo=bar')).to.equal('http://example.com');
      expect(normalizeProtocolUri('example.com/?foo=bar')).to.equal('http://example.com');

      expect(normalizeProtocolUri('example.com/path')).to.equal('http://example.com/path');
      expect(normalizeProtocolUri('example.com/path/')).to.equal('http://example.com/path');
      expect(normalizeProtocolUri('http://example.com/path')).to.equal('http://example.com/path');
      expect(normalizeProtocolUri('http://example.com/path')).to.equal('http://example.com/path');
      expect(normalizeProtocolUri('example.com/path?foo=bar')).to.equal('http://example.com/path');
      expect(normalizeProtocolUri('example.com/path/?foo=bar')).to.equal('http://example.com/path');
      expect(normalizeProtocolUri('example.com/path#baz')).to.equal('http://example.com/path');
      expect(normalizeProtocolUri('example.com/path/#baz')).to.equal('http://example.com/path');

      expect(normalizeProtocolUri('example')).to.equal('http://example');
      expect(normalizeProtocolUri('/example/')).to.equal('http://example');

      expect(() => normalizeProtocolUri('://http')).to.throw(Error);
      expect(() => normalizeProtocolUri(':foo:')).to.throw(Error);
    });
  });
});