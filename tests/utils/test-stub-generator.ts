import type { Persona } from './test-data-generator.js';
import type { DidResolutionResult, DidResolver } from '@web5/dids';

import sinon from 'sinon';

import { TestDataGenerator } from './test-data-generator.js';
import { UniversalResolver } from '@web5/dids';

/**
 * Utility class for generating stub for testing.
 */
export class TestStubGenerator {
  /**
   * Creates a {DidResolver} stub for testing.
   */
  public static createDidResolverStub(persona: Persona): DidResolver {

    // setting up a stub did resolver & message store
    const didResolutionResult = TestDataGenerator.createDidResolutionResult(persona);
    const resolveStub = sinon.stub<[string], Promise<DidResolutionResult>>();
    resolveStub.withArgs(persona.did).resolves(didResolutionResult);
    const didResolverStub = sinon.createStubInstance(UniversalResolver, { resolve: resolveStub });

    return didResolverStub;
  }

  /**
   * Stubs resolution results for the given personas.
   */
  public static stubDidResolver(didResolver: DidResolver, personas: Persona[]): void {
    const didToResolutionMap = new Map<string, DidResolutionResult>();

    for (const persona of personas) {
      const mockResolution = TestDataGenerator.createDidResolutionResult(persona);

      didToResolutionMap.set(persona.did, mockResolution);
    }

    sinon.stub(didResolver, 'resolve').callsFake((did) => {
      const mockResolution = didToResolutionMap.get(did);

      return new Promise((resolve, _reject) => {
        if (mockResolution === undefined) {
          throw new Error('unexpected DID');
        }

        resolve(mockResolution);
      });
    });
  }
}
