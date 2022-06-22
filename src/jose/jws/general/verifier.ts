const verifiers: { [key:string]: VerifyFn } = {
  'Ed25519'   : ed25519.verify,
  'secp256k1' : secp256k1.verify
};