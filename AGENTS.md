# Project Guidelines

Project is two cooperating VS Code extensions written in TypeScript

- `gpg-bridge-agent` extension manages socket connections to local GPG agent
- `gpg-bridge-request` extension provides Unix socket server on remote computer and forwards Assuan protocol
  requests to agent
- `shared` is shared code and utilities re-exported from index, e.g. pure functions, types, etc.

## Writing Style for user-facing UI and messages

- Perspective: Use second-person "you" and "your"
- Clarity: Write for non-native English speakers
- Formatting:
  - Backticks for file paths, filenames, variable names, field entries
  - Sentence case for titles and messages; capitalize only first word and proper nouns

## Code Review Style

- Language: TypeScript. Configuration is in `tsconfig.json`
- Linting / formatting: follow existing patterns in `eslint.config.mjs` and existing code (no extra formatting rules enforced here)

## Regular Checkpoints with Git

- Git source control
- All commits and tags must be GPG signed, and follow _Conventional Commits v1_ specification with
  valid types: `feat`, `fix`, `perf`, `security`, `deprecate`, `docs`, `chore`, `refactor`, `test`, `build`, `ci`.
- Identify when a conceptually complete unit of work is finished
  e.g. feature, bug fix, refactor. Ask the user if they want to git commit. If they agree,
  the following must be completed successfully
  1. Documents, plans, diagrams updated to align with work and indicate work is complete
  2. All unit tests must pass
  3. Git commit message must follow _Conventional Commits v1_ specification with valid type
  4. Inform user work is complete and committed. Wait for user

## Architecture

- Extensions communicate over VS Code commands, multiple sessions and clients supported
- `gpg-bridge-request` runs on remote computer, listens to clients on GPG Unix socket, forwards data from
  client to `gpg-bridge-agent` with VS Code commands
- `gpg-bridge-agent` runs on local computer, connects to local GPG Agent with Assuan, forwards data from
  VS Code command to GPG Agent
- Public key sync: `gpg-bridge-agent` exposes `exportPublicKeys` command; `gpg-bridge-request` calls it
  and imports the result into the remote GPG keyring via `gpg --import`
- Shared code packaged as `@gpg-bridge/shared`
- EventEmitter based state machines
  - Explicit state tracking and transition validation `transition()`
  - String events, not objects
  - String literal unions for type safety
- Sessions are stored in `Map` keyed by UUID
- Cleanup via socket 'close' handlers; spontaneous socket closures through `CLEANUP_REQUESTED` event
- Error handling: Async functions rethrow after local cleanup if caller expects rejection.
- Use `latin1` encoding for socket I/O (preserves raw bytes)

## Logging

- Module-level `log(config, message)` helper pattern
- Never log raw binary; use `sanitizeForLog()`
- No sensitive data (keys, tokens, passwords)
- No periods at end of messages

## Testing

Run `npm test` or `npm test:integration`. Framework: Mocha (BDD) + Chai (expect).

- Unit tests `<folder>/src/test/`
- Integration tests `<folder>/test/`
- Mocks from `@gpg-bridge/shared/test` for socket/file/command interactions
- Target >70% coverage via dependency injection; coverage reports at `<folder>/coverage`

## Dependency Injection

All services support optional dependency injection via `*Deps` interfaces.
Pass mocks via optional deps parameter to test without VS Code runtime or real sockets.
Enables isolated testing, systematic error scenarios, and deterministic execution, e.g.

```typescript
const proxy = new RequestProxy(config, {
  commandExecutor: new MockCommandExecutor(),
  serverFactory: new MockServerFactory(),
  fileSystem: new MockFileSystem(),
  socketConnectFactory: new MockSocketFactory(),
});
```

## Build & Packaging

Powershell on Windows hosts. Bash on Linux/macOS hosts. From repository root:

- `npm install` installs root dependencies, auto-runs postinstall hooks to install subfolders
- `npm run compile` builds in dependency order
- `npm run package` creates packaged extension (.vsix files)

Each extension compiles to its own `out/` folder via TypeScript (`tsc`) for development and testing.
Packaging (`npm run package`) uses esbuild to bundle each extension into a single `out/extension.js`
before vsce packages it — no `node_modules` are included in the VSIX. Shared code is imported
from `@gpg-bridge/shared` (`file:../shared` dependency), inlined by esbuild at package time.

## Security

- Uses GPG Assuan protocol via "extra" gpg-agent socket (S.gpg-agent.extra) with nonce authentication
- Only relays commands/responses of public data, no secrets are transmitted, all sensitive operations stay
  in GPG Agent
