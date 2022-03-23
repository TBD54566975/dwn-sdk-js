/**
 * TODO: add docs
 */

import Ajv from 'ajv';
import permissionsRequestSchema
  from './interfaces/permissions/schemas/permissions-request.schema.json';

// TODO: include explanation for `allErrors` option
const validator = new Ajv({ allErrors: true });

validator.addSchema(permissionsRequestSchema, 'PermissionsRequest');

export default validator;