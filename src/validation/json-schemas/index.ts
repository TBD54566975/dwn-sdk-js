import CollectionsQuery from './collections/collections-query.json' assert { type: 'json' };
import CollectionsWrite from './collections/collections-write.json' assert { type: 'json' };
import Definitions from './definitions.json' assert { type: 'json' };
import GeneralJws from './general-jws.json' assert { type: 'json' };
import PermissionsDefinitions from './permissions/definitions.json' assert { type: 'json' };
import PermissionsRequest from './permissions/permissions-request.json' assert { type: 'json' };
import PermissionsGrant from './permissions/permissions-grant.json' assert { type: 'json' };
import Request from './request.json' assert { type: 'json' };

export const schemas = {
  CollectionsQuery,
  CollectionsWrite,
  Definitions,
  GeneralJws,
  PermissionsDefinitions,
  PermissionsGrant,
  PermissionsRequest,
  Request
};