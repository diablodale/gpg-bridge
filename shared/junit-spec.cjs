'use strict';

// Combined Spec + JUnit reporter for all test suites in this project.
//
// Extends Mocha's built-in Spec reporter directly so it receives the real runner
// object at construction time. Mocha.reporters.Base stores `color: true` on the
// runner it is given; extending Spec ensures ANSI color codes are preserved.
//
// mocha-multi-reporters passes a shim EventEmitter as the runner to each
// sub-reporter; that shim does not carry the `color` flag, causing ANSI codes
// to be dropped. This file avoids that by attaching mocha-junit-reporter as a
// second listener on the same (real) runner, not via a multi-reporters shim.
//
// Usage: set JUNIT_OUTPUT_FILE to an absolute path before launching tests.
// If JUNIT_OUTPUT_FILE is absent this file behaves as a pure Spec reporter.

const Mocha = require('mocha');
const JUnit = require('mocha-junit-reporter');
const Spec = Mocha.reporters.Spec;

module.exports = class JunitSpec extends Spec {
  constructor(runner, options) {
    // Our mocha (shared/node_modules/mocha) is a separate module instance from the
    // runner's mocha (@vscode/test-cli's mocha). Each has its own Base.useColors,
    // initialized at require time from process.stdout.isTTY — which is false inside
    // the VS Code extension host even when the terminal is a real TTY.
    // Mirror options.color (set by @vscode/test-cli from supportsColor.stdout) into
    // our Base.useColors so color behavior matches what the caller requested.
    /* c8 ignore next */
    Mocha.reporters.Base.useColors = options?.color ?? process.stdout.isTTY ?? false;
    super(runner, options); // Spec receives the real runner → color flag preserved
    const outFile = process.env.JUNIT_OUTPUT_FILE;
    if (outFile) {
      new JUnit(runner, { reporterOptions: { mochaFile: outFile, includePending: true } }); // second listener on same runner
    }
  }
};
