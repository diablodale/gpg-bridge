# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - TBD

### Added
- GPG Bridge Agent extension: proxies Gpg4win's Assuan socket to remote environments
  via VS Code's built-in tunnel, with nonce authentication and session lifecycle management
- GPG Bridge Request extension: creates a Unix socket on the remote at the standard GPG
  agent path and forwards all Assuan protocol operations to GPG Bridge Agent
- GPG Bridge extension pack: single install point for both component extensions
- EventEmitter-based state machines with explicit transition tables in both extensions
  for robust session lifecycle management and fail-fast error detection
- Full INQUIRE D-block support for GPG operations that require client-supplied data
  (e.g. signing, encryption with passphrase)
- Dependency injection interfaces (`AgentProxyDeps`, `RequestProxyDeps`) enabling
  isolated unit and integration testing without a real VS Code runtime or GPG agent
- Shared `@gpg-bridge/shared` package with pure Assuan protocol utilities:
  `extractCommand`, `extractInquireBlock`, `detectResponseCompletion`, `cleanupSocket`
- esbuild bundling for both extensions — produces single-file VSIX with no
  `node_modules` path traversal issues
- Extension icon (256×256 PNG, generated from `assets/icon.svg` via `npm run icon`)

[Unreleased]: https://github.com/diablodale/gpg-bridge/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/diablodale/gpg-bridge/releases/tag/v0.1.0
