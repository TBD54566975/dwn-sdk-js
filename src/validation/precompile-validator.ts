import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import Ajv from 'ajv';
import { schemas } from './json-schemas';
import standaloneCode from 'ajv/dist/standalone';

const ajv = new Ajv({ code: { source: true, esm: true } });

for (const schemaName in schemas) {
  ajv.addSchema(schemas[schemaName], schemaName);
}

const moduleCode = standaloneCode(ajv);

console.log(moduleCode);

const __dirname = url.fileURLToPath(new URL('.', import.meta.url));

fs.writeFileSync(path.join(__dirname, '../../src/validation/precompiled-validator.js'), moduleCode);