# Changelog

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for guidelines.
## [0.1.0](https://github.com/diablodale/gpg-bridge/compare/v0.0.0...v0.1.0) (2026-02-24)


### Added

* **assets:** add architecture diagram; fix image and link URLs in all READMEs ([441a177](https://github.com/diablodale/gpg-bridge/commit/441a17703410e1f8d6dd41190d71060f36e4fe43))
* **editorconfig:** add .editorconfig for consistent style and formatting ([a91d577](https://github.com/diablodale/gpg-bridge/commit/a91d577e5c04c3fe6d814d5bfaf3c323abaf06a0))
* **phase-3:** set publisher identity to hidale, align @types/node ([f2ad219](https://github.com/diablodale/gpg-bridge/commit/f2ad219a1a4cd1a0f50b9e18196f6769bfc5bdad))
* **request:** handle CAN response to INQUIRE ([4e92059](https://github.com/diablodale/gpg-bridge/commit/4e92059703398268bdc6a191483abafa0cef6d16))


### Fixed

* add checks to prevent activation on unsupported OS ([ae0cdbd](https://github.com/diablodale/gpg-bridge/commit/ae0cdbd4ec30e06429213220a6908e7bba575fa1))
* **agent:** fix status bar spin and invalid-session error after BYE ([ab40ba7](https://github.com/diablodale/gpg-bridge/commit/ab40ba734ae4c6ef2b52ca5f21936b172fcc15e4))
* remove bootstrap-fork.js false positive, fix status label, add manual install docs ([3ca6f02](https://github.com/diablodale/gpg-bridge/commit/3ca6f0216def154b998283a5b0f6b0efafee3c9a))

## [0.0.0](https://github.com/diablodale/gpg-bridge/compare/55e81cf34e94c9379296c6c6fab95c4a5691eda7...v0.0.0)

### Added

- GPG Bridge Agent extension: bridges GPG Assuan socket to remote environments
  via VS Code's built-in command tunnel
- GPG Bridge Request extension: creates a Unix socket on the remote at the standard GPG
  agent path and forwards all Assuan protocol operations to GPG Bridge Agent
- GPG Bridge extension pack: single install point for both component extensions
- Build infrastructure
