# Contribution Guide 

There are many ways to be an open source contributor, and we're here to help you on your way! You may:

* Propose ideas in our [discussion forums](LINK_HERE)  ___***FIX LINK AND REMOVE THIS NOTICE***___
* Raise an issue or feature request in our [issue tracker](LINK_HERE)  ___***FIX LINK AND REMOVE THIS NOTICE***___
* Help another contributor with one of their questions, or a code review
* Suggest improvements to our Getting Started documentation by supplying a Pull Request
* Evangelize our work together in conferences, podcasts, and social media spaces.

This guide is for you.

## Development Prerequisites

| Requirement | Tested Version | Installation Instructions |
| ----------- | -------------- | ------------------------- |
| fill        | out            | plz                       |


## Available Scripts
| command                      | description                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `npm run test`               | runs tests and type checking                                                                                       |
| `npm run build`              | transpiles `ts` -> `js` as `esm` and `cjs`, generates `esm` and `umd` bundles, and generates all type declarations |
| `npm run build:esm`          | transpiles ts -> js as `esm`                                                                                       |
| `npm run build:cjs`          | transpiles ts -> js as `cjs`                                                                                       |
| `npm run build:cjs`          | transpiles ts -> js as `cjs`                                                                                       |
| `npm run build:bundles`      | generates `esm` and `umd` bundles                                                                                  |
| `npm run build:declarations` | generates all type declarations                                                                                    |
| `npm run clean`              | deletes `dist` dir                                                                                                 |
| `npm run lint`               | runs linter and auto-fixes all problems                                                                            |


## Communications

### Issues

Anyone from the community is welcome (and encouraged!) to raise issues via [GitHub Issues](https://github.com/issues)

### Continuous Integration

Build and Test cycles are run on every commit to every branch on [CircleCI](LINK_HERE).

 ___***FIX LINK ABOVE AND REMOVE THIS NOTICE***___

## Contribution

We review contributions to the codebase via GitHub's Pull Request mechanism. We have the following guidelines to ease your experience and help our leads respond quickly to your valuable work:

* Start by proposing a change either in Issues (most appropriate for small change requests or bug fixes) or in Discussions (most appropriate for design and architecture considerations, proposing a new feature, or where you'd like insight and feedback)
* Cultivate consensus around your ideas; the project leads will help you pre-flight how beneficial the proposal might be to the project. Developing early buy-in will help others understand what you're looking to do, and give you a a greater chance of your contributions making it into the codebase! No one wants to see work done in an area that's unlikely to be incorporated into the codebase.
* Fork the repo into your own namespace/remote
* Work in a dedicated feature branch. Atlassian wrote a great [description of this workflow](https://www.atlassian.com/git/tutorials/comparing-workflows/feature-branch-workflow)
* When you're ready to offer your work to the project, first:
* Squash your commits into a single one (or an appropriate small number of commits), and rebase atop the upstream `main` branch. This will limit the potential for merge conflicts during review, and helps keep the audit trail clean. A good writeup for how this is done is [here](https://medium.com/@slamflipstrom/a-beginners-guide-to-squashing-commits-with-git-rebase-8185cf6e62ec), and if you're having trouble - feel free to ask a member or the community for help or leave the commits as-is, and flag that you'd like rebasing assistance in your PR! We're here to support you.
* Open a PR in the project to bring in the code from your feature branch.
* The maintainers noted in the `CODEOWNERS` file will review your PR and optionally open a discussion about its contents before moving forward.
* Remain responsive to follow-up questions, be open to making requested changes, and...
* You're a contributor!
* And remember to respect everyone in our global development community. Guidelines are established in our `CODE_OF_CONDUCT.md`.