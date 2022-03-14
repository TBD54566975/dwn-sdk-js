import type { DIDResolutionResult } from './types';

export interface DIDResolver {
  resolve(DID: string): Promise<DIDResolutionResult>;
}