# "Run All" executes only the collation-first config's tests from a `defineConfig([...])` array with multiple configs

- Extension: `ms-vscode.extension-test-runner`
- CLI package: `@vscode/test-cli`
- <https://github.com/microsoft/vscode-extension-test-runner/issues/90>

## Description

When `.vscode-test.cjs` exports a `defineConfig([...])` array with multiple named configurations, VS Code Test Explorer shows all configurations in the test tree, but clicking **Run All** (or using the default run profile) only executes tests for **one** of the configs — the others are silently skipped.

## Setup

- `ms-vscode.extension-test-runner` v0.0.14
- `vscode/test-cli` v0.0.12
- VS Code on Windows
  ```
  Version: 1.112.0 (system setup)
  Commit: 07ff9d6178ede9a1bd12ad3399074d726ebe6e43
  Date: 2026-03-17T18:09:23Z
  Electron: 39.8.0
  ElectronBuildId: 13470701
  Chromium: 142.0.7444.265
  Node.js: 22.22.0
  V8: 14.2.231.22-electron.0
  OS: Windows_NT x64 10.0.26200
  ```

## Repro

Minimal `.vscode-test.cjs` demonstrating the issue. Both labels appear as separate nodes in the Test Explorer tree, each with their own Run / Debug / Coverage profile.

```js
const { defineConfig } = require('@vscode/test-cli');

module.exports = defineConfig([
  {
    label: 'Unit tests',
    files: 'out/test/*.test.js',
    workspaceFolder: './fixtures/workspace',
    mocha: { timeout: 10000 },
  },
  {
    label: 'Integration tests',
    files: 'out/test/integration/*.test.js',
    workspaceFolder: './fixtures/workspace',
    mocha: { timeout: 60000 },
  },
]);
```

1. Create `.vscode-test.cjs` exporting a `defineConfig([...])` array with two or more named configs (as above).
2. Open VS Code with the workspace. Both config groups appear in the Test Explorer.
3. Click the **Run All** button (▶ at the top of the Test Explorer panel), or invoke **Test: Run All Tests** from the Command Palette.

## Actual Behavior

Only the tests belonging to one config are executed. The other config's tests show no run result — no pass, no fail, no "skipped" indicator. The second runner process is never launched.

## Expected Behavior

All configs in the array should be executed, matching the behaviour of running `vscode-test --label "Unit tests"` and `vscode-test --label "Integration tests"` separately from the CLI.

## Root Cause

**The root cause is `getDefaultProfileForTest()` using `.find()`, which returns only the first matching profile.** When `RunAllAction` dispatches the `TestController`'s root item(s), tag-based filtering is bypassed for roots so every default profile matches equally. Profiles are sorted by label using locale-sensitive collation (ICU / `localeCompare`), so the label that collates earliest wins and only its run handler fires. All other configs are silently skipped.

The numbered points below trace the data flow that reaches this decision point.

### 1. One `Controller` is created per `.vscode-test.cjs` file — array size is irrelevant

[`extension.ts`](https://github.com/microsoft/vscode-extension-test-runner/blob/8ba3b5f070dd10e6ebd6cd28d38e2dc5cca32a5e/src/extension.ts#L43-L59) calls `vscode.workspace.findFiles` to enumerate config files, then creates **one** `vscode.tests.createTestController` and **one** `new Controller(...)` per file found. The number of entries in the exported array plays no part in this loop — a single `.vscode-test.cjs` file always yields exactly one `TestController`.

### 2. `applyRunHandlers` registers every array config as `isDefault: true`

[`controller.ts applyRunHandlers()`](https://github.com/microsoft/vscode-extension-test-runner/blob/8ba3b5f070dd10e6ebd6cd28d38e2dc5cca32a5e/src/controller.ts#L289) iterates over all array entries and, [for each one calls](https://github.com/microsoft/vscode-extension-test-runner/blob/8ba3b5f070dd10e6ebd6cd28d38e2dc5cca32a5e/src/controller.ts#L342-L351)

```ts
const profiles = {
  run: this.ctrl.createRunProfile(name, vscode.TestRunProfileKind.Run, doRun, true),
  debug: this.ctrl.createRunProfile(name, vscode.TestRunProfileKind.Debug, doDebug, true),
  cover: this.ctrl.createRunProfile(name, vscode.TestRunProfileKind.Coverage, doCoverage, true),
};
```

The fourth argument is `isDefault`. Every array config is registered as a default profile — this is what puts all of them in the pool that `RunAllAction` draws from.

### 3. `RunAllAction` dispatches root items to `runTests()`, which selects ONE profile via `.find()`

[`RunAllAction`](https://github.com/microsoft/vscode/blob/4a0c7fcf30fb395c1afbcc7c97eb495121ef9f5e/src/vs/workbench/contrib/testing/browser/testExplorerActions.ts#L638-L651) collects the controller's root items and hands them to `testService.runTests()`:

```ts
const roots = [...testService.collection.rootItems].filter(...);
await testService.runTests({ tests: roots, group: this.group });
```

Inside [`runTests`](https://github.com/microsoft/vscode/blob/7ddad41db54a75b325e661253cc803794b24a03a/src/vs/workbench/contrib/testing/common/testServiceImpl.ts#L154-L174), for each test item the function calls [`getDefaultProfileForTest(group, test)`](https://github.com/microsoft/vscode/blob/4a0c7fcf30fb395c1afbcc7c97eb495121ef9f5e/src/vs/workbench/contrib/testing/common/testProfileService.ts#L310-L312) — **this is the root cause trigger:**

```ts
return this.getControllerProfiles(test.controllerId).find(
  (p) => (p.group & group) !== 0 && canUseProfileWithTest(p, test),
);
```

**`.find()` returns exactly one result.** For root items, `canUseProfileWithTest` passes for every profile unconditionally, because the `TestId.isRoot` guard bypasses tag checks with [`canUseProfileWithTest`](https://github.com/microsoft/vscode/blob/4a0c7fcf30fb395c1afbcc7c97eb495121ef9f5e/src/vs/workbench/contrib/testing/common/testProfileService.ts#L89-L91)

```ts
profile.controllerId === test.controllerId &&
  (TestId.isRoot(test.item.extId) || !profile.tag || test.item.tags.includes(profile.tag));
```

Profiles are kept sorted at all times by [`sorter`](https://github.com/microsoft/vscode/blob/b5370055bf00ff6ffaa24604043ea77fd94091dd/src/vs/workbench/contrib/testing/common/testProfileService.ts#L92-L98) — `isDefault: true` entries first, then by `label.localeCompare(label)`:

```ts
const sorter = (a: ITestRunProfile, b: ITestRunProfile) => {
  if (a.isDefault !== b.isDefault) {
    return a.isDefault ? -1 : 1;
  }
  return a.label.localeCompare(b.label);
};
```

`sorter` is applied in three places, ensuring the array stays ordered after any mutation:

- [L166](https://github.com/microsoft/vscode/blob/b5370055bf00ff6ffaa24604043ea77fd94091dd/src/vs/workbench/contrib/testing/common/testProfileService.ts#L166) — **on profile registration**: each call to `createRunProfile()` pushes the new profile then immediately re-sorts the array.
- [L192](https://github.com/microsoft/vscode/blob/b5370055bf00ff6ffaa24604043ea77fd94091dd/src/vs/workbench/contrib/testing/common/testProfileService.ts#L192) — **on profile update**: re-sorts after `isDefault` or label is mutated post-creation.
- [L303](https://github.com/microsoft/vscode/blob/b5370055bf00ff6ffaa24604043ea77fd94091dd/src/vs/workbench/contrib/testing/common/testProfileService.ts#L303) — **on user-default reconciliation**: re-sorts after VS Code syncs user-set defaults across profile groups.

Because `sorter` is applied at every mutation point, by the time `getDefaultProfileForTest()` calls `.find()` at [L311](https://github.com/microsoft/vscode/blob/b5370055bf00ff6ffaa24604043ea77fd94091dd/src/vs/workbench/contrib/testing/common/testProfileService.ts#L311) the array is guaranteed to be in `sorter` order. Since every array config is a default, they all sit in the same `isDefault: true` tier, ranked only by `localeCompare`. `.find()` stops at the first match — the locale-collation-earliest label — and only that profile's run handler fires.

> **Note on `localeCompare` vs. ASCII order:** In Unicode/ICU collation, punctuation and symbols sort _before_ letters — the opposite of raw char-code comparison.

### 4. Per-config launch parameters (`extensionDevelopmentPath`, `workspaceFolder`) are resolved at run time, not at profile creation time

It might appear that different `workspaceFolder` or `extensionDevelopmentPath` values per config entry could require a distinct default profile — they do not. These values are consumed by `@vscode/test-cli` **after** the profile's run handler is invoked:

- [`desktop.mts`](https://github.com/microsoft/vscode-test-cli/blob/cde90913ab436b85642519f4b42411358971412a/src/cli/platform/desktop.mts#L32-L33): `workspaceFolder` is appended to `launchArgs` inside `DesktopPlatform.prepare()`, which is called at the moment the test run starts, not during profile registration.

- [`config.mts`](https://github.com/microsoft/vscode-test-cli/blob/cde90913ab436b85642519f4b42411358971412a/src/cli/config.mts#L117-L118): `extensionDevelopmentPath()` defaults to `this.dir` and is passed to [`electron.runTests`](https://github.com/microsoft/vscode-test-cli/blob/cde90913ab436b85642519f4b42411358971412a/src/cli/platform/desktop.mts#L96-L101) only when the run handler fires.

None of these paths touch `createRunProfile` or influence which profile VS Code treats as the default.

### 5. This extension's own repo is unaffected in CI

The `vscode-extension-test-runner` repo's own [`.vscode-test.mjs`](https://github.com/microsoft/vscode-extension-test-runner/blob/8ba3b5f070dd10e6ebd6cd28d38e2dc5cca32a5e/.vscode-test.mjs#L11-L29) uses a `defineConfig([...])` array. Its CI [`pipeline.yml`](https://github.com/microsoft/vscode-extension-test-runner/blob/8ba3b5f070dd10e6ebd6cd28d38e2dc5cca32a5e/pipeline.yml#L36) runs:

```sh
npm run test   # → vscode-test  (no --label flag)
```

Using `vscode-test` CLI with no `--label` argument executes **all** array configs sequentially and correctly — the bug only manifests when VS Code's Test Explorer UI dispatches a **Run All** via `runTests()`. Because CI never drives Test Explorer, the bug is invisible in the CI pipeline.

## Fixes

### Option A — Fix in `vscode-extension-test-runner` (preferred)🥇

Register a single `isDefault: true` **"run all" profile** that invokes `vscode-test` with no `--label` argument (which runs every config in the array sequentially). The per-config profiles should be registered as `isDefault: false` so they remain individually selectable but do not compete during **Run All**.

```ts
// controller.ts — proposed fix

// 1. One default "run everything" profile
const runAllProfiles = {
  run: this.ctrl.createRunProfile('Run all', vscode.TestRunProfileKind.Run, doRunAll, true),
  debug: this.ctrl.createRunProfile('Run all', vscode.TestRunProfileKind.Debug, doDebugAll, true),
  cover: this.ctrl.createRunProfile(
    'Run all',
    vscode.TestRunProfileKind.Coverage,
    doCoverAll,
    true,
  ),
};
// doRunAll / doDebugAll / doCoverAll call `vscode-test` with no --label flag

// 2. Per-config profiles (isDefault: false) for individual selection
for (const [index, { config }] of configs.value.entries()) {
  // ...
  const profiles = {
    run: this.ctrl.createRunProfile(name, vscode.TestRunProfileKind.Run, doRun, false),
    debug: this.ctrl.createRunProfile(name, vscode.TestRunProfileKind.Debug, doDebug, false),
    cover: this.ctrl.createRunProfile(name, vscode.TestRunProfileKind.Coverage, doCoverage, false),
  };
  // ...
}
```

The root cause is that **Run All** passes the controller's root item to `runTests`, which calls `getDefaultProfileForTest` (a `.find()` returning one result). Tag-based routing is bypassed for root items. With a single default "run all" profile and per-config profiles as non-defaults, `.find()` always selects the correct one and every config's tests are executed.

### Option B — Fix in VS Code (`microsoft/vscode`) 🥈

The bug is also fixable on the VS Code side by changing `runTests` to dispatch a test item against **all** matching default profiles instead of just the first.

Currently in [`testServiceImpl.ts`](https://github.com/microsoft/vscode/blob/983f73d5c8518b0523778c7cc62165617974d56d/src/vs/workbench/contrib/testing/common/testServiceImpl.ts#L154-L171):

```ts
// current — picks one profile per test
const bestProfile = this.testProfiles.getDefaultProfileForTest(req.group, test);
if (!bestProfile) {
  continue;
}
byProfile.push({ profile: bestProfile, tests: [test] });
```

[`getDefaultProfileForTest`](https://github.com/microsoft/vscode/blob/16a412841128a8cf606998c881e75058275225d3/src/vs/workbench/contrib/testing/common/testProfileService.ts#L310-L312) is:

```ts
// .find() returns the first match
return this.getControllerProfiles(test.controllerId).find(
  (p) => (p.group & group) !== 0 && canUseProfileWithTest(p, test),
);
```

Profiles are sorted `isDefault: true` first, then alphabetically — so the first alphabetical default always wins.

A VS Code fix would change the loop to collect **all** matching default profiles and push one bucket per profile:

```ts
// proposed VS Code change
const defaultProfiles = this.testProfiles
  .getControllerProfiles(test.controllerId)
  .filter((p) => p.isDefault && (p.group & req.group) !== 0 && canUseProfileWithTest(p, test));

for (const profile of defaultProfiles.length ? defaultProfiles : [fallbackProfile]) {
  const bucket = byProfile.find((b) => b.profile === profile);
  if (bucket) {
    bucket.tests.push(test);
  } else {
    byProfile.push({ profile, tests: [test] });
  }
}
```

**Trade-off:** This is a broader semantic change. Any extension that registers multiple `isDefault: true` profiles for a single `TestController` would now run the test with _all_ of them on **Run All**, not just the first. Extensions that do this deliberately (e.g., running tests under multiple Node versions) would experience a change in behavior. Option A is therefore lower-risk as a first fix.

## Workarounds

### 1. Run each config individually from Test Explorer UI

Each array config appears as its own named node in the Test Explorer tree with its own Run profile. Click **Run** (▶) on each config's node directly instead of using the top-level **Run All** button. This is reliable but manual.

### 2. Don't use Test Explorer UI. Use `vscode-test` directly from the CLI / npm scripts

The `vscode-test` CLI with no `--label` flag runs **all** array configs sequentially and correctly — the bug is a Test Explorer UI concern only. Add a script that invokes the CLI directly:

```jsonc
// package.json
"scripts": {
  "test:all": "vscode-test"
}
```

If you also want per-config scripts (e.g. to run only unit tests in a fast inner loop), use `--label` to target a specific config:

```jsonc
"scripts": {
  "test":             "vscode-test --label \"Unit tests\"",
  "test:integration": "vscode-test --label \"Integration tests\"",
  "test:all":         "vscode-test"
}
```
