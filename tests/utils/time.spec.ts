import { DwnErrorCode } from '../../src/core/dwn-error.js';
import { expect } from 'chai';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { validateTimestamp } from '../../src/utils/time.js';


describe('time', () => {
  describe('validateTimstamp', () => {
    describe('invalid timestamps', () => {
      const invalidTimstamps = [
        '2022-02-31T10:20:30.405060Z', // invalid day
        '2022-01-36T90:20:30.405060Z', // invalid hour
        '2022-01-36T25:99:30.405060Z', // invalid minute
        '2022-14-18T10:30:00.123456Z', // invalid month
      ];
      invalidTimstamps.forEach((timestamp) => {
        it(`should throw an exception if an invalid timestamp is passed: ${timestamp}`, () => {
          expect(() => validateTimestamp(timestamp)).to.throw(DwnErrorCode.TimestampInvalid);
        });
      });
    });
    describe('valid timestamps', () => {
      it('should pass if a valid timestamp is passed', () => {
        expect(() => validateTimestamp('2022-04-29T10:30:00.123456Z')).to.not.throw();
        expect(() => validateTimestamp(TestDataGenerator.randomTimestamp())).to.not.throw();
      });
    });
  });
});