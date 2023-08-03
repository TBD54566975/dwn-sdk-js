<!-- @format -->

# Decentralized Web Node (DWN) SDK <!-- omit in toc -->

Code Coverage
![Statements](https://img.shields.io/badge/statements-97.54%25-brightgreen.svg?style=flat) ![Branches](https://img.shields.io/badge/branches-94.51%25-brightgreen.svg?style=flat) ![Functions](https://img.shields.io/badge/functions-93.8%25-brightgreen.svg?style=flat) ![Lines](https://img.shields.io/badge/lines-97.54%25-brightgreen.svg?style=flat)


- [Introduction](#introduction)
- [Installation](#installation)
- [Additional Steps](#additional-steps)
  - [Node.js \<= 18](#nodejs--18)
  - [React Native](#react-native)
  - [Usage in Browser:](#usage-in-browser)
    - [Vanilla HTML / JS](#vanilla-html--js)
    - [Webpack \>= 5](#webpack--5)
    - [Vite](#vite)
    - [esbuild](#esbuild)
- [Usage](#usage)
- [Release/Build Process](#releasebuild-process)
  - [Stable Build](#stable-build)
  - [Unstable Build](#unstable-build)
- [Some projects that use this library:](#some-projects-that-use-this-library)
- [Architecture](#architecture)
- [Project Resources](#project-resources)


## Introduction

This repository contains a reference implementation of Decentralized Web Node (DWN) as per the [specification](https://identity.foundation/decentralized-web-node/spec/). This specification is in a draft state and very much so a WIP. For the foreseeable future, a lot of the work on DWN will be split across this repo and the repo that houses the specification, which you can find [here](https://github.com/decentralized-identity/decentralized-web-node). The current implementation does not include all interfaces described in the DWN spec, but is enough to begin building test applications.

This project is used as a dependency by several other projects.

Proposals and issues for the specification itself should be submitted as pull requests to the [spec repo](https://github.com/decentralized-identity/decentralized-web-node).

## Installation

If you are interested in using DWNs and web5 in your web app, you probably want to look at web5-js, instead of this repository. Head on over here: https://github.com/TBD54566975/web5-js.

For advanced users wishing to use this repo directly:

```bash
npm install @tbd54566975/dwn-sdk-js
```

## Additional Steps

This package has dependency on [`@noble/ed25519`](https://github.com/paulmillr/noble-ed25519#usage) and [`@noble/secp256k1`](https://github.com/paulmillr/noble-secp256k1#usage) v2, additional steps are needed for some environments:

### Node.js <= 18

```js
// node.js 18 and earlier,  needs globalThis.crypto polyfill
import { webcrypto } from "node:crypto";
// @ts-ignore
if (!globalThis.crypto) globalThis.crypto = webcrypto;
```

### React Native
Usage of DWN SDK in react native requires a bit of set up at the moment. To simplify, we've published an npm package that can be used to set everything up which you can find [here](https://www.npmjs.com/package/@tbd54566975/web5-react-native-polyfills). Follow the instructions there to get everything set up.

### Usage in Browser:

`dwn-sdk-js` requires 2 polyfills: `crypto` and `stream`. we recommend using `crypto-browserify` and `stream-browserify`. Both of these polyfills can be installed using npm. e.g. `npm install --save crypto-browserify stream-browserify`

#### Vanilla HTML / JS

DWN SDK includes a polyfilled distribution that can imported in a `module` script tag. e.g.

```html
<!DOCTYPE html>
<html lang="en">
<body>
  <script type="module">
    import { Dwn, DataStream, DidKeyResolver, Jws, RecordsWrite } from 'https://cdn.jsdelivr.net/npm/@tbd54566975/dwn-sdk-js@0.1.1/dist/bundles/dwn.js'
    import { MessageStoreLevel, DataStoreLevel, EventLogLevel } from 'https://cdn.jsdelivr.net/npm/@tbd54566975/dwn-sdk-js@0.1.1/dist/bundles/level-stores.js'

    const messageStore = new MessageStoreLevel();
    const dataStore = new DataStoreLevel();
    const eventLog = new EventLogLevel();
    const dwn = await Dwn.create({ messageStore, dataStore, eventLog });

    // generate a did:key DID
    const didKey = await DidKeyResolver.generate();

    // create some data
    const encoder = new TextEncoder();
    const data = encoder.encode('Hello, World!');

    // create a RecordsWrite message
    const recordsWrite = await RecordsWrite.create({
      data,
      dataFormat: 'application/json',
      published: true,
      schema: 'yeeter/post',
      authorizationSignatureInput: Jws.createSignatureInput(didKey)
    });

    // get the DWN to process the RecordsWrite
    const dataStream = DataStream.fromBytes(data);
    const result = await dwn.processMessage(didKey.did, recordsWrite.message, dataStream);

    console.log(result.status);
    console.assert(result.status.code === 202)

    await dwn.close()

  </script>
</body>

</html>
```

#### Webpack >= 5

add the following to the top level of your webpack config (`webpack.config.js`)

```js
resolve: {
  fallback: {
    stream: require.resolve("stream-browserify"),
    crypto: require.resolve("crypto-browserify")
  }
}
```

#### Vite
add the following to the top level of your vite config (`vite.config.js`)

```js
define: {
  global: 'globalThis'
},
resolve: {
  alias: {
    'crypto': 'crypto-browserify',
    'stream': 'stream-browserify'
  }
}
```

#### esbuild
we recommend using `node-stdlib-browser` instead of `crypto-browserify` and `stream-browserify` individually. Example usage:

```js
import esbuild from 'esbuild'
import stdLibBrowser from 'node-stdlib-browser'
import polyfillProviderPlugin from 'node-stdlib-browser/helpers/esbuild/plugin'

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

esbuild.build({
  entryPoints: ['dwn-sdk-test.js'],
  platform: 'browser',
  bundle: true,
  format: 'esm',
  outfile: 'dist/dwn-sdk-test.js',
  inject      : [require.resolve('node-stdlib-browser/helpers/esbuild/shim')],
  plugins     : [polyfillProviderPlugin(stdLibBrowser)],
  define      : {
    'global': 'globalThis'
  }
})
```

## Usage

[API docs](https://tbd54566975.github.io/dwn-sdk-js/)

```ts

import { Dwn, DataStream, DidKeyResolver, Jws, RecordsWrite } from '@tbd54566975/dwn-sdk-js';
import { DataStoreLevel, EventLogLevel, MessageStoreLevel } from '@tbd54566975/dwn-sdk-js/stores';

const messageStore = new MessageStoreLevel();
const dataStore = new DataStoreLevel();
const eventLog = new EventLogLevel();
const dwn = await Dwn.create({ messageStore, dataStore, eventLog });

// generate a did:key DID
const didKey = await DidKeyResolver.generate();

// create some data
const encoder = new TextEncoder();
const data = encoder.encode('Hello, World!');

// create a RecordsWrite message
const recordsWrite = await RecordsWrite.create({
  data,
  dataFormat: 'application/json',
  published: true,
  schema: 'yeeter/post',
  authorizationSignatureInput: Jws.createSignatureInput(didKey)
});

// get the DWN to process the RecordsWrite
const dataStream = DataStream.fromBytes(data);
const result = await dwn.processMessage(didKey.did, recordsWrite.message, dataStream);
console.log(result.status);

```

With a web wallet installed:

```javascript
const result = await window.web5.dwn.processMessage({
  method: "RecordsQuery",
  message: {
    filter: {
      schema: "http://some-schema-registry.org/todo",
    },
    dateSort: "createdAscending",
  },
});
```

## Release/Build Process

The DWN JS SDK releases builds to [npmjs.com](https://www.npmjs.com/package/@tbd54566975/dwn-sdk-js). There are two build types: stable build and unstable build.

### Stable Build

This is triggered manually by:

1.  Increment `version` in `package.json` in [Semantic Versioning (semver)](https://semver.org/) format.
2.  Merge the change into `main` branch
3.  Create a release from GitHub.

An official build with version matching the `package.json` will be published to [npmjs.com](https://www.npmjs.com/package/@tbd54566975/dwn-sdk-js).

### Unstable Build

Every push to the `main` branch will automatically trigger an unstable build to [npmjs.com](https://www.npmjs.com/package/@tbd54566975/dwn-sdk-js) for developers to experiment and test.

The version string contains the date as well as the commit hash of the last change.

An example version string:

`0.0.26-unstable-2023-03-16-36ec2ce`

- `0.0.26` came from `version` in `package.json`
- `2023-03-16` indicates the date of March 16th 2023
- `36ec2ce` is the commit hash of the last change

## Some projects that use this library:

- [Web5 JS SDK](https://github.com/TBD54566975/web5-js)
- [Example CLI](https://github.com/TBD54566975/dwn-cli)
- [Example with a web wallet](https://github.com/TBD54566975/incubating-web5-labs/)
- [Server side aggregator](https://github.com/TBD54566975/dwn-server)

## Architecture

<img src="./images/dwn-architecture.png" alt="Architecture of DWN SDN" width="700">

> NOTE: The diagram is a conceptual view of the architecture, the actual component abstraction and names in source file may differ.

## Project Resources

| Resource                                                                                     | Description                                                                   |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [CODEOWNERS](https://github.com/TBD54566975/dwn-sdk-js/blob/main/CODEOWNERS)                 | Outlines the project lead(s)                                                  |
| [CODE_OF_CONDUCT.md](https://github.com/TBD54566975/dwn-sdk-js/blob/main/CODE_OF_CONDUCT.md) | Expected behavior for project contributors, promoting a welcoming environment |
| [CONTRIBUTING.md](https://github.com/TBD54566975/dwn-sdk-js/blob/main/CONTRIBUTING.md)       | Developer guide to build, test, run, access CI, chat, discuss, file issues    |
| [GOVERNANCE.md](https://github.com/TBD54566975/dwn-sdk-js/blob/main/GOVERNANCE.md)           | Project governance                                                            |
| [LICENSE](https://github.com/TBD54566975/dwn-sdk-js/blob/main/LICENSE)                       | Apache License, Version 2.0                                                   |
| [Q_AND_A.md](https://github.com/TBD54566975/dwn-sdk-js/blob/main/Q_AND_A.md)                 | Questions and answers on DWN                                                  |
