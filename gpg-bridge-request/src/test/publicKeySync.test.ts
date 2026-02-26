/**
 * Agent absent — executeCommand rejects with an error indicating the
 * gpg-bridge-agent command is not available or not found in VS Code.
 *
 * When this occurs:
 * - The sync operation catches the rejection gracefully (does not re-throw)
 * - An error message is displayed to the user indicating export failure
 * - importPublicKeys is never invoked since no key data was obtained
 *
 * This scenario tests the error boundary for when the remote VS Code extension
 * (agent) that exports public keys is missing, disabled, or unreachable.
 */
/**
 * Unit tests for PublicKeySync.
 *
 * All VS Code APIs and gpgCli are injected as mocks — no real gpg subprocess
 * or cross-host VS Code command bridge is involved.
 */

import { expect } from 'chai';
import { PublicKeySync } from '../services/publicKeySync';
import { MockGpgCli, MockLogConfig } from '@gpg-bridge/shared/test';
import type { PublicKeySyncDeps } from '../services/publicKeySync';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * MockGpgCli subclass that records `importPublicKeys` calls and can be
 * configured to return a preset result or throw.
 */
class MockGpgCliWithImport extends MockGpgCli {
    public importResult: { imported: number; unchanged: number; errors: number } =
        { imported: 1, unchanged: 0, errors: 0 };
    public importCalls: string[] = [];
    public importShouldThrow: Error | null = null;

    constructor() { super('/tmp/test.sock'); }

    override async importPublicKeys(keyData: string): Promise<{ imported: number; unchanged: number; errors: number }> {
        if (this.importShouldThrow) { throw this.importShouldThrow; }
        this.importCalls.push(keyData);
        return this.importResult;
    }
}

interface MockState {
    gpgCli: MockGpgCliWithImport;
    executeCommandCalls: Array<{ command: string; args: unknown[] }>;
    infoMessages: string[];
    errorMessages: string[];
    deps: PublicKeySyncDeps;
    /** Configure executeCommand to resolve with this value on next call(s). */
    setExportResult(value: string | undefined): void;
    /** Configure executeCommand to reject with this error on next call(s). */
    setExportThrows(err: Error): void;
}

function createMockState(): MockState {
    const gpgCli = new MockGpgCliWithImport();
    const executeCommandCalls: Array<{ command: string; args: unknown[] }> = [];
    const infoMessages: string[] = [];
    const errorMessages: string[] = [];

    let exportResult: string | undefined = undefined;
    let exportThrows: Error | null = null;

    const executeCommand = (command: string, ...args: unknown[]): Promise<unknown> => {
        executeCommandCalls.push({ command, args });
        if (exportThrows) { return Promise.reject(exportThrows); }
        return Promise.resolve(exportResult);
    };

    return {
        gpgCli,
        executeCommandCalls,
        infoMessages,
        errorMessages,
        deps: {
            gpgCliFactory: { create: () => gpgCli },
            executeCommand,
            showInformationMessage: (msg) => infoMessages.push(msg),
            showErrorMessage: (msg) => errorMessages.push(msg),
        },
        setExportResult: (v) => { exportResult = v; },
        setExportThrows: (e) => { exportThrows = e; },
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PublicKeySync', () => {
    let logConfig: MockLogConfig;

    beforeEach(() => {
        logConfig = new MockLogConfig();
    });

    // -----------------------------------------------------------------------
    // 1. syncPublicKeys() with no filter forwards no extra arg to executeCommand
    // -----------------------------------------------------------------------
    it('1. syncPublicKeys() with no filter calls executeCommand with no extra args', async () => {
        const m = createMockState();
        m.setExportResult(undefined); // user cancelled — still tests the call args
        const svc = new PublicKeySync({ logCallback: logConfig.logCallback }, m.deps);

        await svc.syncPublicKeys();

        expect(m.executeCommandCalls).to.have.length(1);
        expect(m.executeCommandCalls[0].command).to.equal('_gpg-bridge-agent.exportPublicKeys');
        expect(m.executeCommandCalls[0].args).to.deep.equal([], 'no extra arg for interactive mode');
    });

    // -----------------------------------------------------------------------
    // 2. syncPublicKeys('pairs') forwards 'pairs' as filter
    // -----------------------------------------------------------------------
    it('2. syncPublicKeys(\'pairs\') forwards \'pairs\' to executeCommand', async () => {
        const m = createMockState();
        m.setExportResult(undefined);
        const svc = new PublicKeySync({ logCallback: logConfig.logCallback }, m.deps);

        await svc.syncPublicKeys('pairs');

        expect(m.executeCommandCalls[0].args).to.deep.equal(['pairs']);
    });

    // -----------------------------------------------------------------------
    // 3. syncPublicKeys('all') forwards 'all' as filter
    // -----------------------------------------------------------------------
    it('3. syncPublicKeys(\'all\') forwards \'all\' to executeCommand', async () => {
        const m = createMockState();
        m.setExportResult(undefined);
        const svc = new PublicKeySync({ logCallback: logConfig.logCallback }, m.deps);

        await svc.syncPublicKeys('all');

        expect(m.executeCommandCalls[0].args).to.deep.equal(['all']);
    });

    // -----------------------------------------------------------------------
    // 4. syncPublicKeys(string[]) forwards each element as a separate arg
    // -----------------------------------------------------------------------
    it('4. syncPublicKeys([\'uid with spaces\', \'FP2\']) forwards array verbatim to executeCommand', async () => {
        const m = createMockState();
        m.setExportResult(undefined);
        const svc = new PublicKeySync({ logCallback: logConfig.logCallback }, m.deps);

        await svc.syncPublicKeys(['Alice Smith <alice@example.com>', 'FP2']);

        expect(m.executeCommandCalls[0].args).to.deep.equal([['Alice Smith <alice@example.com>', 'FP2']]);
    });

    // -----------------------------------------------------------------------
    // 5. executeCommand returns undefined (user cancelled) — no import, no message
    // -----------------------------------------------------------------------
    it('5. executeCommand returns undefined — importPublicKeys not called and no messages shown', async () => {
        const m = createMockState();
        m.setExportResult(undefined);
        const svc = new PublicKeySync({ logCallback: logConfig.logCallback }, m.deps);

        await svc.syncPublicKeys('all');

        expect(m.gpgCli.importCalls, 'importPublicKeys must not be called').to.have.length(0);
        expect(m.infoMessages, 'no info message expected').to.have.length(0);
        expect(m.errorMessages, 'no error message expected').to.have.length(0);
    });

    // -----------------------------------------------------------------------
    // 6. Successful import — importPublicKeys called; info message shown with counts
    // -----------------------------------------------------------------------
    it('6. successful import — importPublicKeys called with key bytes; info message shown with counts', async () => {
        const m = createMockState();
        const keyBytes = '-----BEGIN PGP PUBLIC KEY BLOCK-----\nFAKEKEYDATA\n-----END PGP PUBLIC KEY BLOCK-----\n';
        m.setExportResult(keyBytes);
        m.gpgCli.importResult = { imported: 2, unchanged: 1, errors: 0 };
        const svc = new PublicKeySync({ logCallback: logConfig.logCallback }, m.deps);

        await svc.syncPublicKeys('all');

        expect(m.gpgCli.importCalls, 'importPublicKeys must be called once').to.have.length(1);
        expect(m.gpgCli.importCalls[0]).to.equal(keyBytes, 'armor string passed verbatim');
        expect(m.infoMessages, 'exactly one info message expected').to.have.length(1);
        expect(m.infoMessages[0]).to.include('2 imported');
        expect(m.infoMessages[0]).to.include('1 unchanged');
        expect(m.errorMessages, 'no error messages expected').to.have.length(0);
    });

    // -----------------------------------------------------------------------
    // 7. Agent absent — executeCommand rejects; error message shown; no import
    // -----------------------------------------------------------------------
    it('7. agent absent — executeCommand rejects; VS Code error message shown; importPublicKeys not called', async () => {
        const m = createMockState();
        m.setExportThrows(new Error('command not found: _gpg-bridge-agent.exportPublicKeys'));
        const svc = new PublicKeySync({ logCallback: logConfig.logCallback }, m.deps);

        await svc.syncPublicKeys('all');  // must not throw itself

        expect(m.gpgCli.importCalls, 'importPublicKeys must not be called').to.have.length(0);
        expect(m.errorMessages, 'exactly one error message expected').to.have.length(1);
        expect(m.errorMessages[0]).to.include('Request agent export public keys failed');
        expect(m.infoMessages, 'no info message expected').to.have.length(0);
    });

    // -----------------------------------------------------------------------
    // 8. autoSync('') — no-op, executeCommand never called
    // -----------------------------------------------------------------------
    it('8. autoSync(\'\') — no-op; executeCommand never called', async () => {
        const m = createMockState();
        const svc = new PublicKeySync({ logCallback: logConfig.logCallback }, m.deps);

        await svc.autoSync('');

        expect(m.executeCommandCalls, 'executeCommand must not be called for empty setting').to.have.length(0);
        expect(m.gpgCli.importCalls).to.have.length(0);
    });

    it('8b. autoSync([]) — no-op; executeCommand never called for empty array', async () => {
        const m = createMockState();
        const svc = new PublicKeySync({ logCallback: logConfig.logCallback }, m.deps);

        await svc.autoSync([]);

        expect(m.executeCommandCalls, 'executeCommand must not be called for empty array').to.have.length(0);
        expect(m.gpgCli.importCalls).to.have.length(0);
    });

    it('8c. autoSync([\'Alice Smith <alice@example.com>\']) — syncs array setting', async () => {
        const m = createMockState();
        m.setExportResult(undefined);
        const svc = new PublicKeySync({ logCallback: logConfig.logCallback }, m.deps);

        await svc.autoSync(['Alice Smith <alice@example.com>']);

        expect(m.executeCommandCalls).to.have.length(1);
        expect(m.executeCommandCalls[0].args).to.deep.equal([['Alice Smith <alice@example.com>']]);
    });

    it('8d. autoSync(arbitrary string) — shows error and does not call executeCommand', async () => {
        const m = createMockState();
        const svc = new PublicKeySync({ logCallback: logConfig.logCallback }, m.deps);

        // Cast needed: TypeScript rejects arbitrary strings; test simulates a bad settings.json value
        await svc.autoSync('John Doe' as never);

        expect(m.executeCommandCalls, 'executeCommand must not be called for invalid string').to.have.length(0);
        expect(m.errorMessages).to.have.length(1);
        expect(m.errorMessages[0]).to.include('John Doe');
        expect(m.errorMessages[0]).to.include('["John Doe"]');
    });

    // -----------------------------------------------------------------------
    // 9. autoSync fires exactly once — each call results in exactly one executeCommand
    //    call; no internal state causes repeated invocations
    // -----------------------------------------------------------------------
    it('9. autoSync fires exactly once per call — no internal state causes re-triggering', async () => {
        const m = createMockState();
        m.setExportResult(undefined);
        const svc = new PublicKeySync({ logCallback: logConfig.logCallback }, m.deps);

        await svc.autoSync('pairs');
        expect(m.executeCommandCalls, 'first call: exactly one executeCommand call').to.have.length(1);
        expect(m.executeCommandCalls[0].args).to.deep.equal(['pairs']);

        // A second call (simulating what would NOT happen on proxy stop/restart)
        // still produces exactly one more executeCommand call — no internal state
        // accumulates side-effects.
        await svc.autoSync('all');
        expect(m.executeCommandCalls, 'second call: exactly two total executeCommand calls').to.have.length(2);
        expect(m.executeCommandCalls[1].args).to.deep.equal(['all']);
    });
});
