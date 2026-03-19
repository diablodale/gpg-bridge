const { defineConfig } = require('@vscode/test-cli');

module.exports = defineConfig([
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
]);
