import Ajv from 'ajv';
import { schemas } from './json-schemas';

const validator = new Ajv();

for (const schemaName in schemas) {
  addSchema(schemaName, schemas[schemaName]);
}

export function addSchema(schemaName: string, schema): void {
  validator.addSchema(schema, schemaName);
}

/**
 * TODO: add JSDoc, Issue #71 https://github.com/TBD54566975/dwn-sdk-js/issues/71
 * @param schemaName
 * @param payload
 * @returns
 */
export function validate(schemaName: string, payload: any): void {
  const validateFn = validator.getSchema(schemaName);

  if (!validateFn) {
    throw new Error(`schema for ${schemaName} not found.`);
  }

  validateFn(payload);

  if (!validateFn.errors) {
    return;
  }

  // AJV is configured by default to stop validating after the 1st error is encountered which means
  // there will only ever be one error;
  const [ errorObj ] = validateFn.errors;
  let { instancePath, message } = errorObj;

  if (!instancePath) {
    instancePath = schemaName;
  }

  throw new Error(`${instancePath}: ${message}`);
}