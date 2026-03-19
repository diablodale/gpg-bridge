// CLI-only test configuration for the shared package.
// Used by `npm test` in this directory via `vscode-test --config vscode-test-cli.cjs`.
//
// This file is intentionally NOT named .vscode-test.cjs so that the VS Code Extension Test
// Runner does not discover it (its workspace.findFiles pattern only matches .vscode-test.*).
// The root-level .vscode-test.cjs is the single source of truth for the Test Explorer UI.

const { defineConfig } = require('@vscode/test-cli');

module.exports = defineConfig({
  tests: [
    {
      // Label prefix "1:" ensures this config wins "Run All" in Test Explorer (localeCompare
      // sorts digits before letters, so it beats "2: integration tests" which requires real gpg).
      // external bug https://github.com/microsoft/vscode-extension-test-runner/issues/90
      label: 'Shared 1: unit tests',

      // Use a non-recursive glob so only unit test files at the top of out/test/ are included.
      files: 'out/test/*.test.js',
      mocha: {
        ui: 'bdd',
        timeout: 10000,
      },
      launchArgs: [
        // Prevent other extensions from activating during tests.
        '--disable-extensions',
      ],
    },
    {
      label: 'Shared 2: integration tests',
      // Integration tests live in out/test/integration/ — require real gpg on PATH.
      files: 'out/test/integration/*.test.js',
      mocha: {
        ui: 'bdd',
        // Key generation and GPG subprocess startup can be slow; allow up to 60 s.
        timeout: 60000,
      },
      launchArgs: ['--disable-extensions'],
    },
  ],
  coverage: {
    // Do NOT set includeAll: true — on Windows, c8 scans the src directory using Node.js
    // module-resolution paths (uppercase C:\) and creates zero-stmt entries with uppercase
    // keys in coverage-final.json, while V8 coverage records scripts with lowercase c:\ keys.
    // VS Code's extension-test-runner registers the uppercase (zero-stmt) entry for the open
    // file and loadDetailedCoverage returns nothing → no inline decorators. Omitting includeAll
    // means only V8-derived entries (consistent lowercase c:\) appear; VS Code normalizes both
    // to file:///c:/... so the URI match succeeds and inline decorators work.
    //
    // Exclude test infrastructure files; they are not production code.
    // Patterns match absolute paths (c8's relativePath: false) so ** prefix is required.
    exclude: ['**/test/**'],
    // 'text' prints a per-file table to stdout (visible in CLI and CI logs).
    // 'lcov' writes coverage/lcov.info for tooling (Codecov, VS Code extensions, etc.).
    // 'json' writes coverage/coverage-final.json required by ms-vscode.extension-test-runner
    // for inline source-level coverage decorators in the VS Code editor.
    reporter: ['text', 'lcov', 'json'],
  },
});
