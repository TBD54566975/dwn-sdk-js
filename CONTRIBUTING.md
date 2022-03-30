# Contribution Guide

This repo acts as the reference implementation for the Identity Hub specification. Before getting started, we highly recommend that you read the [Identity Hub spec doc](https://identity.foundation/identity-hub/spec/). The specification is still in a draft / incomplete state. Anything related to the general architecture, features, or bugs with respect to Identity Hubs in general are best addressed via issues and pull requests within the [spec repo](https://github.com/decentralized-identity/identity-hub). During early development, we'll be working on the specification and implementation in parallel. If you're confused about where to post your question, bug, or feature request, don't sweat! Go ahead and post it in either repo and we'll go ahead and move it if need be.

The general process we hope to follow is:
- Submit a proposal as a PR in the Identity Hub spec repo. 
- Iterate on the PR until it gets pulled into `main`. 
- Implement said proposal in this repo and submit a PR
- Iterate on PR until its ready for `main`

Given that we're still in early stages of development, this contribution guide will certainly change as we near a v1.0 release. Until then, things will be a bit ragtag but there's still plently of opportunities for contribution.

We'll be focusing on issues in the following order:
- https://github.com/decentralized-identity/identity-hub/issues/126
- https://github.com/TBD54566975/hub-sdk-js/issues/7
- https://github.com/decentralized-identity/identity-hub/issues/127
- https://github.com/decentralized-identity/identity-hub/issues/128
- https://github.com/TBD54566975/hub-sdk-js/issues/6
- https://github.com/TBD54566975/hub-sdk-js/issues/10
- https://github.com/TBD54566975/hub-sdk-js/issues/11
- https://github.com/TBD54566975/hub-sdk-js/issues/12
- https://github.com/TBD54566975/hub-sdk-js/issues/13
- https://github.com/TBD54566975/hub-sdk-js/issues/14

As we work our way through these issues, we'll be creating more focused issues with the following labels:
- `bug`
- `documentation`
- `good first issue`
- `help wanted`

These issues are excellent canditates for contribution and we'd be thrilled to get all the help we can get! You can take a look at all of the Issues that match the labels above [here](https://github.com/TBD54566975/hub-sdk-js/issues?q=is%3Aopen+label%3A%22help+wanted%22%2C%22good+first+issue%22%2C%22documentation%22%2C%22bug%22+)

We suggest the following process when picking up one of these issues:
- Check to see if anyone is already working on the issue by looking to see if the issue has a `WIP` tag. 
- Fork the repo and create a branch named the issue number you're taking on
- Push that branch and create a draft PR
- paste a link to the draft PR in the issue you're tackling
- We'll add the `WIP` tag for you
- work away. Feel free to ask any/all questions that crop up along the way
- Switch the draft PR to "Ready for review"
## Development
### Prerequisites

| Requirement | Tested Version | Installation Instructions |
| ----------- | -------------- | ------------------------- |
| `Node.js`        | `v16.14.0`            | There are many ways to install `Node.js`. Feel free to choose whichever approach you feel the most comfortable with. If you don't have a preferred installation method, you can visit the official [downloads](https://nodejs.org/en/download/) page and choose the the appropriate installer respective to your operating system |

We plan on including a Docker container to support all local development soon.
### Running tests
Running the `npm run test` command from the root of the project will run all tests. Please make sure there are no failing tests before switching your PR to ready for review! We hope to have this automated via a github action very soon.
### Code Style
Our preferred code style has been codified into `eslint` rules. Feel free to take a look [here](./.eslintrc.cjs). Running `npm run lint` will auto-format as much as `eslint` can. Everything it wasn't able to will be printed out as errors or warnings. Please make sure to run `npm run lint` before switching your PR to ready for review! We hope to have this automated via a github action very soon.
### Available NPM Commands
| command                      | description                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `npm run test:node`               | runs tests and type checking                                                                                  |
| `npm run test:browser`               | runs tests against browser bundles in headless browser                                                     |
| `npm run build`              | transpiles `ts` -> `js` as `esm` and `cjs`, generates `esm` and `umd` bundles, and generates all type declarations |
| `npm run build:esm`          | transpiles ts -> js as `esm`                                                                                       |
| `npm run build:cjs`          | transpiles ts -> js as `cjs`                                                                                       |
| `npm run build:bundles`      | generates `esm` and `umd` bundles                                                                                  |
| `npm run build:declarations` | generates all type declarations                                                                                    |
| `npm run clean`              | deletes `dist` dir                                                                                                 |
| `npm run lint`               | runs linter and auto-fixes all problems                                                                            |