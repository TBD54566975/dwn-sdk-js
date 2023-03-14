<!-- @format -->

# Decentralized Web Node (DWN) SDK

Code Coverage
![Statements](https://img.shields.io/badge/statements-95.07%25-brightgreen.svg?style=flat) ![Branches](https://img.shields.io/badge/branches-92.99%25-brightgreen.svg?style=flat) ![Functions](https://img.shields.io/badge/functions-93.53%25-brightgreen.svg?style=flat) ![Lines](https://img.shields.io/badge/lines-95.07%25-brightgreen.svg?style=flat)

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

const query = await RecordsWrite.create({
  data,
  dataFormat                  : 'application/json',
  published                   : true,
  protocol                    : 'yeeter',
  schema                      : 'yeeter/post',
  authorizationSignatureInput : signatureMaterial
});

const dataStream = DataStream.fromBytes(data);
const result = await dwn.processMessage(didState.did, query.toJSON(), dataStream);

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

## Some projects that use this library: 

* [Example CLI](https://github.com/TBD54566975/dwn-cli)
* [Example with a web wallet](https://github.com/TBD54566975/incubating-web5-labs/)
* [Server side aggregator](https://github.com/TBD54566975/dwn-server)


## Project Resources

| Resource                                                                                     | Description                                                                   |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [CODEOWNERS](https://github.com/TBD54566975/dwn-sdk-js/blob/main/CODEOWNERS)                 | Outlines the project lead(s)                                                  |
| [CODE_OF_CONDUCT.md](https://github.com/TBD54566975/dwn-sdk-js/blob/main/CODE_OF_CONDUCT.md) | Expected behavior for project contributors, promoting a welcoming environment |
| [CONTRIBUTING.md](https://github.com/TBD54566975/dwn-sdk-js/blob/main/CONTRIBUTING.md)       | Developer guide to build, test, run, access CI, chat, discuss, file issues    |
| [GOVERNANCE.md](https://github.com/TBD54566975/dwn-sdk-js/blob/main/GOVERNANCE.md)           | Project governance                                                            |
| [LICENSE](https://github.com/TBD54566975/dwn-sdk-js/blob/main/LICENSE)                       | Apache License, Version 2.0                                                   |
