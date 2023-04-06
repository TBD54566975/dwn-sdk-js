import chaiAsPromised from 'chai-as-promised';
import varint from 'varint';
import chai, { expect } from 'chai';

import { base58btc } from 'multiformats/bases/base58';
import { DidKeyResolver } from '../../src/did/did-key-resolver.js';

// extends chai to test promises
chai.use(chaiAsPromised);

describe('DidKeyResolver', () => {
  it('should resolve a ed25519 `did:key` DID correctly', async () => {
    // test vector taken from https://w3c-ccg.github.io/did-method-key/#ed25519-x25519
    const did = 'did:key:z6MkiTBz1ymuepAQ4HEHYSF1H8quG5GLVVQR3djdX3mDooWp';
    const resolver = new DidKeyResolver();

    const resolutionDocument = await resolver.resolve(did);
    const didDocument = resolutionDocument.didDocument!;
    expect(didDocument.id).to.equal(did);
    expect(didDocument['@context']?.indexOf('https://w3id.org/security/suites/ed25519-2020/v1')).to.not.equal(-1);

    const verificationMethod = resolutionDocument.didDocument?.verificationMethod![0]!;
    expect(verificationMethod.publicKeyJwk?.x).to.equal('O2onvM62pC1io6jQKm8Nc2UyFXcd4kOmOsBIoYtZ2ik');
  });

  it('should resolve a secp256k1 `did:key` DID correctly', async () => {
    // test vector taken from:
    // https://github.com/transmute-industries/did-key.js/blob/main/packages/did-key-test-vectors/src/secp256k1/did-key-secp256k1-case-0.json
    const did = 'did:key:zQ3shjRPgHQQbTtXyofk1ygghRJ75RZpXmWBMY1BKnhyz7zKp';
    const resolver = new DidKeyResolver();

    const resolutionDocument = await resolver.resolve(did);
    expect(resolutionDocument.didDocument?.id!).to.equal(did);
    expect(resolutionDocument['@context']?.indexOf('https://w3id.org/security/suites/ed25519-2020/v1')).to.equal(-1);

    const verificationMethod = resolutionDocument.didDocument?.verificationMethod![0]!;
    expect(verificationMethod.publicKeyJwk?.x).to.equal('RwiZITTa2Dcmq-V1j-5tgPUshOLO31FbsnhVS-7lskc');
    expect(verificationMethod.publicKeyJwk?.y).to.equal('3o1-UCc3ABh757P58gDISSc4hOj9qyfSGl3SGGA7xdc');
  });

  it('should resolve a `did:key` DID that the library generates', async () => {
    const { did, keyPair } = await DidKeyResolver.generate();
    const resolver = new DidKeyResolver();

    const resolutionDocument = await resolver.resolve(did);
    expect(resolutionDocument.didDocument?.id).to.equal(did);

    const verificationMethod = resolutionDocument.didDocument?.verificationMethod![0]!;
    expect(verificationMethod.publicKeyJwk?.x).to.equal(keyPair.publicJwk.x);
  });

  it('should throw if DID is using unsupported multicodec', async () => {
    const unsupportedMulticodec = varint.encode(0x01); // any unsupported multicodec
    const idBytes = new Uint8Array(unsupportedMulticodec.length); // just allocate for the multicodec for testing
    idBytes.set(unsupportedMulticodec, 0);
    const id = base58btc.encode(idBytes);

    const did = `did:key:${id}`;
    const didKeyResolver = new DidKeyResolver();

    const resolutionDocument = await didKeyResolver.resolve(did);
    expect(resolutionDocument.didDocument).to.equal(undefined);
    expect(resolutionDocument.didResolutionMetadata.error).to.equal('invalidDid');
  });

  it('should throw if key is invalid', async () => {
    const did = 'did:ion:SomethingThatCannotBeResolved';
    const didIonResolver = new DidKeyResolver();

    const resolutionDocument = await didIonResolver.resolve(did);
    expect(resolutionDocument.didDocument).to.equal(undefined);
    expect(resolutionDocument.didResolutionMetadata.error).to.equal('invalidDid');
  });
});
