// CLI-only test configuration for the gpg-bridge-request package.
// Used by `npm test` in this directory via `vscode-test --config vscode-test-cli.cjs`.
//
// This file is intentionally NOT named .vscode-test.cjs so that the VS Code Extension Test
// Runner does not discover it (its workspace.findFiles pattern only matches .vscode-test.*).
// The root-level .vscode-test.cjs is the single source of truth for the Test Explorer UI.

const { defineConfig } = require('@vscode/test-cli');

module.exports = defineConfig({
  tests: [
    {
      label: 'Request unit tests',
      // Integration tests live in out/test/integration/ and run only via `npm run test:integration`.
      // Use a non-recursive glob so only unit test files at the top of out/test/ are included.
      files: 'out/test/*.test.js',
      mocha: {
        ui: 'bdd',
        // Keep parity with launch.json to avoid test runner timeouts.
        timeout: 120000,
      },
      launchArgs: [
        // Prevent other extensions from activating during tests.
        '--disable-extensions',
      ],
      // Skip extension dependencies install of agent-proxy during request-proxy unit tests.
      skipExtensionDependencies: true,
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
    // Exclude test infrastructure from coverage measurement.
    // Patterns match absolute paths (c8's relativePath: false) so ** prefix is required.
    exclude: ['**/test/**'],
    // 'text' prints a per-file table to stdout (visible in CLI and CI logs).
    // 'lcov' writes coverage/unit/lcov.info for tooling (Codecov, VS Code extensions, etc.).
    // 'json' writes coverage/unit/coverage-final.json required by ms-vscode.extension-test-runner
    // for inline source-level coverage decorators in the VS Code editor.
    reporter: ['text', 'lcov', 'json'],
  },
});
