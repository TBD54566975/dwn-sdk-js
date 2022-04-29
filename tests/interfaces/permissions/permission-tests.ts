import MockDate from 'mockdate';

import { expect } from 'chai';

import { Permission } from '../../../src/interfaces/permissions/permission';

describe('Permission Tests', () => {
  beforeEach(() => {
    MockDate.reset();
  });

  describe('constructor', () => {
    xit('throws an exception if expiration is in the past', () => {});
    xit('throws an exception if expiration is before nbf', () => {});
  });

  describe('toUnixEpochSeconds', () => {
    it('adds duration to the current time and returns that as a unix epoch timestamp', () => {
      const date = new Date('2022-03-22T00:00:00.000Z');

      const epochSeconds = Permission.toUnixEpochSeconds(date);
      const expectedValue = date.getTime();

      expect(epochSeconds * 1000).to.equal(expectedValue);
    });

    xit('converts a date to a unix epoch timestamp', () => {
      const date = new Date('2022-03-22T00:00:00.000Z');
      MockDate.set(date);
    });
  });
});