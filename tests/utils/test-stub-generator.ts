import { DidResolutionResult, DidResolver } from '../../src/did/did-resolver';
import { Persona, TestDataGenerator } from './test-data-generator';
import sinon from 'sinon';

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
    const didResolverStub = sinon.createStubInstance(DidResolver, { resolve: resolveStub });

    return didResolverStub;
  }
}
