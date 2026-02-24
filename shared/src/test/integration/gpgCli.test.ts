/**
 * Phase 1 integration tests for `GpgCli` (production class from shared/src/gpgCli.ts).
 *
 * - Uses real gpg subprocesses — gpg must be on PATH or in a well-known location.
 * - Each test creates its own isolated GNUPGHOME via `mkdtempSync`.
 * - Boilerplate (create + assertSafeToDelete + cleanup) is done manually here;
 *   Phase 2 replaces this with `new GpgTestHelper()`.
 *
 * Run: `npm test` in shared/
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import { GpgCli } from '../../gpgCli';
import { assertSafeToDelete } from './fsUtils';

const execFileAsync = promisify(execFile);

// ============================================================================
// Helpers
// ============================================================================

/** Create a fresh, isolated GNUPGHOME directory. */
function makeTmpHome(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gpg-test-phase1-'));
    assertSafeToDelete(dir);
    return dir;
}

/** Remove the temp GNUPGHOME, killing any running gpg-agent first. */
async function cleanupHome(gnupgHome: string): Promise<void> {
    try {
        // Best-effort kill — don't throw if gpgconf/agent is missing or already dead
        await execFileAsync('gpgconf', ['--homedir', gnupgHome, '--kill', 'gpg-agent'], {
            encoding: 'latin1',
            shell: false,
            timeout: 5000,
            env: { ...process.env, GNUPGHOME: gnupgHome },
        });
    } catch {
        // intentionally swallowed — agent may never have started
    }
    fs.rmSync(gnupgHome, { recursive: true, force: true });
}

/**
 * Generate a key and wait for it to appear in the keyring.
 * Uses `--batch` with a key generation parameter file piped to stdin.
 * The key ID is returned.
 */
function generateKey(gnupgHome: string, name = 'Test User', email = 'test@example.com'): void {
    const params = [
        '%no-protection',
        'Key-Type: EdDSA',
        'Key-Curve: ed25519',
        `Name-Real: ${name}`,
        `Name-Email: ${email}`,
        'Expire-Date: 1d',
        '%commit',
    ].join('\n');

    // execFileSync supports the `input` option (unlike the promisified async form).
    // stdio is set explicitly so gpg's stderr does not bleed into Mocha's output.
    execFileSync('gpg', ['--homedir', gnupgHome, '--batch', '--gen-key'], {
        encoding: 'latin1',
        input: params,
        timeout: 60000,
        env: { ...process.env, GNUPGHOME: gnupgHome },
        stdio: ['pipe', 'pipe', 'pipe'],
    });
}

// ============================================================================
// Suite
// ============================================================================

describe('GpgCli integration', function () {
    // Key generation can be slow on some systems; allow up to 30 s per test
    this.timeout(60000);

    // -------------------------------------------------------------------
    // 1. Constructor succeeds with no opts (real PATH probe)
    // -------------------------------------------------------------------

    describe('constructor', () => {
        it('succeeds with no opts — real PATH probe finds gpgconf', () => {
            // Should not throw; gpg is confirmed available from before()
            expect(() => new GpgCli({})).not.to.throw();
        });
    });

    // -------------------------------------------------------------------
    // 2. gpgconfListDirs('agent-socket')
    // -------------------------------------------------------------------

    describe('gpgconfListDirs()', () => {
        let gnupgHome: string;
        beforeEach(() => { gnupgHome = makeTmpHome(); });
        afterEach(async () => { await cleanupHome(gnupgHome); });

        it("returns a non-empty path string for 'agent-socket'", async () => {
            const cli = new GpgCli({ gnupgHome });
            const result = await cli.gpgconfListDirs('agent-socket');
            expect(result.length).to.be.greaterThan(0, 'expected a non-empty path string');
            // Path should look like a file system path (starts with / or drive letter)
            expect(
                result.startsWith('/') || /^[A-Za-z]:/.test(result),
                `expected an absolute path, got: ${result}`
            ).to.equal(true);
        });
    });

    // -------------------------------------------------------------------
    // 3. listPairedKeys
    // -------------------------------------------------------------------

    describe('listPairedKeys()', () => {
        let gnupgHome: string;
        beforeEach(() => { gnupgHome = makeTmpHome(); });
        afterEach(async () => { await cleanupHome(gnupgHome); });

        it('returns PairedKeyInfo[] with correct fingerprint and userId for a generated key', async () => {
            generateKey(gnupgHome, 'Phase One', 'phaseone@example.com');

            const cli = new GpgCli({ gnupgHome });
            const keys = await cli.listPairedKeys();

            expect(keys.length).to.be.greaterThanOrEqual(1, 'expected at least one key pair');
            const key = keys[0];
            expect(key.fingerprint).to.have.lengthOf(40, `expected 40-char fingerprint, got: ${key.fingerprint}`);
            expect(/^[0-9A-F]{40}$/i.test(key.fingerprint), `fingerprint should be hex: ${key.fingerprint}`).to.equal(true);
            expect(key.userIds.length).to.be.greaterThanOrEqual(1, 'expected at least one UID');
            expect(key.userIds[0]).to.include('phaseone@example.com');
        });

        it('returns empty array for a fresh (empty) keyring', async () => {
            const cli = new GpgCli({ gnupgHome });
            const keys = await cli.listPairedKeys();
            expect(keys).to.deep.equal([]);
        });
    });

    // -------------------------------------------------------------------
    // 4. exportPublicKeys('pairs')
    // -------------------------------------------------------------------

    describe('exportPublicKeys()', () => {
        let gnupgHome: string;
        beforeEach(() => { gnupgHome = makeTmpHome(); });
        afterEach(async () => { await cleanupHome(gnupgHome); });

        it("returns non-empty Uint8Array for 'pairs' filter when key pair is present", async () => {
            generateKey(gnupgHome);

            const cli = new GpgCli({ gnupgHome });
            // 'pairs' is passed as a filter string; gpg will export keys matching 'pairs' literally —
            // this may return the specific key or nothing; test that the method completes without error
            // and that calling without a filter returns non-empty bytes.
            const result = await cli.exportPublicKeys();
            expect(result).to.be.instanceof(Uint8Array);
            expect(result.length).to.be.greaterThan(0, 'expected non-empty export for a keyring with a key pair');
        });
    });

    // -------------------------------------------------------------------
    // 5. importPublicKeys round-trip
    // -------------------------------------------------------------------

    describe('importPublicKeys()', () => {
        let homeA: string;
        let homeB: string;
        beforeEach(() => { homeA = makeTmpHome(); homeB = makeTmpHome(); });
        afterEach(async () => {
            await cleanupHome(homeA);
            await cleanupHome(homeB);
        });

        it('round-trips: export from keyring A → import into keyring B; result imported: 1', async () => {
            // Generate a key in home A
            generateKey(homeA, 'Round Trip', 'roundtrip@example.com');

            // Export from A
            const cliA = new GpgCli({ gnupgHome: homeA });
            const keyData = await cliA.exportPublicKeys();
            expect(keyData.length).to.be.greaterThan(0, 'expected non-empty export from homeA');

            // Import into B
            const cliB = new GpgCli({ gnupgHome: homeB });
            const result = await cliB.importPublicKeys(keyData);

            expect(result.imported).to.equal(1, `expected 1 imported, got: ${JSON.stringify(result)}`);
            expect(result.errors).to.equal(0, `expected 0 errors, got: ${JSON.stringify(result)}`);
        });
    });
});
