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

1. Upgrade `mocha` from `^10.5.0` to `^11` in `gpg-bridge-agent/package.json`,
   `gpg-bridge-request/package.json`, and `shared/package.json`. Also add
   `mocha-junit-reporter: "^2.2.1"` to `shared/package.json` devDependencies. Run
   `npm install` from repo root.
2. Create `shared/junit-spec.cjs`.
3. Update `.gitignore`.
4. Update the four `vscode-test-cli*.cjs` config files (no TypeScript compilation needed).
5. Update `gpg-bridge-agent` integration runner and suite (`runTest.ts`, `suite/index.ts`).
6. Update `gpg-bridge-request` integration runners and suites (both `runTest` files, both suite index files).
7. Optionally update root `clean` script.
8. Run `npm run compile` then `npm test` to verify unit tests produce XML and keep color output.
9. Run each integration suite manually to verify XML output.

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
6. Push to a branch and open a PR to verify: check appears in PR checks tab, comment is
   posted, badge updates on merge to `main`.
7. Add `Unit test results` to the branch protection rule for `main` (must be done **after**
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
