<!-- @format -->

# Decentralized Web Node (DWN) SDK

Code Coverage
![Statements](https://img.shields.io/badge/statements-93.56%25-brightgreen.svg?style=flat) ![Branches](https://img.shields.io/badge/branches-93.09%25-brightgreen.svg?style=flat) ![Functions](https://img.shields.io/badge/functions-91.24%25-brightgreen.svg?style=flat) ![Lines](https://img.shields.io/badge/lines-93.56%25-brightgreen.svg?style=flat)

## Introduction

This repository contains a reference implementation of Decentralized Web Node (DWN) as per the [specification](https://identity.foundation/decentralized-web-node/spec/). This specification is in a draft state and very much so a WIP. For the foreseeable future, a lot of the work on DWN will be split across this repo and the repo that houses the specification, which you can find [here](https://github.com/decentralized-identity/decentralized-web-node). The current goal is to produce a beta implementation by March 2023. This won't include all interfaces described in the DWN spec, but will be enough to begin building applications.

This project is used as a dependency by several other projects.

Proposals and issues for the specification itself should be submitted as pull requests to the [spec repo](https://github.com/decentralized-identity/decentralized-web-node).

## Installation

```bash
npm install @tbd54566975/dwn-sdk-js
```

## Usage

[API docs](https://tbd54566975.github.io/dwn-sdk-js/)

```javascript

import { Dwn, DataStream, DidKeyResolver, Jws, RecordsWrite, RecordsQuery } from '@tbd54566975/dwn-sdk-js';

export const dwn = await Dwn.create();

...
const didKey = await DidKeyResolver.generate(); // generate a did:key DID
const signatureMaterial = Jws.createSignatureInput(didKey);
const data = randomBytes(32); // in node.js
// or in web
// const data = new Uint8Array(32);
// window.crypto.getRandomValues(data);

const recordsWrite = await RecordsWrite.create({
  data,
  dataFormat                  : 'application/json',
  published                   : true,
  protocol                    : 'yeeter',
  schema                      : 'yeeter/post',
  authorizationSignatureInput : signatureMaterial
});

const dataStream = DataStream.fromBytes(data);
const result = await dwn.processMessage(didKey.did, recordsWrite.message, dataStream);

```

With a web wallet installed:
```javascript

  const result = await window.web5.dwn.processMessage({
    method  : 'RecordsQuery',
    message : {
      filter: {
        schema: 'http://some-schema-registry.org/todo'
      },
      dateSort: 'createdAscending'
    }
  });
```  

## Release/Build Process
The DWN JS SDK releases builds to [npmjs.com](https://www.npmjs.com/package/@tbd54566975/dwn-sdk-js). There are two build types: stable build and unstable build.

### Stable Build
This is triggered manually by:
 1. Increment `version` in `package.json` in [Semantic Versioning (semver)](https://semver.org/) format.
 2. Merge the change into `main` branch
 3. Create a release from GitHub.
 
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

* [Web5 JS SDK](https://github.com/TBD54566975/web5-js)
* [Example CLI](https://github.com/TBD54566975/dwn-cli)
* [Example with a web wallet](https://github.com/TBD54566975/incubating-web5-labs/)
* [Server side aggregator](https://github.com/TBD54566975/dwn-server)




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
