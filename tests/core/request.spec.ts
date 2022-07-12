import { expect } from 'chai';
import { Request } from '../../src/core';

describe('Request', () => {
  describe('parse', () => {
    it('throws an exception if raw request is not valid JSON', () => {
      expect(() => {
        Request.parse('dookie');
      }).to.throw('valid JSON');
    });

    it('throws an exception if raw request is not an object', () => {
      const rawRequests = [3, true, []];

      for (const r of rawRequests) {
        expect(() => {
          Request.parse(r);
        }).throws('object');
      }
    });

    it('throws an exception if target is missing', () => {
      expect(() => {
        Request.parse('{}');
      }).throws('target');
    });

    it('throws an exception if target is not a valid DID', () => {
      const tests = ['hi', 30, true, null, {}, [], 'did:jank'];

      for (const t of tests) {
        expect(() => {
          const req = { target: t, messages: [{}] };
          Request.parse(req);
        }).to.throw('target');
      }
    });

    it('throws an exception if messages is missing', () => {
      expect(() => {
        const req = { target: 'did:jank:123' };
        Request.parse(JSON.stringify(req));
      }).throws('messages');
    });

    it('throws an exception if  messages is not an array', () => {
      const tests = [{}, 'messages', 1, true, null];

      for (const t of tests) {
        expect(() => {
          const req = { target: 'did:jank:123', messages: t };
          Request.parse(req);
        }).to.throw('array');
      }
    });

    it('throws an exception if messages is an empty array', () => {
      expect(() => {
        const req = { target: 'did:jank:123', messages: [] };
        Request.parse(JSON.stringify(req));
      }).throws('fewer than 1 items');
    });

    it('returns a Request object if valid', () => {
      const rawRequest = { target: 'did:jank:123', messages: [{}] };
      const req = Request.parse(JSON.stringify(rawRequest));

      expect(req.target).to.equal('did:jank:123');
      expect(req.messages.length).to.equal(1);
    });
  });
});