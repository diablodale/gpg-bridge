# Contributing to GPG Bridge

## Prerequisites

| Tool                                      | Version  | Notes                                                    |
| ----------------------------------------- | -------- | -------------------------------------------------------- |
| [Node.js](https://nodejs.org/)            | v22.x    | Match VS Code's bundled Node runtime                     |
| [VS Code](https://code.visualstudio.com/) | v1.91.0+ | Required for extension development and integration tests |
| [Gpg4win](https://www.gpg4win.org/)       | v4.4.1+  | Required on Windows host for integration tests           |
| [Git](https://git-scm.com/)               | any      | Commits must be signed (GPG, SSH, or X.509)              |

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
npm test
```

Runs unit tests for `shared`, `gpg-bridge-agent`, and `gpg-bridge-request` in sequence.
No VS Code runtime or real GPG agent required — all I/O is injected via mocks.

### Integration tests

Integration tests launch a real VS Code Extension Development Host and require the
Windows host to have Gpg4win installed and `gpg-agent` running.

```powershell
npm run test:integration
```

Or run per-extension:

```powershell
npm --prefix gpg-bridge-agent run test:integration
npm --prefix gpg-bridge-request run test:integration
```

### Watch mode (unit tests only)

```powershell
npm run test:watch
```

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
| `pre-push`   | `git push`            | `npm test` (unit suite)                            |

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
> signing server-side, and the PR flow enforces `npm test` via CI.

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
2. Run the full test suite before opening a PR: `npm test && npm run test:integration`
3. Keep each PR focused on a single logical change — split unrelated changes into
   separate PRs
4. PR title must follow the Conventional Commits format above
5. Include a description of what changed and why; reference any related issues
6. Ensure `npm run compile` has no TypeScript errors
