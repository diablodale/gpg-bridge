/**
 * Phase 1 Integration Test Runner
 *
 * Custom @vscode/test-electron runner for agent-proxy Phase 1 integration tests.
 *
 * Responsibilities:
 *   1. Create an isolated gpg keyring (GNUPGHOME) unique to this test run.
 *   2. Write a gpg-agent.conf that disables irrelevant services.
 *   3. Launch a throwaway gpg-agent pointed at the isolated keyring.
 *   4. Start VS Code via runTests(), injecting GNUPGHOME + VSCODE_INTEGRATION_TEST=1
 *      into the extension host so activate() runs full initialization.
 *   5. After tests complete (pass or fail), kill the agent and delete the keyring.
 *
 * The agent is launched BEFORE the extension host starts so that
 * detectAgentSocket() (called during activate()) already sees a live socket.
 */

import * as path from 'path';
import { runTests } from '@vscode/test-electron';
import { GpgTestHelper } from '@gpg-bridge/shared/test/integration';

// GpgTestHelper creates and validates its own isolated keyring at construction time.
// process.env.GNUPGHOME is never mutated.
const gpg = new GpgTestHelper();

async function main(): Promise<void> {
    // disable-scdaemon is the only confirmed-valid conf option in GPG 2.4.x.
    // SSH / Putty / OpenSSH-disable options are not valid conf file entries in
    // this build and will cause gpg-agent --gpgconf-test to fail.
    gpg.writeAgentConf(['disable-scdaemon']);

    // Launch the gpg-agent now, before the extension host starts, so that
    // gpgconf --list-dirs agent-extra-socket (called during activate()) finds a live socket.
    await gpg.launchAgent();

    try {
        await runTests({
            // Extension under test: agent-proxy (this package's root).
            // __dirname = out/test/integration/ at runtime, so '../../../' = agent-proxy root.
            extensionDevelopmentPath: path.resolve(__dirname, '../../../'),

            // Mocha entry point: exports run(), located at suite/index.ts → out/../suite/index.js
            extensionTestsPath: path.resolve(__dirname, './suite/index'),

            // Inject GNUPGHOME and integration test flag into the extension host.
            // VSCODE_INTEGRATION_TEST=1 causes isIntegrationTestEnvironment() to return true,
            // which allows the extension to run full initialization despite isTestEnvironment()
            // also being true (the normal test signal is still present under @vscode/test-electron).
            extensionTestsEnv: {
                VSCODE_INTEGRATION_TEST: '1',
                GNUPGHOME: gpg.gnupgHome
            }
        });
    } finally {
        // Kill agent and remove the isolated keyring whether tests passed or failed.
        await gpg.cleanup();
    }
}

main().catch(err => {
    console.error('Integration test runner failed:', err);
    process.exit(1);
});
