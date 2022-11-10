import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import Ajv from 'ajv';
import standaloneCode from 'ajv/dist/standalone';

import CollectionsQuery from '../json-schemas/collections/collections-query.json' assert { type: 'json' };
import CollectionsWrite from '../json-schemas/collections/collections-write.json' assert { type: 'json' };
import Definitions from '../json-schemas/definitions.json' assert { type: 'json' };
import GeneralJwk from '../json-schemas/jwk/general-jwk.json' assert { type: 'json' };
import GeneralJws from '../json-schemas/general-jws.json' assert { type: 'json' };
import HooksWrite from '../json-schemas/hooks/hooks-write.json' assert { type: 'json' };
import JwkVerificationMethod from '../json-schemas/jwk-verification-method.json' assert {type: 'json'};
import PermissionsDefinitions from '../json-schemas/permissions/definitions.json' assert { type: 'json' };
import PermissionsRequest from '../json-schemas/permissions/permissions-request.json' assert { type: 'json' };
import PermissionsGrant from '../json-schemas/permissions/permissions-grant.json' assert { type: 'json' };
import ProtocolDefinition from '../json-schemas/protocol-definition.json' assert { type: 'json' };
import ProtocolRuleSet from '../json-schemas/protocol-rule-set.json' assert { type: 'json' };
import ProtocolsConfigure from '../json-schemas/protocols/protocols-configure.json' assert { type: 'json' };
import ProtocolsQuery from '../json-schemas/protocols/protocols-query.json' assert { type: 'json' };
import PublicJwk from '../json-schemas/jwk/public-jwk.json' assert { type: 'json' };
import Request from '../json-schemas/request.json' assert { type: 'json' };

const schemas = {
  CollectionsQuery,
  CollectionsWrite,
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
  PublicJwk,
  Request
};

const ajv = new Ajv({ code: { source: true, esm: true } });

for (const schemaName in schemas) {
  ajv.addSchema(schemas[schemaName], schemaName);
}

const moduleCode = standaloneCode(ajv);

const __dirname = url.fileURLToPath(new URL('.', import.meta.url));

fs.writeFileSync(path.join(__dirname, '../generated/precompiled-validators.js'), moduleCode);