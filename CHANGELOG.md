# Changelog

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.0.0](https://github.com/diablodale/gpg-bridge/compare/55e81cf34e94c9379296c6c6fab95c4a5691eda7...v0.0.0)

### Added

- GPG Bridge Agent extension: bridges GPG Assuan socket to remote environments
  via VS Code's built-in command tunnel
- GPG Bridge Request extension: creates a Unix socket on the remote at the standard GPG
  agent path and forwards all Assuan protocol operations to GPG Bridge Agent
- GPG Bridge extension pack: single install point for both component extensions
- Build infrastructure
