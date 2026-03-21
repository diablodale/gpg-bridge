# Contributing to GPG Bridge

[![Unit test coverage](https://img.shields.io/codecov/c/gh/diablodale/gpg-bridge?token=61T3LCANGO&flag=unittests&logo=codecov&label=Unit%20test%20coverage)](https://codecov.io/gh/diablodale/gpg-bridge)

## Prerequisites

| Tool                                                                                                     | Version   | Notes                                                                  |
| -------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------- |
| [Node.js](https://nodejs.org/)                                                                           | v22.x     | Match VS Code's bundled Node runtime                                   |
| [VS Code](https://code.visualstudio.com/)                                                                | v1.108.1+ | Required for extension development and integration tests               |
| [Dev Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) | any       | Required for integration tests                                         |
| [GnuPG](https://gnupg.org/)                                                                              | v2.1+     | `gnupg` on Linux/macOS, [Gpg4win](https://www.gpg4win.org/) on Windows |
| [Git](https://git-scm.com/)                                                                              | any       | Commits must be signed (GPG, SSH, or X.509)                            |

## Dev Setup

```powershell
git clone https://github.com/diablodale/gpg-bridge
cd gpg-bridge
npm install        # installs all workspaces + deploys icon to extension folders
npm run compile    # builds shared → gpg-bridge-agent → gpg-bridge-request
```

## Development Workflow

### Watch mode (rebuilds on save)

```powershell
npm run watch
```

Runs TypeScript watch for all three workspaces in parallel.

### Launch a debug session

Press `F5` inside the `gpg-bridge-agent/` or `gpg-bridge-request/` folder to launch
a VS Code Extension Development Host with that extension loaded.

### Rebuild the icon

If you update `assets/icon.svg`:

```powershell
npm run icon        # renders SVG → assets/icon.png, then copies to all extension folders
```

This runs automatically before `npm run package`, so you never need to run it manually
before packaging.

## Build

```powershell
npm run compile
```

Builds in dependency order: `shared` → `gpg-bridge-agent` → `gpg-bridge-request`.
TypeScript output goes to each extension's `out/` folder.

## Testing

### Unit tests

```powershell
npm run test
```

Runs unit tests for `shared`, `gpg-bridge-agent`, and `gpg-bridge-request` in sequence.
No VS Code runtime or real GPG agent required — all I/O is injected via mocks.

Each package compiles before running and lints automatically via `pretest`. Coverage is
collected on every `npm run test` using V8 and written to each package's `coverage/unit/` folder:

| File                                | Use                                                    |
| ----------------------------------- | ------------------------------------------------------ |
| `coverage/unit/lcov.info`           | Tooling (Codecov, coverage gutters VS Code extensions) |
| `coverage/unit/coverage-final.json` | VS Code Test Explorer inline source decorators         |

A per-file coverage table is also printed to stdout at the end of each run.

### VS Code Test Explorer

Open the **Testing** panel (`Ctrl+Shift+P` → "Testing: Focus on Test Explorer View").
The root `.vscode-test.cjs` registers a single **"All unit tests"** profile that spans
all three packages in one TestRun. Click ▷ **Run with Coverage** to run all tests and
see inline coverage decorators appear directly on source lines in the editor.

> **Why a single root profile?** The VS Code Extension Test Runner uses one shared
> `IstanbulCoverageContext` across all discovered configs. When multiple configs run
> sequentially, only the last completed TestRun retains working inline-coverage bindings.
> One combined profile = one TestRun = inline decorators for every package.

Per-package configs (`vscode-test-cli.cjs` in each sub-folder) are named to avoid the
Extension Test Runner's discovery glob (`**/.vscode-test.*`) and are used only by the
`npm run test` CLI scripts.

### Integration tests

Integration tests launch real VS Code Extension Development Hosts against live processes.
`gpg-bridge-agent` integration tests require GPG installed on the local Windows host.
`gpg-bridge-request` integration tests additionally require Docker Desktop and the
[Dev Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)
extension — tests run inside Linux dev containers with the two extensions split across
the Windows local host and the container as they would be in real use.

```powershell
npm run test:integration
```

Or run per-package:

```powershell
npm --prefix shared run test:integration
npm --prefix gpg-bridge-agent run test:integration
npm --prefix gpg-bridge-request run test:integration
```

`gpg-bridge-request` integration tests are split into two phases chained by `&&`:

- **Phase 2** (`test:integration:request-proxy`) — exercises the full proxy chain using
  `AssuanSocketClient` as a test client in a Linux dev container.
- **Phase 3** (`test:integration:gpg-cli`) — exercises the full proxy chain driven by
  the real `gpg` binary inside a second container.

Coverage is collected from the container-side extension host via `NODE_V8_COVERAGE` and
written by both phases to a shared `coverage/v8-integration/` directory (workspace bind
mount). After Phase 3 finishes, the runner post-processes the accumulated V8 JSON
(remapping Linux container paths to Windows host paths, stripping vscode-server
internals) and generates a merged report in each package's `coverage/integration/` folder:

| File                                       | Use                                           |
| ------------------------------------------ | --------------------------------------------- |
| `coverage/integration/lcov.info`           | Tooling (Codecov, coverage gutter extensions) |
| `coverage/integration/coverage-final.json` | Raw Istanbul JSON                             |

A per-file coverage table is also printed to stdout at the end of the run.

## VSIX Packaging

```powershell
npm run package           # renders icon, packages all three extensions
npm run package:agent     # gpg-bridge-agent only
npm run package:request   # gpg-bridge-request only
npm run package:pack      # extension pack only
```

Produces `.vsix` files in each extension's directory.

## Code Style

- **Language**: TypeScript. Configuration in each `tsconfig.json`.
- **Linting**: `eslint` — run `npm run lint` inside an extension folder, or let
  `pretest` run it automatically before tests.
- **Logging**: use the module-level `log(config, message)` helper. Never log raw
  binary data — use `sanitizeForLog()` for protocol content.
- **Socket I/O**: always use `latin1` encoding to preserve raw bytes.
- **No `console.log`**: use the `log()` helper so output goes through the configured
  VS Code output channel.

## Git Hooks

This project uses [prek](https://prek.j178.dev/) to enforce quality gates locally
before changes reach GitHub.

| Hook         | Trigger               | What runs                                          |
| ------------ | --------------------- | -------------------------------------------------- |
| `pre-commit` | `git commit`          | `npm run compile` then `npm run lint`              |
| `commit-msg` | after message entered | `commitlint` validates Conventional Commits format |
| `pre-push`   | `git push`            | `npm run test` (unit suite)                        |

### Installing hooks

Hooks are installed automatically when you run `npm install` — including
`commitlint`, which is a devDependency. To reinstall manually:

```sh
prek install
```

### Bypassing hooks

In an emergency you can skip hooks with:

```sh
git commit --no-verify
git push --no-verify
```

> ⚠️ Bypass sparingly. The GitHub repository ruleset still enforces commit
> signing server-side, and the PR flow enforces `npm run test` via CI.

---

## Commit Conventions

This project follows [Conventional Commits v1](https://www.conventionalcommits.org/en/v1.0.0/).

**Format:** `<type>(<scope>): <description>`

| Type       | When to use                                  |
| ---------- | -------------------------------------------- |
| `feat`     | New user-visible feature                     |
| `fix`      | Bug fix                                      |
| `refactor` | Code change with no external behavior change |
| `build`    | Build system, tooling, dependencies          |
| `docs`     | Documentation only                           |
| `test`     | Adding or fixing tests                       |
| `chore`    | Maintenance (version bumps, cleanup)         |

**Scope** (optional): `agent`, `request`, `shared`, `pack`, `ci`, or omit for repo-wide changes.

**Examples:**

```
feat(agent): add connection timeout configuration
fix(request): handle partial D-block split across two socket reads
docs: update CONTRIBUTING with integration test prereqs
build: upgrade esbuild to 0.28
```

All commits must be cryptographically signed (GPG, SSH, or X.509). Configure
your preferred signing method in git before contributing. The `main` branch
enforces this server-side via a GitHub repository ruleset.

## Pull Request Guidelines

1. Fork the repo and create a feature branch from `main`
2. Run the full test suite before opening a PR: `npm run test && npm run test:integration`
3. Keep each PR focused on a single logical change — split unrelated changes into
   separate PRs
4. PR title must follow the Conventional Commits format above
5. Include a description of what changed and why; reference any related issues
6. Ensure `npm run compile` has no TypeScript errors
