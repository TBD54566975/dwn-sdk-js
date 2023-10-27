import { DwnErrorCode } from '../../src/core/dwn-error.js';
import { expect } from 'chai';
import { TestDataGenerator } from '../utils/test-data-generator.js';
import { createOffsetTimestamp, createTimestamp, validateTimestamp } from '../../src/utils/time.js';


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

  describe('createTimestamp', () => {
    it('should create a valid timestamp', () => {
      const timestamp = createTimestamp({
        year        : 2022,
        month       : 4,
        day         : 29,
        hour        : 10,
        minute      : 30,
        second      : 0,
        millisecond : 123,
        microsecond : 456
      });
      expect(timestamp).to.equal('2022-04-29T10:30:00.123456Z');
    });

    for (let i = 0; i < 5; i++) {
      const year = TestDataGenerator.randomInt(1900, 2500);
      const month = TestDataGenerator.randomInt(1, 12);
      const day = TestDataGenerator.randomInt(1, 28);
      const hour = TestDataGenerator.randomInt(0, 23);
      const minute = TestDataGenerator.randomInt(0, 59);
      const second = TestDataGenerator.randomInt(0, 59);
      const millisecond = TestDataGenerator.randomInt(0, 999);
      const microsecond = TestDataGenerator.randomInt(0, 999);
      it(`should create a valid timestamp for random values ${i}`, () => {
        const timestamp = createTimestamp({ year, month, day, hour, minute, second, millisecond, microsecond });
        expect(()=> validateTimestamp(timestamp)).to.not.throw();
      });
    }
  });

  describe('createOffsetTimestamp', () => {
    it('should use the given timestamp as the base timestamp to compute the offset timestamp', () => {
      const baseTimestamp = '2000-04-29T10:30:00.123456Z';
      const offsetTimestamp = createOffsetTimestamp({ seconds: 60 * 60 * 24 * 365 }, baseTimestamp);

      expect(offsetTimestamp).to.equal('2001-04-29T10:30:00.123456Z');
    });
  });
});