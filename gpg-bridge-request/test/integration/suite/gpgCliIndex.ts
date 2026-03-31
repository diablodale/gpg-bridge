/**
 * Mocha entry point for Phase 3 integration tests.
 *
 * Loaded by @vscode/test-electron as extensionTestsPath. Must export run().
 * Loads gpgCliIntegration.test.js explicitly rather than globbing so that
 * Phase 2 test files in the same output directory are not accidentally loaded
 * (Phase 3's container has gnupg2; Phase 2's does not need it, but the reverse
 * isolation — preventing phase3 from running in phase2's container — is the
 * primary concern. See suite/index.ts for the symmetric note from the other side).
 *
 * Timeout is 120 s: sign/decrypt operations go through the full proxy chain
 * (gpg → Unix socket → request-proxy → VS Code commands → agent-proxy → gpg-agent).
 * Large-file encrypt+decrypt (256 KB binary, PKDECRYPT) is the slowest case.
 */

import * as path from 'path';
import * as v8 from 'v8';
import Mocha = require('mocha');

export function run(): Promise<void> {
  // __dirname = out/test/integration/suite/ at runtime (inside container).
  // Set JUNIT_OUTPUT_FILE here so junit-spec.cjs activates; extensionTestsEnv
  // from @vscode/test-electron does not propagate into the remote extension host.
  const repoRoot = path.resolve(__dirname, '../../../../..');
  process.env.JUNIT_OUTPUT_FILE = path.join(
    repoRoot,
    'gpg-bridge-request/test-results/integration/gpgCli.xml',
  );

  const mocha = new Mocha({
    ui: 'bdd',
    color: true,
    timeout: 120000, // 120 s — full chain crypto ops + 1 MB sign stress test
    reporter: path.join(repoRoot, 'shared/junit-spec.cjs'),
  });

  // __dirname = out/test/integration/suite/ at runtime; go up one level to find test files.
  const testsRoot = path.resolve(__dirname, '..');
  mocha.addFile(path.join(testsRoot, 'gpgCliIntegration.test.js'));

  return new Promise((resolve, reject) => {
    try {
      mocha.run((failures: number) => {
        // Flush V8 coverage to NODE_V8_COVERAGE immediately, before this process
        // begins tearing down. takeCoverage() writes synchronously so the file is
        // guaranteed to exist on the bind-mount host path before VS Code's IPC layer
        // sends the 'tests done' notification — eliminating the race between process
        // exit and the host runner scanning the coverage directory. stopCoverage()
        // prevents V8 from writing a second redundant file on process exit.
        if (process.env.NODE_V8_COVERAGE) {
          v8.takeCoverage();
          v8.stopCoverage();
        }
        if (failures > 0) {
          reject(new Error(`${failures} integration test(s) failed.`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}
