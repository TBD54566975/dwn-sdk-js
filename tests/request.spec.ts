import { expect } from 'chai';
import { Request } from '../src/request';

describe('Request', () => {
  describe('unmarshal', () => {
    it('throws an exception if raw request is not valid JSON', () => {
      expect(() => {
        Request.unmarshal('dookie');
      }).to.throw('valid JSON');
    });

    it('throws an exception if raw request is not an object', () => {
      const rawRequests = [3, true, []];

      for (let r of rawRequests) {
        expect(() => {
          Request.unmarshal(r);
        }).throws('object');
      }
    });

    it('throws an exception if target is missing', () => {
      expect(() => {
        Request.unmarshal('{}');
      }).throws('target');
    });

    it('throws an exception if messages is missing', () => {
      expect(() => {
        const req = { target: 'did:jank:123' };
        Request.unmarshal(JSON.stringify(req));
      }).throws('messages');
    });

    it('throws an exception if  messages is not an array', () => {
      const tests = [{}, 'messages', 1, true, null];

      for (let t of tests) {
        expect(() => {
          const req = { target: 'did:jank:123', messages: t };
          Request.unmarshal(req);
        }).to.throw('array');
      }
    });

    it('throws an exception if messages is an empty array', () => {
      expect(() => {
        const req = { target: 'did:jank:123', messages: [] };
        Request.unmarshal(JSON.stringify(req));
      }).throws('fewer than 1 items');
    });

    it('returns a Request object if valid', () => {
      const rawRequest = { target: 'did:jank:123', messages: [{}] };
      const req = Request.unmarshal(JSON.stringify(rawRequest));

      expect(req instanceof Request).to.be.true;
    });
  });
});