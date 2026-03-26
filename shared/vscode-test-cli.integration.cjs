// CLI test configuration for the shared package's INTEGRATION tests.
// Used by `npm run test:integration` via `vscode-test --config vscode-test-cli.integration.cjs`.
//
// Separate from vscode-test-cli.cjs so that coverage writes to coverage/integration/
// instead of coverage/, avoiding collision with unit test coverage files.
//
// This file is intentionally NOT named .vscode-test.cjs so that the VS Code Extension
// Test Runner does not discover it (its workspace.findFiles pattern only matches .vscode-test.*).
// The root-level .vscode-test.cjs is the single source of truth for the Test Explorer UI.

const path = require('path');
process.env.JUNIT_OUTPUT_FILE = path.resolve(__dirname, 'test-results/integration/results.xml');

const { defineConfig } = require('@vscode/test-cli');

module.exports = defineConfig({
  tests: [
    {
      label: 'Shared 2: integration tests',
      // Integration tests live in out/test/integration/ — require real gpg on PATH.
      files: 'out/test/integration/*.test.js',
      mocha: {
        ui: 'bdd',
        // Key generation and GPG subprocess startup can be slow; allow up to 60s.
        timeout: 60000,
        reporter: require.resolve('./junit-spec.cjs'),
      },
      launchArgs: ['--disable-extensions'],
    },
  ],
  coverage: {
    // Do NOT set includeAll: true — see comment in vscode-test-cli.cjs for the full explanation.
    //
    // Exclude test infrastructure files; they are not production code.
    // Patterns match absolute paths (c8's relativePath: false) so ** prefix is required.
    exclude: ['**/test/**'],
    // 'text' prints a per-file table to stdout (visible in CLI and CI logs).
    // 'lcov' writes coverage/integration/lcov.info for tooling (Codecov, etc.).
    // 'json' writes coverage/integration/coverage-final.json.
    reporter: ['text', 'lcov', 'json'],
    // Write to a dedicated integration subdirectory.
    // vscode-test bug https://github.com/microsoft/vscode-test-cli/issues/38
    // @vscode/test-cli ignores `output` field at runtime
    // only reads --coverage-output on the CLI, therefore it is present
    // in test:integration (package.json).
  },
});
