# Test Reporting Implementation Plan

Add JUnit XML test output to all test suites so results can be inspected locally and surfaced in
GitHub Actions as PR checks, comments, and per-failure annotations — without losing console color
output.

## Phase 1 — Local

### Goal

Emit JUnit XML test results to `<package>/test-results/unit/` and
`<package>/test-results/integration/` alongside the existing `coverage/` folder, while keeping
the console `spec` reporter with full color output.

---

### Root Cause of Previous Color Failure

`mocha-multi-reporters` instantiates each sub-reporter (e.g. `spec`) with an intermediate
`EventEmitter` shim rather than the real Mocha runner. `Mocha.reporters.Base` stores `color: true`
on the runner object it receives at construction time. A shim runner does not carry this flag, so
`spec` sees a falsy color setting and drops ANSI codes.

The fix: extend `Spec` directly so it is constructed with the authentic Mocha runner and
inherits `color: true` naturally. `mocha-junit-reporter` is then attached as a second listener
on the same runner, which is safe because Mocha runners are plain `EventEmitter`s.

---

### Solution Architecture

One new shared reporter file placed in `shared/junit-spec.cjs`, alongside the existing
`shared/vscode-test-cli.cjs` and `shared/vscode-test-cli.integration.cjs` dev helpers:

```
shared/
  junit-spec.cjs                  ← new: extends Spec directly; attaches JUnit to same runner
  vscode-test-cli.cjs             ← existing
  vscode-test-cli.integration.cjs ← existing
  src/ ...
```

This follows the established pattern of placing non-compiled CJS dev helpers directly in
`shared/` alongside (not inside) `src/`. It is not part of the compiled package output and
will not appear in any VSIX.

- Reads `JUNIT_OUTPUT_FILE` env var for the XML output path.
- If the env var is absent, behaves as a pure `spec` reporter (no XML written).
  This lets the file be referenced unconditionally from all configs without
  breaking VS Code Test Explorer runs that never set the variable.
- `mocha-junit-reporter` creates parent directories automatically.

#### Reporter pseudocode

```js
'use strict';
const Mocha = require('mocha');
const JUnit = require('mocha-junit-reporter');
const Spec = Mocha.reporters.Spec;

module.exports = class JunitSpec extends Spec {
  constructor(runner, options) {
    super(runner, options); // Spec gets the real runner → colors work
    const outFile = process.env.JUNIT_OUTPUT_FILE;
    if (outFile) {
      new JUnit(runner, { mochaFile: outFile }); // second listener on same runner
    }
  }
};
```

`mocha-junit-reporter` is a plain CJS package (no native addons). When the workspace
is bind-mounted into a Linux devcontainer, Windows `node_modules` are accessible at the
same relative paths, so no separate install is needed inside the container.

---

### Dependencies

#### Mocha v10 → v11 upgrade

`@vscode/test-cli@0.0.12` bundles its own **nested** mocha v11.7.5 as a direct dependency
(not a peer). Unit tests therefore already run under mocha v11. The per-package
`devDependencies` still specify `mocha: ^10.5.0`, which means integration suite files that
directly `require('mocha')` get v10.8.2 — a version mismatch.

Upgrade all per-package `mocha` devDependencies from `^10.5.0` to `^11` as the first step
of this plan. The public API used (`new Mocha({...})`, `addFile()`, `run()`, `color`,
`reporter`) is unchanged in v11. `@types/mocha` stays at `^10.0.10` — there is no separate
v11 types package; the latest published version (`10.0.10`) covers both v10 and v11.

Packages to update: `gpg-bridge-agent/package.json`, `gpg-bridge-request/package.json`,
`shared/package.json` (all three have `mocha: "^10.5.0"` in devDependencies).

No test file code changes are needed for the upgrade.

#### New package for JUnit output

Add `mocha-junit-reporter: "^2.2.1"` to **`shared/package.json`** devDependencies.

`shared/junit-spec.cjs` lives in the `shared/` directory. Node.js resolves `require()`
calls by walking up the directory tree from the requiring file, so it finds packages in
`shared/node_modules/` first. `mocha` is already a devDependency of `shared/package.json`
and is already present there. Adding `mocha-junit-reporter` to the same place keeps the
dependency co-located with the file that needs it.

The devcontainer bind-mount exposes the full workspace (including `shared/node_modules/`) at
the same relative paths inside the container, so phases 2 and 3 require no separate
container-side install.

---

### File Changes

#### 1. `shared/junit-spec.cjs` — new file

Full implementation per pseudocode above.

---

#### 2. `.gitignore`

Add one line anywhere in the file:

```
test-results/
```

---

#### 3. Root `package.json` — clean script (optional but recommended)

Extend the existing `clean` script to also wipe test-results directories:

```
"clean": "rimraf -g \"gpg-bridge-agent/out\" ... \"shared/out\" \"gpg-bridge-agent/test-results\" \"gpg-bridge-request/test-results\" \"shared/test-results\""
```

---

#### 4. `@vscode/test-cli` config files — unit and shared-integration tests

The `vscode-test-cli.cjs` is evaluated by the `vscode-test` CLI in a Node.js process that
then spawns VS Code. Setting `process.env.JUNIT_OUTPUT_FILE` in the config file mutates the
outer process's environment; child processes (VS Code → extension host → test runner) inherit
it automatically.

Add two lines of setup at the top of each config file **before** `defineConfig(...)`, and add
`reporter` to the `mocha` block of each applicable suite entry.

##### `gpg-bridge-agent/vscode-test-cli.cjs`

```js
// Add at top, before require('@vscode/test-cli'):
const path = require('path');
process.env.JUNIT_OUTPUT_FILE = path.resolve(__dirname, 'test-results/unit/results.xml');
```

In the `mocha` options of the `'Agent unit tests'` suite:

```js
mocha: {
  ui: 'bdd',
  timeout: 120000,
  reporter: require.resolve('../shared/junit-spec.cjs'),
},
```

##### `gpg-bridge-request/vscode-test-cli.cjs`

Same pattern:

```js
const path = require('path');
process.env.JUNIT_OUTPUT_FILE = path.resolve(__dirname, 'test-results/unit/results.xml');
```

```js
mocha: {
  ui: 'bdd',
  timeout: 120000,
  reporter: require.resolve('../shared/junit-spec.cjs'),
},
```

##### `shared/vscode-test-cli.cjs`

Only the `'Shared 1: unit tests'` suite runs during `npm test` (the script passes
`--label "Shared 1: unit tests"`). Add to its `mocha` block:

```js
const path = require('path');
process.env.JUNIT_OUTPUT_FILE = path.resolve(__dirname, 'test-results/unit/results.xml');
```

```js
// 'Shared 1: unit tests' suite only:
mocha: {
  ui: 'bdd',
  timeout: 10000,
  reporter: require.resolve('./junit-spec.cjs'),  // same dir as this config file
},
```

The `'Shared 2: integration tests'` suite in this file is never run via `npm test`
(handled by `vscode-test-cli.integration.cjs`); no change needed there.

##### `shared/vscode-test-cli.integration.cjs`

```js
const path = require('path');
process.env.JUNIT_OUTPUT_FILE = path.resolve(__dirname, 'test-results/integration/results.xml');
```

```js
mocha: {
  ui: 'bdd',
  timeout: 60000,
  reporter: require.resolve('./junit-spec.cjs'),  // same dir as this config file
},
```

---

#### 5. Phase 1 — agent integration tests (`@vscode/test-electron`, Windows-local)

Two files to change.

##### `gpg-bridge-agent/test/integration/runTest.ts`

Add `JUNIT_OUTPUT_FILE` to `extensionTestsEnv`. From the compiled output location
(`out/test/integration/`), three levels up reaches `gpg-bridge-agent/`:

```ts
extensionTestsEnv: {
  // ... existing entries ...
  NODE_V8_COVERAGE: 'coverage/v8-integration',
  JUNIT_OUTPUT_FILE: path.resolve(__dirname, '../../../test-results/integration/results.xml'),
},
```

##### `gpg-bridge-agent/test/integration/suite/index.ts`

Add `reporter` to the `Mocha` constructor. At runtime `__dirname` is
`out/test/integration/suite/`; four levels up reaches `gpg-bridge-agent/`, five levels
up reaches the repo root, then down into `shared/`:

```ts
const mocha = new Mocha({
  ui: 'bdd',
  color: true,
  timeout: 60000,
  ...(process.env.JUNIT_OUTPUT_FILE && {
    reporter: path.resolve(__dirname, '../../../../../shared/junit-spec.cjs'),
  }),
});
```

The conditional spread means VS Code Test Explorer (which never sets `JUNIT_OUTPUT_FILE`)
continues using mocha's default `spec` reporter without change.

---

#### 6. Phase 2 — request-proxy integration tests (devcontainer, Linux-remote)

The suite runner executes inside the Linux devcontainer. All paths in env vars must be
container-side paths. `containerWorkspaceFolder` is already computed in the runner as
`` `/workspaces/${path.basename(workspaceRoot)}` ``.

##### `gpg-bridge-request/test/integration/requestProxyRunTest.ts`

```ts
extensionTestsEnv: {
  // ... existing entries ...
  JUNIT_OUTPUT_FILE: `${containerWorkspaceFolder}/gpg-bridge-request/test-results/integration/requestProxy.xml`,
},
```

##### `gpg-bridge-request/test/integration/suite/requestProxyIndex.ts`

At runtime `__dirname` is `out/test/integration/suite/` inside the container;
five levels up reaches the repo root inside the container, then down into `shared/`:

```ts
const mocha = new Mocha({
  ui: 'bdd',
  color: true,
  timeout: 60000,
  ...(process.env.JUNIT_OUTPUT_FILE && {
    reporter: path.resolve(__dirname, '../../../../../shared/junit-spec.cjs'),
  }),
});
```

---

#### 7. Phase 3 — gpg-cli integration tests (devcontainer, Linux-remote)

Phase 3 runs after Phase 2 and reuses the same container workspace mount.
Name the output file differently from Phase 2 to avoid overwrite.

##### `gpg-bridge-request/test/integration/gpgCliRunTest.ts`

```ts
extensionTestsEnv: {
  // ... existing entries ...
  JUNIT_OUTPUT_FILE: `${containerWorkspaceFolder}/gpg-bridge-request/test-results/integration/gpgCli.xml`,
},
```

##### `gpg-bridge-request/test/integration/suite/gpgCliIndex.ts`

Same pattern as `requestProxyIndex.ts`:

```ts
const mocha = new Mocha({
  ui: 'bdd',
  color: true,
  timeout: 120000,
  ...(process.env.JUNIT_OUTPUT_FILE && {
    reporter: path.resolve(__dirname, '../../../../../shared/junit-spec.cjs'),
  }),
});
```

---

### Output Locations

```
gpg-bridge-agent/
  test-results/
    unit/
      results.xml
    integration/
      results.xml

gpg-bridge-request/
  test-results/
    unit/
      results.xml
    integration/
      requestProxy.xml   ← Phase 2
      gpgCli.xml         ← Phase 3

shared/
  test-results/
    unit/
      results.xml
    integration/
      results.xml
```

---

### Implementation Order

1. ✅ Upgrade `mocha` from `^10.5.0` to `^11` in `gpg-bridge-agent/package.json`,
   `gpg-bridge-request/package.json`, and `shared/package.json`. Also add
   `mocha-junit-reporter: "^2.2.1"` to `shared/package.json` devDependencies. Run
   `npm install` from repo root.
2. ✅ Create `shared/junit-spec.cjs`.
3. ✅ Update `.gitignore`.
4. ✅ Update the four `vscode-test-cli*.cjs` config files (no TypeScript compilation needed).
5. ✅ Update `gpg-bridge-agent` integration runner and suite (`runTest.ts`, `suite/index.ts`).
6. ✅ Update `gpg-bridge-request` integration runners and suites (both `runTest` files, both suite index files).
7. ✅ Optionally update root `clean` script.
8. ✅ Run `npm run compile` then `npm test` to verify unit tests produce XML and keep color output.
9. ✅ Run each integration suite manually to verify XML output.

---

### Risks and Mitigations

| Risk                                                                                                              | Mitigation                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mocha-junit-reporter` ships no native addons; Windows `node_modules` bind-mounted into Linux container will work | Confirmed: dependency chain is pure JS (`xmlbuilder2`)                                                                                                                                                          |
| VS Code Test Explorer must not be affected                                                                        | Reporter is only applied when `JUNIT_OUTPUT_FILE` is set; Test Explorer never sets it                                                                                                                           |
| `@vscode/test-cli` nests its own mocha v11 — does upgrading per-package to v11 conflict?                          | No conflict: test-cli uses its nested copy; per-package mocha is used only by integration suite files in a separate process                                                                                     |
| `@types/mocha` doesn't have a v11 release                                                                         | The `10.0.10` types cover mocha v11 API unchanged; no separate types package exists or is needed                                                                                                                |
| `shared/junit-spec.cjs` in devcontainer: does path resolution from suite index reach it?                          | `path.resolve(__dirname, '../../../../../shared/junit-spec.cjs')` traverses from `out/test/integration/suite/` up to repo root, then into `shared/` — same workspace bind-mount used for all other source files |
| Phase 2 and Phase 3 write to same `integration/` folder                                                           | Filenames are distinct (`requestProxy.xml`, `gpgCli.xml`)                                                                                                                                                       |

---

## Phase 2 — GitHub Actions CI Integration

### Goal

Surface the JUnit XML files produced by Phase 1 in GitHub Actions: PR check status, PR comment
with pass/fail counts and delta vs base branch, per-failure annotations in the diff view, and
job summary — using the JUnit XML files produced by Phase 1.

---

### Action Selection

Three options were evaluated:

| Action                                     | Stars | Used by | Last release | Surfaces                                     | Cost                          |
| ------------------------------------------ | ----- | ------- | ------------ | -------------------------------------------- | ----------------------------- |
| `EnricoMi/publish-unit-test-result-action` | 735   | 17.2k   | Monthly      | PR comment, checks, annotations, job summary | Free / Apache-2.0             |
| `test-summary/action`                      | 437   | —       | 2 years ago  | Job summary only                             | Free / MIT                    |
| `codecov/basic-test-results`               | 6     | —       | Oct 2024     | PR comment only                              | Free / MIT (uses Codecov CLI) |

**Choice: `EnricoMi/publish-unit-test-result-action@v2`**

- Most widely deployed (17.2k dependent repos per GitHub network graph, 735 stars), actively maintained (v2.23.0, released last month)
- Provides the full complement of GitHub surfaces: PR check status, PR comment with pass/fail counts
  and delta vs base branch, per-failure annotations in the diff view, and job summary
- Explicitly tested against Mocha JUnit XML output
- Completely free and self-contained — no external service, no account, no token beyond `GITHUB_TOKEN`
- Apache-2.0 license

`test-summary/action` is ruled out: two years without a release, no PR checks or annotations,
job summary only. `codecov/basic-test-results` is ruled out: immature (6 stars, 1 release), PR
comment only, and shells out to the Codecov CLI.

---

### CI Context

The existing `ci.yml` structure:

```
checks job  →  test job  (only unit tests; integration tests require gpg-agent + devcontainer)
```

Key constraints:

- Workflow-level `permissions: {}` — all jobs start with zero token permissions
- The `test` job has `permissions: contents: read` only
- The project is a **public** repo — fork PRs trigger CI with a restricted `GITHUB_TOKEN`
  that cannot write checks or PR comments

The integration test suites are **not run in CI** — they require
a real `gpg-agent` and a devcontainer. Only the unit test XMLs are relevant here.

---

### Fork PR Support

For PRs from fork repositories, `GITHUB_TOKEN` in the CI workflow is restricted: `checks: write`
and `pull-requests: write` are not granted. A publish job inside `ci.yml` cannot post a check
or PR comment for fork PRs.

The solution is to move all publishing to a separate `workflow_run`-triggered workflow. This
workflow fires after the CI workflow completes and always runs in the context of the target
repository (not the fork), so `GITHUB_TOKEN` always carries the required write permissions.
The CI workflow passes test results and the GitHub event JSON to the publishing workflow via
artifacts — the event file gives the publishing workflow the PR number and commit SHA it needs
to associate results with the right PR.

This is the [documented pattern](https://github.com/EnricoMi/publish-unit-test-result-action#support-fork-repositories-and-dependabot-branches)
for `EnricoMi/publish-unit-test-result-action` and replaces the `publish-test-results` job
that would otherwise live inside `ci.yml`.

#### Security model

A fork contributor cannot escalate privileges by modifying workflow files in their PR.
`workflow_run` always executes the workflow file from the **default branch of the target
repository** — never from the fork or PR branch. GitHub resolves the workflow at trigger time
from the base repo. A fork PR that changes `.github/workflows/publish-test-results.yml` has
no effect on what runs.

This is the threat model `workflow_run` was designed to address, and why it exists as a
distinct trigger rather than a job inside `ci.yml`.

**Residual risk — test output injection:** JUnit XML files are produced by running the fork's
code. A contributor could craft test names or failure messages containing markdown or HTML
that gets rendered in the PR comment. The action sanitizes output for GitHub's rendering
engine, but the risk is worth noting. It is bounded by GitHub's requirement that a maintainer
approve the first CI run for any new fork contributor before any code executes.

---

### File Changes

#### 1. `.github/workflows/ci.yml` — `test` job: upload artifacts

Add two artifact upload steps at the **end of the `test` job, after the Codecov upload**.
`if: always()` ensures uploads happen even when tests fail — which is exactly when you most
need to see the results.

- Upload XML results (`test-results-unit`) with `if-no-files-found: error` — fails the step
  if no XML was written (e.g. CI cancelled before tests ran), preventing a phantom passing
  check from being posted downstream.
- Upload the GitHub event file (`github-event`) — no `if-no-files-found` needed; the runner
  always writes this file.
- Both steps use `actions/upload-artifact@v7` pinned to a full commit SHA. No permission
  changes needed — upload-artifact uses the runner service credential, not `GITHUB_TOKEN`.

---

#### 2. `.github/workflows/publish-test-results.yml` — new workflow

A new `workflow_run`-triggered workflow with two jobs:

**`publish-test-results` job** — fires after CI completes, always runs with the target repo's
token regardless of whether the triggering push came from a fork:

- `permissions: actions: read, checks: write, pull-requests: write`
- Downloads both artifacts (`test-results-unit`, `github-event`) from the triggering run
  using `actions/download-artifact@v8` with `run-id` and `github-token`
- Runs `EnricoMi/publish-unit-test-result-action@v2.23.0` with `id: publish`; passes
  `commit`, `event_file`, and `event_name` to associate results with the originating PR/commit
  rather than the default-branch commit that triggered `workflow_run`
- `check_name: Unit test results`, `comment_mode: changes`
- Exposes the action's `outputs.json` string as a job output for the badge job

**`update-badge` job** — see Badge section below.

The workflow also has:

- `permissions: {}` at workflow level — each job adds only what it needs
- `concurrency:` group keyed on `head_repository.full_name + head_branch` to cancel stale
  publish runs when a newer push to the same PR supersedes them (`github.ref` cannot be used
  here because in a `workflow_run` context it always resolves to the default branch)

---

### Action SHA Pinning

Project convention requires all action references pinned to a full commit SHA (with the
version tag as a comment). SHAs resolved at implementation time:

| Action                                     | Version | SHA                                        |
| ------------------------------------------ | ------- | ------------------------------------------ |
| `actions/upload-artifact`                  | v7.0.0  | `bbbca2ddaa5d8feaa63e36b76fdaad77386f024f` |
| `actions/download-artifact`                | v8.0.1  | `3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c` |
| `EnricoMi/publish-unit-test-result-action` | v2.23.0 | `c950f6fb443cb5af20a377fd0dfaa78838901040` |

The same `upload-artifact` SHA is used for both upload steps in `ci.yml`; the same
`download-artifact` SHA is used for both download steps in `publish-test-results.yml`.

To resolve a SHA for a future version update:

```bash
gh api repos/<owner>/<repo>/git/refs/tags/<tag> --jq '{sha: .object.sha, type: .object.type}'
```

If `type` is `"tag"` rather than `"commit"`, follow through `/git/tags/<sha>` to get the
underlying commit SHA.

---

### Implementation Order

1. ✅ Complete all of Phase 1.
2. ✅ Resolve SHAs for `actions/upload-artifact@v7`, `actions/download-artifact@v8.0.1`,
   and `EnricoMi/publish-unit-test-result-action@v2.23.0`.
3. ✅ Add the two `upload-artifact` steps (XML + event file) to the `test` job in `ci.yml`.
4. ✅ Create `.github/workflows/publish-test-results.yml` with `workflow_run` trigger,
   concurrency, `publish-test-results` job, and `update-badge` job.
5. ✅ Add unit test badge to `README.md`.
6. ✅ Push to a branch and open a PR to verify: check appears in PR checks tab, comment is
   posted, badge updates on merge to `main`.
7. ✅ Add `Unit test results` to the branch protection rule for `main` (must be done **after**
   step 6 so GitHub has seen the check name and offers it in the picker):
   **Settings → Branches → Edit rule for `main` → Require status checks → add `Unit test results`**
8. Open a PR from a fork to verify the same surfaces appear for fork contributors.

---

### What You Will See in GitHub

| Surface             | Description                                                                       |
| ------------------- | --------------------------------------------------------------------------------- |
| PR checks tab       | "Unit test results" check: `42 passed, 0 failed` with a link to details (new)     |
| PR checks tab       | `Pre-commit checks` and `Build and unit test` checks: already required, unchanged |
| PR comment          | Pass/fail counts, delta vs base branch (`5 tests ±0`), links to failures          |
| Commit annotations  | Per-failure annotation pointing at the test file line                             |
| Actions job summary | Pass/fail table with test names, visible directly on the workflow run page        |

---

### Badge — Shields.io via orphan `badges` branch

#### Goal

Display a live Shields.io badge in `README.md` beside the Codecov coverage badge. Three colors
driven by actual test results from the most recent `main` branch CI run:

- 🟢 green — all tests passed
- 🟡 yellow — tests passed but some were skipped
- 🔴 red — one or more test failures

#### Approach

An orphan `badges` branch holds a single file, `unit-tests.json`, which is a
[Shields.io endpoint JSON](https://shields.io/endpoint) object. `raw.githubusercontent.com`
serves it publicly at a stable URL. The `publish-test-results.yml` workflow writes an updated
JSON file and force-pushes to the `badges` branch after every successful main-branch CI run.

Artifacts are not suitable for this — they require authentication, expire, and their URLs
change per run.

A GitHub Gist would work but requires an external PAT with `gist` scope. The orphan branch
approach is entirely self-contained within the repo and requires only `contents: write` on the
`update-badge` job, which is isolated from the higher-privilege `publish-test-results` job.

#### Setup

No manual setup is required. The `update-badge` job in `publish-test-results.yml`
bootstraps the `badges` branch as an orphan automatically on the first run — if the branch
does not exist, the workflow creates it.

#### Badge JSON format

The Shields.io endpoint schema:

```json
{
  "schemaVersion": 1,
  "label": "Unit tests",
  "message": "42 passed",
  "color": "brightgreen"
}
```

Color mapping:

| Condition                | `color`       |
| ------------------------ | ------------- |
| failures > 0             | `red`         |
| skipped > 0, failed = 0  | `yellow`      |
| all passed, none skipped | `brightgreen` |

`message` is formatted as `N passed` or `N passed, M skipped` or `N failed` for clarity.

#### File changes

##### `publish-test-results.yml` — add `update-badge` job

Split the single job into two:

- The existing `publish-test-results` job gains an `outputs:` block exposing the full JSON
  string from the EnricoMi step (`steps.publish.outputs.json`), and the EnricoMi step itself
  gets `id: publish`.
- A new `update-badge` job depends on `publish-test-results` with `contents: write` in
  isolation. It receives the raw JSON string via an env var and parses `stats.tests_succ`,
  `stats.tests_fail`, `stats.tests_skip` with `jq` to derive color and message.
- The token is injected via `git config --global http.extraheader` rather than embedded in
  the remote URL — this keeps the credential out of URLs and `.git/config`.
- The bootstrap path (`git init -b badges` + `git remote add origin`) runs only on the
  very first push; subsequent runs `git clone --depth 1 --branch badges` instead.
- `git diff --cached --quiet && exit 0` skips the commit and push entirely when the badge
  JSON is identical to the previous run (same counts on a re-run).

##### `README.md` — add badge

Add beside the existing Codecov badge, pointing to the `badges` branch raw URL and linking
to the `publish-test-results.yml` workflow runs page.

#### Security notes

- `contents: write` is scoped to the `update-badge` job only. The `publish-test-results` job
  (which processes fork-supplied test output) never receives write access to repo contents.
- The badge JSON is constructed entirely from the EnricoMi action's numeric outputs
  (`tests_succ`, `tests_fail`, `tests_skip`), not from any test names or messages. No
  fork-supplied content reaches the badge — the test output injection risk documented above
  does not apply here.
- `github.token` is passed via `env:` (masked in logs by the runner) and set as an HTTP
  `Authorization` header on the git config, never stored in a remote URL.

---

## Phase 3 — Request Integration Tests in GitHub Actions CI

### Goal

Run `gpg-bridge-request` Phase 2 (request proxy chain: `requestProxyIntegration`) and Phase 3
(gpg CLI: `gpgCliIntegration`) integration tests in GitHub Actions CI — the same tests already
runnable locally via `npm --prefix gpg-bridge-request run test:integration`. Surface results
folded into the existing "Integration test results" check, same `integrationtests` Codecov flag,
same badge. No new reporting infrastructure required beyond a second artifact download step.

---

### Architecture differences from shared and agent integration tests

The request integration tests use a fundamentally different execution model:

- `@vscode/test-electron` launches VS Code with a `dev-container+` remote authority. The Dev
  Containers extension spins up a Docker container for the workspace extension host; the local
  extension host (gpg-bridge-agent) stays on the CI runner.
- Two runner files execute sequentially: `requestProxyRunTest.ts` → `gpgCliRunTest.ts`, chained
  by `&&` in the `test:integration` script.
- V8 JSON coverage data accumulates in `gpg-bridge-request/coverage/v8-integration/` on the
  host (bind-mounted from the container). `gpgCliRunTest.ts` (Phase 3, last runner) post-processes
  both phases' V8 JSON via c8, writing `gpg-bridge-request/coverage/integration/lcov.info` and
  `coverage-final.json`. The lcov path is `--reports-dir coverage/integration` relative to the
  request package root — `gpg-bridge-request/coverage/integration/lcov.info`.
- Docker must be available on the runner. ubuntu-latest has Docker pre-installed.

---

### Linux host compatibility analysis

The runners were written and tested on Windows. On ubuntu-latest every relevant transform is
either a no-op or produces the correct Linux result:

| Concern                            | Windows result                                              | Linux result                                      | Verdict |
| ---------------------------------- | ----------------------------------------------------------- | ------------------------------------------------- | ------- |
| `path.join().replace(/\\/g, '/')`  | Converts backslashes                                        | No-op (already POSIX)                             | ✓       |
| `.replace(/^([A-Za-z]):/, '/$1:')` | `C:\…` → `/C:/…`                                            | No-op (starts with `/`)                           | ✓       |
| `pathToFileURL(workspaceRoot)`     | `file:///C:/path/`                                          | `file:///home/runner/work/gpg-bridge/gpg-bridge/` | ✓       |
| Container → host path remap        | Substitutes `file:///workspaces/gpg-bridge/` → Windows path | Substitutes to Linux host path                    | ✓       |
| `source-map-cache` deletion        | Required (Windows rejects Linux `file://` URLs)             | Harmless — code comments confirm this explicitly  | ✓       |

No source changes to the runners are required.

**One required wrapping**: the `test:integration` npm script does not include `xvfb-run`. VS Code
Electron requires a display server on Linux. The CI job step must be:

```
xvfb-run -a npm --prefix gpg-bridge-request run test:integration
```

This is the same pattern used by the existing `integration-test` job for shared and agent.

---

### Container image caching via ghcr.io

**Problem**: `check-devcontainer.js` has no refresh cycle or staleness sentinel — every
invocation unconditionally runs `docker pull mcr.microsoft.com/devcontainers/javascript-node:22-trixie`.
On CI this downloads ~500 MB per phase. Two phases = up to ~1 GB of MCR pulls per run.
Additionally, `updateContentCommand` runs a full `npm install` inside each container on each
run — ~30–60 s per container with no npm cache.

**Solution: custom Dockerfile baking npm packages into the image**

A new `.devcontainer/Dockerfile` extends the MCR base image and pre-installs all npm packages
into `/opt/gpg-bridge-deps/` at image build time. Both phase 2 and phase 3 use the same
Dockerfile (same base image, same packages):

```dockerfile
FROM mcr.microsoft.com/devcontainers/javascript-node:22-trixie

WORKDIR /opt/gpg-bridge-deps
# Root package.json/package-lock.json are copied so npm understands the workspace structure
# when resolving the "file:../shared" dependency in gpg-bridge-request. The root
# devDependencies (@vscode/test-electron, @devcontainers/cli, etc.) run on the host,
# not inside the container, so the root packages are never installed here.
COPY package.json package-lock.json ./
COPY shared/package.json shared/package-lock.json ./shared/
COPY gpg-bridge-request/package.json gpg-bridge-request/package-lock.json ./gpg-bridge-request/

RUN cd shared && npm install && \
    cd ../gpg-bridge-request && npm install
```

Both `devcontainer.json` files switch from `"image":` to `"build":` with the Dockerfile
path, repo root as build context, and a `cacheFrom` pointing to the phase-specific ghcr.io tag:

```json
"build": {
  "dockerfile": "../Dockerfile",
  "context": "../..",
  "cacheFrom": "ghcr.io/diablodale/gpg-bridge/devcontainer-request:phaseN"
}
```

(Phase 2 uses `:phase2`; phase 3 uses `:phase3`. Same image today; independently versionable
if they diverge.)

**Local development**: `cacheFrom` is advisory — if the ghcr.io image is not present in the
local Docker daemon, Docker silently ignores it and builds from the `FROM mcr.microsoft.com/...`
base image as normal, pulling from MCR once and caching locally. No ghcr.io login or explicit
pull is required. Optionally, a developer can `docker pull ghcr.io/.../devcontainer-request:phase2`
once to seed the cache and skip even the npm layer on subsequent rebuilds.

**CI**: authenticate to ghcr.io; pull both phase-specific tags — VS Code Dev Containers then
runs `docker build` with `cacheFrom` pointing at the already-pulled image → 100% layer cache
hit → no rebuild, no network install.

In the `request-integration-test` CI job, before the test script runs:

1. Authenticate to ghcr.io using `docker/login-action`:
   ```yaml
   - name: Authenticate to ghcr.io
     uses: docker/login-action@b45d80f862d83dbcd57f89517bcf500b2ab88fb2 # v4.0.0
     with:
       registry: ghcr.io
       username: ${{ github.actor }}
       password: ${{ github.token }}
   ```
2. Pull pre-built images:
   ```
   docker pull ghcr.io/diablodale/gpg-bridge/devcontainer-request:phase2
   docker pull ghcr.io/diablodale/gpg-bridge/devcontainer-request:phase3
   ```
   No retag step needed — `devcontainer.json` references ghcr.io directly via `cacheFrom`.

Modify `scripts/check-devcontainer.js`: the `pullImage()` function reads the `image` field
from `devcontainer.json`. With the switch to `build:`, there is no `image` field —
`pullImage()` must gracefully skip when no `image` field is present. This covers both local
and CI cases; no separate `CI=true` guard is needed.

---

### node_modules inside the container

The custom Dockerfile bakes npm packages for `shared` and `gpg-bridge-request`
into `/opt/gpg-bridge-deps/` at image build time. `updateContentCommand` replaces the full
`npm install` with a fast `cp -a` that seeds the named volumes from the baked image layers:

```bash
sudo chown node:node \
  ${containerWorkspaceFolder}/node_modules \
  ${containerWorkspaceFolder}/shared/node_modules \
  ${containerWorkspaceFolder}/gpg-bridge-request/node_modules \
  ${containerWorkspaceFolder}/gpg-bridge-agent/node_modules && \
cp -a /opt/gpg-bridge-deps/shared/node_modules/. \
  ${containerWorkspaceFolder}/shared/node_modules/ && \
cp -a /opt/gpg-bridge-deps/gpg-bridge-request/node_modules/. \
  ${containerWorkspaceFolder}/gpg-bridge-request/node_modules/
```

The agent volume is left empty — it exists only to shadow the Windows host's junction-point
`node_modules` from the container. No agent code runs in the container.

The `@gpg-bridge/shared` symlink baked at
`/opt/gpg-bridge-deps/gpg-bridge-request/node_modules/@gpg-bridge/shared → ../../../shared`
resolves after `cp -a` to `/workspaces/gpg-bridge/shared` via the workspace bind mount. ✓

Named volumes remain necessary — they shadow the Windows host's `node_modules` directories,
which contain NTFS junction points that the Linux container cannot follow as POSIX symlinks.

---

### New CI job: `request-integration-test` (Job 4)

Location: `ci.yml`, after Job 3. `needs: [test]` — runs in parallel with `integration-test`.
Parallel is correct: no shared lcov files, no shared artifacts, no shared coverage data.

```
checks → test → integration-test         (shared + agent)
              → request-integration-test  (request phase 2 + phase 3)
```

Both integration jobs must complete before `publish-test-results.yml` surfaces results, which is
guaranteed because `workflow_run` fires only after the entire CI workflow finishes.

Steps:

1. Checkout (`persist-credentials: false`)
2. Node 22, **conditional npm cache** — `cache:` and `package-manager-cache:` are both gated on
   `github.ref != 'refs/heads/main'`. On `main` this job pushes to ghcr.io via
   `docker/build-push-action`: a poisoned npm cache entry (Cacheract-style pre-poisoning on the
   new `package-lock.json` hash) could run lifecycle scripts before the Docker push, corrupting
   the shared registry image. On PR branches the blast radius is limited to the ephemeral runner
   (no registry push), so caching is safe and avoids ~30–60 s extra install time on every PR.
   `package-manager-cache:` is the newer explicit control that supersedes the implicit caching
   behaviour; both inputs are set together for defence in depth.
   zizmor flags `setup-node` as a `cache-poisoning` finding because it cannot evaluate the
   conditional expression statically — a `# zizmor: ignore[cache-poisoning]` annotation is added
   to the `uses:` line with the runtime enforcement provided by the conditional values.
3. `npm install`
4. `npm run compile` — runner TypeScript files must be compiled before the pretest hooks invoke them
5. Authenticate to ghcr.io
6. Extract image metadata via `docker/metadata-action` (OCI labels, annotations, phase2/phase3 tags)
7. Build devcontainer image via `docker/build-push-action`:
   - `push: ${{ github.ref == 'refs/heads/main' }}` — pushes to ghcr.io on main only
   - `load: ${{ github.ref != 'refs/heads/main' }}` — loads into local daemon on PR branches
   - `cache-from: type=registry,ref=.../devcontainer-request:phase2` — layer cache from previous push
   - `cache-to: type=inline` — embeds cache metadata into the pushed manifest
   - On a full cache hit (no Dockerfile or package changes): ~10–30 s, no MCR download, no npm install
   - On a cache miss: affected layers rebuild; image is always correct for the current commit
8. Get week number + cache VS Code test binaries — both steps have `if: github.ref != 'refs/heads/main'`
   so they are skipped entirely on main. zizmor flags `actions/cache` after a publisher step regardless
   of `if:` conditions (static analysis); a `# zizmor: ignore[cache-poisoning]` annotation is added
   with the `if:` providing the actual runtime enforcement.
9. `xvfb-run -a npm --prefix gpg-bridge-request run test:integration` (both phases via `&&`)
10. Normalize lcov paths to repo-root-relative:
    ```
    sed -i 's|^SF:\.\./|SF:|' gpg-bridge-request/coverage/integration/lcov.info
    sed -i 's|^SF:src/|SF:gpg-bridge-request/src/|' gpg-bridge-request/coverage/integration/lcov.info
    ```
11. Upload to Codecov: `flags: integrationtests`, `name: integrationtests-request`,
    `files: gpg-bridge-request/coverage/integration/lcov.info`, `fail_ci_if_error: false`
12. `node scripts/rewrite-junit-paths.cjs` (`if: always()`)
13. Upload artifact `test-results-integration-request`:
    `gpg-bridge-request/test-results/integration/*.xml`, `if: always()`,
    `if-no-files-found: error`

A separate artifact name (`test-results-integration-request`) is used instead of sharing
`test-results-integration` with Job 3. upload-artifact v4+ supports merging concurrent uploads
to the same artifact name, but parallel jobs racing on the same artifact introduces avoidable
risk. Separate artifact names are simpler and allow independent failure diagnosis.

---

### Changes to `publish-test-results.yml`

`publish-integration-results` downloads `test-results-integration` today. One additional
download step is needed for `test-results-integration-request`. Both artifact sets are passed to
the same EnricoMi action invocation so all request, shared, and agent results appear in a single
"Integration test results" check, single PR comment, and unified count. No new job, no new check
name, no new badge.

The `update-badges` job is unchanged — the integration badge reflects the EnricoMi check totals,
which automatically include the request results once the download step is added.

---

### Workflow

This workflow was originally planned as a separate `push`-triggered workflow to build and
push the devcontainer image to ghcr.io. It was rejected in favour of building the image
inline in the `request-integration-test` job (see Job 4 above).

The rejected separate workflow running in parallel with CI suffers an N-1 false-pass
risk — if a package change in commit N regresses container-side tests, CI runs against N-1
packages and false-passes. Building inline in Job 4 eliminates this: the image is always
built from the current commit before tests run.

`docker/metadata-action` was previously used only in this workflow; it is now used in Job 4.

---

### Action SHA pinning

All action references are pinned to a full commit SHA (with the version tag as a comment).
SHAs resolved at implementation time:

| Action                     | Version | SHA                                        |
| -------------------------- | ------- | ------------------------------------------ |
| `docker/login-action`      | v4.0.0  | `b45d80f862d83dbcd57f89517bcf500b2ab88fb2` |
| `docker/metadata-action`   | v6.0.0  | `030e881283bb7a6894de51c315a6bfe6a94e05cf` |
| `docker/build-push-action` | v7.0.0  | `d08e5c354a6adb9ed34480a06d141179aa583294` |

All three are used in `ci.yml` Job 4. Resolve updated SHAs with:

```bash
gh api repos/docker/<action>/git/refs/tags/<tag> --jq '{sha: .object.sha, type: .object.type}'
```

---

### File changes summary

| File                                         | Change                                                                                                                 |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `.devcontainer/Dockerfile`                   | New: extends MCR base image, bakes npm packages into `/opt/gpg-bridge-deps/`                                           |
| `.devcontainer/phase2/devcontainer.json`     | Switch `image:` → `build:` with `cacheFrom: .../devcontainer-request:phase2`; update `updateContentCommand` to `cp -a` |
| `.devcontainer/phase3/devcontainer.json`     | Same as phase 2; uses `:phase3` tag                                                                                    |
| `.github/workflows/ci.yml`                   | Add `request-integration-test` job (Job 4, `needs: [test]`) with inline image build+push                               |
| `.github/workflows/publish-test-results.yml` | Add download step for `test-results-integration-request` in `publish-integration-results`                              |
| `scripts/check-devcontainer.js`              | Skip `pullImage()` gracefully when no `image:` field present (i.e. `build:` is used)                                   |
| `scripts/rewrite-junit-paths.cjs`            | No change — already iterates all packages and `integration/` subdir                                                    |
| `README.md`                                  | No change — existing integration badge covers all packages                                                             |

---

### Implementation order

1. ✅ Phase 1 and Phase 2 of this plan complete.
2. Create `.devcontainer/Dockerfile`. Update both `devcontainer.json` files to use `build:` with
   `cacheFrom` and replace `updateContentCommand` with `cp -a`.
3. ✅ Modify `scripts/check-devcontainer.js` to skip `pullImage()` gracefully when no `image:`
   field is present (`build:` configs skip pull; `removeExistingContainer()` still runs).
4. ✅ Add `request-integration-test` job to `ci.yml` with inline image build steps.
5. ✅ Update `publish-integration-results` in `publish-test-results.yml` to download both artifacts.
6. Push to a CI branch; verify both devcontainer phases start and run to completion.
7. Verify all request integration results appear in the "Integration test results" PR check
   alongside shared and agent results.
8. Verify Codecov receives request integration lcov under `integrationtests` flag and merges
   into the union coverage.
9. After first passing CI run on `main`, verify the integration badge reflects the combined totals.

---

### Risks and mitigations

| Risk                                                                        | Mitigation                                                                                                                                     |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------------------------------------------------------------- | --------------------------------------------------------- |
| Linux host compat: runners never tested on Linux host                       | Analysis confirms all transforms are no-ops or correct on Linux; verify at step 6                                                              |
| Container startup time: two `devcontainer up` calls per run (~30–90 s each) | ghcr.io layer cache eliminates ~500 MB MCR download; container creation time is unaffected                                                     |
| node_modules install per container per run                                  | Baked into image at `/opt/gpg-bridge-deps/`; `updateContentCommand` uses `cp -a` to seed named volumes — no network install at container start |
| docker build overhead on every CI run                                       | Full layer cache hit when nothing changed: ~10–30 s. Acceptable vs. the alternative of N-1 false-pass risk from a separate workflow            |
| PR branch poisoning ghcr.io shared cache image                              | `push:` gated on `refs/heads/main`; PRs use `load:` only. Fork PRs additionally have `packages: write` stripped by GitHub at the API level     |     | npm cache poisoning via Cacheract-style pre-poisoning | `cache:` and `package-manager-cache:` both gated on `github.ref != refs/heads/main` in `setup-node`. VS Code binary cache (`actions/cache`) also skipped on main via `if:`. PR branches use all caches safely — blast radius is the ephemeral runner only, not ghcr.io. Cost on `main`: ~30–60 s extra npm install + ~167 MB VS Code download per run |     | Phase 2 V8 JSON cleared by `requestProxyRunTest` on every run | Correct by design — ensures no stale data from prior runs |
| Phase 3 c8 skipped if Phase 2 exits abnormally (no V8 JSON files)           | lcov absent → normalize step is no-op; Codecov has `fail_ci_if_error: false`; JUnit XML still uploaded if tests ran before crash               |
| Parallel Codecov uploads with same `flags: integrationtests`                | Codecov merges multiple per-commit per-flag uploads — this is the intended use                                                                 |
| ghcr.io cache stale after MCR releases a new image                          | `workflow_dispatch` on Job 4 (or any push to main) will rebuild with updated base; adding a weekly schedule cron is a simple future addition   |
| Dev Containers extension install requires network on every run              | ~5 s; no mitigation; always fresh install into test profile                                                                                    |
