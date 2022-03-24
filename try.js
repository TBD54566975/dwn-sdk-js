import * as jose from 'jose';
import * as cbor from '@ipld/dag-cbor';

import { base64url } from 'multiformats/bases/base64';
import { CID } from 'multiformats/cid';
import { sha256, sha512 } from 'multiformats/hashes/sha2';

const cborBytes = cbor.encode({farts: 'smell'});

const cborHash256 = await sha256.digest(cborBytes);
const cid256 = await CID.createV1(cbor.code, cborHash);

const cborHash512 = await sha512.digest(cborBytes);
const cid512 = await CID.createV1(cbor.code, cbor512Hash);

console.log(cid256.equals(cid512)); // false

// const jwsPayload = Buffer.from(cid.bytes).toString('base64url');

// console.log('MINE', jwsPayload);

// const kp = await jose.generateKeyPair('EdDSA');
// console.log(kp.privateKey);

// const jws = await new jose.FlattenedSign(cid.bytes)
//   .setProtectedHeader({ alg: 'EdDSA' })
//   .sign(kp.privateKey);

// console.log(jws);
