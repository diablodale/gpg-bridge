// Root-level test configuration for VS Code Test Explorer.
//
// Why this exists (and why the per-package configs use a non-standard filename):
//
// The VS Code Extension Test Runner creates one TestRun per discovered config file.
// When "Run All with Coverage" executes multiple configs sequentially, each new TestRun
// overwrites the IstanbulCoverageContext loadDetailedCoverage binding for the previous
// run — only the last completed TestRun shows inline editor coverage decorators.
//
// Consolidating all three packages into a single config means one TestRun and one
// IstanbulCoverageContext.apply() call, so inline coverage decorators work for every
// source file across the whole project.
//
// CLI usage: each package's `npm test` script uses `vscode-test --config vscode-test-cli.cjs`.
// Those files are intentionally NOT named .vscode-test.cjs so the Extension Test Runner's
// workspace.findFiles pattern (**/.vscode-test.*) does not discover them — no duplicate
// profiles, no settings.json tricks needed. This root config is ONLY used by VS Code Test Explorer.

const { defineConfig } = require('@vscode/test-cli');

module.exports = defineConfig({
  tests: [
    {
      label: 'All unit tests',

      // Globs are relative to this config file (workspace root).
      // Non-recursive: only the top-level out/test/ files (excludes integration/).
      files: [
        'shared/out/test/*.test.js',
        'gpg-bridge-agent/out/test/*.test.js',
        'gpg-bridge-request/out/test/*.test.js',
      ],
      mocha: {
        ui: 'bdd',
        // Use the longest timeout from across all packages (agent/request use 120 s).
        timeout: 120000,
      },
      launchArgs: [
        // Prevent other extensions from activating during tests.
        '--disable-extensions',
      ],
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
    // 'lcov' writes coverage/unit/lcov.info for tooling (Codecov, VS Code extensions, etc.).
    // 'json' writes coverage/unit/coverage-final.json required by ms-vscode.extension-test-runner
    // for inline source-level coverage decorators in the VS Code editor.
    reporter: ['text', 'lcov', 'json'],
    output: 'coverage/unit',
  },
});
