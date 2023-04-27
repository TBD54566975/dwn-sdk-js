import Ajv from 'ajv';
import definitions from '../../../json-schemas/definitions.json' assert { type: 'json' };

import { expect } from 'chai';

describe('date-time schema', async () => {

  const ajv = new Ajv.default();
  const validateDateTime = ajv.compile(definitions.definitions['date-time']);

  it('should accept ISO 8601 date-time strings accepted by DWN', () => {
    expect(validateDateTime('2022-04-29T10:30:00.123456Z')).to.be.true;
  });

  it('should reject ISO 8601 date-time strings not accepted by DWN', () => {
    const unacceptableDateTimeStrings = [
      '2023-04-27T13:30:00.123456',
      '2023-04-27T13:30:00.123456z',
      '2023-04-27T13:30:00.1234Z',
      '2023-04-27T13:30:00Z',
      '2023-04-27T13:30:00.000000+00:00',
      '2023-04-27 13:30:00.000000Z'
    ];

    for (const dateTime of unacceptableDateTimeStrings) {
      expect(validateDateTime(dateTime)).to.be.false;
    }
  });
});
