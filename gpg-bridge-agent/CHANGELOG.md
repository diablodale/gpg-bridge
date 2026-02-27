# Changelog

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for guidelines.
## [0.3.0](https://github.com/diablodale/gpg-bridge/compare/v0.2.0...v0.3.0) (2026-02-27)


### Added

* add array of ids for public key export auto-sync ([01673fc](https://github.com/diablodale/gpg-bridge/commit/01673fcd28138a45a5004d0a6b8af62859d305bf))
* enhance public key export quick pick UI with groups, sort, and icons ([ce55ad7](https://github.com/diablodale/gpg-bridge/commit/ce55ad79e91235f8b0a5471dce0b3e1ccc3b20ca))

## [0.2.0](https://github.com/diablodale/gpg-bridge/compare/v0.1.0...v0.2.0) (2026-02-25)


### Added

* **agent:** add exportPublicKeys command - Phase 4 ([6510d63](https://github.com/diablodale/gpg-bridge/commit/6510d63458d6440bbe6fe1c3daed67ebe6775ad3))
* change to public key as source of quick pick ([51c8d41](https://github.com/diablodale/gpg-bridge/commit/51c8d4184514561c14f42a16f949cb98b4d44f1c))
* **request:** add public key synchronization feature to request -- Phase 6 ([2249350](https://github.com/diablodale/gpg-bridge/commit/2249350787598ba720c7414ba5e25345128d16b8))


### Fixed

* add --no-autostart to importPublicKeys() to prevent gpg-agent launch ([896910d](https://github.com/diablodale/gpg-bridge/commit/896910dc51062ffde80e5bc4b6fb1b3497d612e5))
* change public key export to armored strings ([597464f](https://github.com/diablodale/gpg-bridge/commit/597464ff79059319ca37a6ef26186e392c0307b9))
* **request:** prevent starting the request proxy if already running ([cc3843a](https://github.com/diablodale/gpg-bridge/commit/cc3843a386cb7aa65ef188c92a100d6fa636fabe))

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
