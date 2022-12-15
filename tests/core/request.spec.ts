import { expect } from 'chai';
import { Request } from '../../src/core/request.js';

describe('Request', () => {
  describe('parse', () => {
    it('throws an exception if messages is missing', () => {
      expect(() => {
        const req = { };
        Request.parse(req);
      }).throws('messages');
    });

    it('throws an exception if  messages is not an array', () => {
      const tests = [{}, 'messages', 1, true, null];

      for (const t of tests) {
        expect(() => {
          const req = { messages: t };
          Request.parse(req);
        }).to.throw('array');
      }
    });

    it('throws an exception if messages is an empty array', () => {
      expect(() => {
        const req = { messages: [] };
        Request.parse(req);
      }).throws('fewer than 1 items');
    });

    it('returns a Request object if valid', () => {
      const request = { messages: [{}] };
      const req = Request.parse(request);

      expect(req.messages.length).to.equal(1);
    });
  });
});