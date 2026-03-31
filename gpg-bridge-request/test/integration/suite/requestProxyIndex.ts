/**
 * Mocha entry point for Phase 2 integration tests.
 *
 * Loaded by @vscode/test-electron as extensionTestsPath. Must export run().
 * Loads requestProxyIntegration.test.js explicitly rather than globbing so
 * that Phase 3 test files added to the same output directory are not
 * accidentally picked up when Phase 2 runs in a container without gpg.
 *
 * Timeout is set high (60 s) because real gpg-agent operations (signs, round-trips)
 * through the full proxy chain are slower than unit test mocks.
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
    'gpg-bridge-request/test-results/integration/requestProxy.xml',
  );

  const mocha = new Mocha({
    ui: 'bdd',
    color: true,
    timeout: 60000, // 60 s — real gpg operations through the proxy chain are slow
    reporter: path.join(repoRoot, 'shared/junit-spec.cjs'),
  });

  // __dirname = out/test/integration/suite/ at runtime; go up one level to find test files.
  const testsRoot = path.resolve(__dirname, '..');
  mocha.addFile(path.join(testsRoot, 'requestProxyIntegration.test.js'));

  return new Promise((resolve, reject) => {
    try {
      mocha.run((failures: number) => {
        // Flush V8 coverage before the process begins teardown — same rationale as gpgCliIndex.ts.
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
