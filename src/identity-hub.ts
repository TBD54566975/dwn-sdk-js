import type { DIDResolver } from './did/did-resolver';

export class IdentityHub {
  constructor(config: Config) {}
};

export type Config = {
  DIDResolvers: DIDResolver[],
};