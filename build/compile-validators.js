/**
 * Pre-compiles Ajv validators from json schemas
 * Ajv supports generating standalone validation functions from JSON Schemas at compile/build time.
 * These functions can then be used during runtime to do validation without initializing Ajv.
 * It is useful for several reasons:
 * - to avoid dynamic code evaluation with Function constructor (used for schema compilation) -
 *   when it is prohibited by the browser page [Content Security Policy](https://ajv.js.org/security.html#content-security-policy).
 * - to reduce the browser bundle size - Ajv is not included in the bundle
 * - to reduce the start-up time - the validation and compilation of schemas will happen during build time.
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import Ajv from 'ajv';
import mkdirp from 'mkdirp';
import standaloneCode from 'ajv/dist/standalone/index.js';

import Definitions from '../json-schemas/definitions.json' assert { type: 'json' };
import GeneralJwk from '../json-schemas/jwk/general-jwk.json' assert { type: 'json' };
import GeneralJws from '../json-schemas/general-jws.json' assert { type: 'json' };
import HooksWrite from '../json-schemas/hooks/hooks-write.json' assert { type: 'json' };
import JwkVerificationMethod from '../json-schemas/jwk-verification-method.json' assert {type: 'json'};
import PermissionsDefinitions from '../json-schemas/permissions/definitions.json' assert { type: 'json' };
import PermissionsGrant from '../json-schemas/permissions/permissions-grant.json' assert { type: 'json' };
import PermissionsRequest from '../json-schemas/permissions/permissions-request.json' assert { type: 'json' };
import ProtocolDefinition from '../json-schemas/protocol-definition.json' assert { type: 'json' };
import ProtocolRuleSet from '../json-schemas/protocol-rule-set.json' assert { type: 'json' };
import ProtocolsConfigure from '../json-schemas/protocols/protocols-configure.json' assert { type: 'json' };
import ProtocolsQuery from '../json-schemas/protocols/protocols-query.json' assert { type: 'json' };
import PublicJwk from '../json-schemas/jwk/public-jwk.json' assert { type: 'json' };
import RecordsDelete from '../json-schemas/records/records-delete.json' assert { type: 'json' };
import RecordsQuery from '../json-schemas/records/records-query.json' assert { type: 'json' };
import RecordsRead from '../json-schemas/records/records-read.json' assert { type: 'json' };
import RecordsWrite from '../json-schemas/records/records-write.json' assert { type: 'json' };

const schemas = {
  RecordsDelete,
  RecordsQuery,
  RecordsWrite,
  Definitions,
  GeneralJwk,
  GeneralJws,
  HooksWrite,
  JwkVerificationMethod,
  PermissionsDefinitions,
  PermissionsGrant,
  PermissionsRequest,
  ProtocolDefinition,
  ProtocolRuleSet,
  ProtocolsConfigure,
  ProtocolsQuery,
  RecordsRead,
  PublicJwk
};

const ajv = new Ajv({ code: { source: true, esm: true } });

for (const schemaName in schemas) {
  ajv.addSchema(schemas[schemaName], schemaName);
}

const moduleCode = standaloneCode(ajv);

const __dirname = url.fileURLToPath(new URL('.', import.meta.url));

await mkdirp(path.join(__dirname, '../generated'));
fs.writeFileSync(path.join(__dirname, '../generated/precompiled-validators.js'), moduleCode);