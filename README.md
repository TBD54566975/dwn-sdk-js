<!-- @format -->

# Decentralized Web Node (DWN) SDK

Code Coverage

![Statements](https://img.shields.io/badge/statements-91.1%25-brightgreen.svg?style=flat) ![Branches](https://img.shields.io/badge/branches-88.73%25-yellow.svg?style=flat) ![Functions](https://img.shields.io/badge/functions-87.41%25-yellow.svg?style=flat) ![Lines](https://img.shields.io/badge/lines-91.1%25-brightgreen.svg?style=flat)

## Introduction

This repository contains a reference implementation of Decentralized Web Node (DWN) as per the [specification](https://identity.foundation/decentralized-web-node/spec/). This specification is in a draft state and very much so a WIP. For the foreseeable future, a lot of the work on DWN will be split across this repo and the repo that houses the specification, which you can find [here](https://github.com/decentralized-identity/decentralized-web-node). The current goal is to produce a [beta implementation](https://github.com/TBD54566975/dwn-sdk-js/milestone/1) by Q4 2022. This won't include all interfaces described in the spec, but enough to begin building applications.

Proposals and issues for the specification itself should be submitted as pull requests to the [spec repo](https://github.com/decentralized-identity/decentralized-web-node).

## Installation

<<<<<<< HEAD

Since this SDK is still in early stages, we haven't yet published to npm. Until then, we suggest using [`npm link`](https://docs.npmjs.com/cli/v8/commands/npm-link) to use this SDK in your own project. Steps:

=======

> > > > > > > 7115b8616651e6af7780b7ae3821fe9c77ab2eb3

```bash
npm install @tbd54566975/dwn-sdk-js
```

## Usage

````javascript
import { Dwn } from '@tbd54566975/dwn-sdk-js';

<<<<<<<<< Temporary merge branch 1
### nodeJS

- **ESM**

  ```javascript
  import { Dwn } from "dwn-sdk";

  // cool things
````

- **CJS**

  ```javascript
  const { Dwn } = require("dwn-sdk");

  // cool things
  ```

### Browser:

- **UMD Bundle**

  ```html
  <script
    type="text/javascript"
    src="node_modules/dwn-sdk/dist/bundles/bundle.umd.js"
  ></script>
  ```

- **ESM Bundle**
  ```html
  <script
    type="text/javascript"
    src="node_modules/dwn-sdk/dist/bundles/bundle.esm.js"
  ></script>
  ```
  =========
  // cool things

```
_Note: Works in both node and browser environments_

⚠ Currently, in order to use this sdk in **node environments** you'll have to include the `--es-module-specifier-resolution=node` flag when running your javascript.
>>>>>>>>> Temporary merge branch 2

## Project Resources

| Resource                                                                                     | Description                                                                   |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [CODEOWNERS](https://github.com/TBD54566975/dwn-sdk-js/blob/main/CODEOWNERS)                 | Outlines the project lead(s)                                                  |
| [CODE_OF_CONDUCT.md](https://github.com/TBD54566975/dwn-sdk-js/blob/main/CODE_OF_CONDUCT.md) | Expected behavior for project contributors, promoting a welcoming environment |
| [CONTRIBUTING.md](https://github.com/TBD54566975/dwn-sdk-js/blob/main/CONTRIBUTING.md)       | Developer guide to build, test, run, access CI, chat, discuss, file issues    |
| [GOVERNANCE.md](https://github.com/TBD54566975/dwn-sdk-js/blob/main/GOVERNANCE.md)           | Project governance                                                            |
| [LICENSE](https://github.com/TBD54566975/dwn-sdk-js/blob/main/LICENSE)                       | Apache License, Version 2.0                                                   |
```
