export function isTestEnvironment(): boolean {
    const argv = process.argv.join(' ');

    return process.env.npm_lifecycle_event === 'test'
        || process.env.VSCODE_TEST_MODE === '1'
        || argv.includes('extensionTestsPath')
        || argv.includes('vscode-test')
        || argv.includes('bootstrap-fork.js');
}

/**
 * Returns true when running under @vscode/test-electron with VSCODE_INTEGRATION_TEST=1.
 *
 * Used to opt integration tests back into full extension initialization that
 * isTestEnvironment() would otherwise skip. Unit tests set only the normal test
 * signals; integration tests additionally set VSCODE_INTEGRATION_TEST=1 via
 * extensionTestsEnv in the custom runTest.ts runner.
 *
 * Logic table:
 *   Unit test:        isTestEnvironment()=true,  isIntegrationTestEnvironment()=false → skip init
 *   Integration test: isTestEnvironment()=true,  isIntegrationTestEnvironment()=true  → full init
 *   Production:       isTestEnvironment()=false, isIntegrationTestEnvironment()=false → full init
 */
export function isIntegrationTestEnvironment(): boolean {
    return process.env.VSCODE_INTEGRATION_TEST === '1';
}
