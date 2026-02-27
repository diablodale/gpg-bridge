/**
 * GpgTestHelper  Integration Test Helper
 *
 * Extends the production GpgCli base class with test-only lifecycle methods.
 *
 * Default usage: each instance creates its own isolated GNUPGHOME via `mkdtempSync`;
 * it is passed to `super()` so every subprocess call inherits it explicitly.
 * `process.env.GNUPGHOME` is never mutated.
 *
 * When `opts.gnupgHome` is provided, the instance wraps an existing keyring without
 * taking ownership — `cleanup()` becomes a no-op so the caller manages lifecycle.
 *
 * Always call `cleanup()` in an `afterEach`/`finally` block when you own the keyring.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { GpgCli } from '@gpg-bridge/shared';
import type { GpgExecResult, GpgCliOpts } from '@gpg-bridge/shared';
import { assertSafeToDelete } from './fsUtils';

export class GpgTestHelper extends GpgCli {
    /** Absolute path to the keyring used by this instance. */
    public readonly gnupgHome: string;
    /** True when this instance created its own temp dir and owns its lifecycle. */
    private readonly _ownsTempDir: boolean;

    /**
     * Create a GpgTestHelper.
     *
     * - Without `opts.gnupgHome`: creates an isolated temp keyring via `mkdtempSync`.
     *   `cleanup()` will kill the agent and delete the directory.
     * - With `opts.gnupgHome`: wraps an existing keyring. `cleanup()` is a no-op;
     *   the caller is responsible for agent and directory lifecycle.
     *
     * Does not mutate `process.env.GNUPGHOME`.
     * Throws if `gpgconf` cannot be found on PATH or at `opts.gpgBinDir`.
     */
    constructor(opts?: GpgCliOpts) {
        let gnupgHome: string;
        let ownsTempDir: boolean;
        if (opts?.gnupgHome) {
            gnupgHome = opts.gnupgHome;
            ownsTempDir = false;
        } else {
            gnupgHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gpg-test-integration-'));
            assertSafeToDelete(gnupgHome);
            ownsTempDir = true;
        }
        // Pass gnupgHome to super() so all inherited run()/runRaw() calls inject
        // GNUPGHOME explicitly  no ambient env mutation needed.
        super({ gpgBinDir: opts?.gpgBinDir, gnupgHome });
        this.gnupgHome = gnupgHome;
        this._ownsTempDir = ownsTempDir;
    }

    /**
     * When this instance owns the temp dir: kill the gpg-agent (tolerates an
     * already-dead agent), validate the path, then delete it.
     * When wrapping an external keyring (`opts.gnupgHome` was provided): no-op.
     * Always call in a `finally` block when you own the keyring.
     */
    async cleanup(): Promise<void> {
        if (this._ownsTempDir) {
            await this.killAgent();
            assertSafeToDelete(this.gnupgHome);
            fs.rmSync(this.gnupgHome, { recursive: true, force: true });
        }
    }

    // -------------------------------------------------------------------------
    // Agent lifecycle
    // -------------------------------------------------------------------------

    /**
     * Write gpg-agent.conf into GNUPGHOME.
     * Options are written one per line, LF-terminated.
     */
    writeAgentConf(options: string[]): void {
        const confPath = path.join(this.gnupgHome, 'gpg-agent.conf');
        fs.writeFileSync(confPath, options.join('\n') + '\n', 'latin1');
    }

    /** Launch gpg-agent in daemon mode for this GNUPGHOME. */
    async launchAgent(): Promise<GpgExecResult> {
        return this.run(this.gpgconfBin, ['--launch', 'gpg-agent']);
    }

    /**
     * Kill gpg-agent for this GNUPGHOME.
     * Does not throw if the agent is already dead (`runRaw` tolerates non-zero exits).
     */
    async killAgent(): Promise<void> {
        await this.runRaw(this.gpgconfBin, ['--kill', 'gpg-agent']);
    }

    // -------------------------------------------------------------------------
    // Key lifecycle
    // -------------------------------------------------------------------------

    /**
     * Generate a no-passphrase Ed25519/cv25519 test key in GNUPGHOME.
     * Key types are specified explicitly (EDDSA + ECDH) rather than relying on
     * 'Key-Type: default', which resolves unreliably on some Gpg4win installations.
     */
    async generateKey(name: string, email: string): Promise<void> {
        const batch = [
            '%no-protection',
            'Key-Type: EDDSA',
            'Key-Curve: ed25519',
            'Subkey-Type: ECDH',
            'Subkey-Curve: cv25519',
            `Name-Real: ${name}`,
            `Name-Email: ${email}`,
            'Expire-Date: 0',
            '%commit'
        ].join('\n') + '\n';

        const tmpFile = path.join(
            this.gnupgHome,
            `gpg-batch-${crypto.randomBytes(4).toString('hex')}.txt`
        );
        try {
            fs.writeFileSync(tmpFile, batch, 'latin1');
            await this.run(this.gpgBin, ['--batch', '--gen-key', tmpFile]);
        } finally {
            try { fs.unlinkSync(tmpFile); } catch { /* tmp cleanup, ignore */ }
        }
    }

    /**
     * Delete a key (secret + public) by fingerprint.
     * Equivalent to: gpg --batch --yes --delete-secret-and-public-key <fingerprint>
     */
    async deleteKey(fingerprint: string): Promise<GpgExecResult> {
        return this.run(this.gpgBin, ['--batch', '--yes', '--delete-secret-and-public-key', fingerprint]);
    }

    /**
     * Return the fingerprint for the primary key matching email.
     * Parses `gpg --with-colons --fingerprint` output for the first `fpr:` record.
     */
    async getFingerprint(email: string): Promise<string> {
        const { stdout } = await this.run(this.gpgBin, ['--with-colons', '--fingerprint', email]);
        for (const line of stdout.split('\n')) {
            if (line.startsWith('fpr:')) {
                // Colon-delimited: fpr:::::::::<fingerprint>:
                const fpr = line.split(':')[9];
                if (fpr) {
                    return fpr.trim();
                }
            }
        }
        throw new Error(`GpgTestHelper: no fingerprint found for ${email}`);
    }

    /**
     * Return the keygrip of the primary signing key matching email.
     *
     * gpg --with-colons --with-keygrip output interleaves records:
     *   pub:  fpr:  grp: (primary)  sub:  fpr:  grp: (subkey)
     *
     * Returns the first grp: record, which is always the primary (signing) key.
     */
    async getKeygrip(email: string): Promise<string> {
        const { stdout } = await this.run(this.gpgBin, [
            '--with-colons', '--with-keygrip', '--fingerprint', email
        ]);
        for (const line of stdout.split('\n')) {
            if (line.startsWith('grp:')) {
                const grip = line.split(':')[9];
                if (grip) {
                    return grip.trim();
                }
            }
        }
        throw new Error(`GpgTestHelper: no keygrip found for ${email}`);
    }

    /**
     * Export the armored public key for a fingerprint.
     * Returns the ASCII-armored public key block as a string.
     */
    async exportPublicKey(fingerprint: string): Promise<string> {
        const { stdout } = await this.run(this.gpgBin, ['--export', '--armor', fingerprint]);
        return stdout;
    }

    /**
     * Import a public key from an ASCII-armored or binary key data string.
     * Writes keyData to a temp file and imports it; latin1 preserves binary material.
     */
    async importPublicKey(keyData: string): Promise<void> {
        const tmpFile = path.join(
            this.gnupgHome,
            `gpg-import-${crypto.randomBytes(4).toString('hex')}.asc`
        );
        try {
            fs.writeFileSync(tmpFile, keyData, 'latin1');
            await this.run(this.gpgBin, ['--import', tmpFile]);
        } finally {
            try { fs.unlinkSync(tmpFile); } catch { /* tmp cleanup, ignore */ }
        }
    }

    // -------------------------------------------------------------------------
    // Crypto ops  return exit code for caller to assert on
    // -------------------------------------------------------------------------

    /** Return gpg version info; returns { exitCode, stdout, stderr }. */
    async version(): Promise<GpgExecResult> {
        return this.runRaw(this.gpgBin, ['--version']);
    }

    /** List keys in GNUPGHOME; returns { exitCode, stdout, stderr }. */
    async listKeys(): Promise<GpgExecResult> {
        return this.runRaw(this.gpgBin, ['--list-keys']);
    }

    /** Sign inputPath; returns { exitCode, stdout, stderr }. */
    async signFile(inputPath: string, userId: string): Promise<GpgExecResult> {
        return this.runRaw(this.gpgBin, [
            '--batch', '--no-tty', '--sign', '--local-user', userId, inputPath
        ]);
    }

    /** Verify sigPath; returns { exitCode, stdout, stderr }. */
    async verifyFile(sigPath: string): Promise<GpgExecResult> {
        return this.runRaw(this.gpgBin, ['--verify', sigPath]);
    }

    /** Encrypt inputPath to recipient; returns { exitCode, stdout, stderr }. */
    async encryptFile(inputPath: string, recipient: string): Promise<GpgExecResult> {
        return this.runRaw(this.gpgBin, [
            '--batch', '--encrypt', '--recipient', recipient, inputPath
        ]);
    }

    /** Decrypt inputPath; returns { exitCode, stdout, stderr }. */
    async decryptFile(inputPath: string): Promise<GpgExecResult> {
        return this.runRaw(this.gpgBin, ['--batch', '--decrypt', inputPath]);
    }
}
