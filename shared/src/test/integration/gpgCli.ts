/**
 * GpgCli — Integration Test Helper
 *
 * Subprocess wrappers for gpg.exe / gpgconf.exe used by all integration test phases.
 *
 * GNUPGHOME is read from process.env.GNUPGHOME at construction time; throws if unset.
 * All subprocess calls inject GNUPGHOME explicitly so the correct isolated keyring is
 * always used regardless of the ambient environment.
 *
 * Encoding: latin1 throughout — matches the socket I/O encoding used in production
 * and handles binary key material (0–255 byte range) without truncation.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawnSync, SpawnSyncReturns } from 'child_process';

export interface GpgCliOpts {
    /** Path to gpg binary. Defaults to 'gpg' (must be on PATH). */
    gpgPath?: string;
    /** Path to gpgconf binary. Defaults to 'gpgconf' (must be on PATH). */
    gpgconfPath?: string;
}

export interface GpgExecResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

export class GpgCli {
    private readonly gnupgHome: string;
    private readonly gpgPath: string;
    private readonly gpgconfPath: string;

    /**
     * Construct a GpgCli instance.
     * Throws if process.env.GNUPGHOME is not set.
     */
    constructor(opts?: GpgCliOpts) {
        const home = process.env.GNUPGHOME;
        if (!home) {
            throw new Error('GpgCli: GNUPGHOME is not set in process.env');
        }
        this.gnupgHome = home;
        this.gpgPath = opts?.gpgPath ?? 'gpg';
        this.gpgconfPath = opts?.gpgconfPath ?? 'gpgconf';
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    private get env(): NodeJS.ProcessEnv {
        return { ...process.env, GNUPGHOME: this.gnupgHome };
    }

    /**
     * Spawn binary with args; throw on non-zero exit or spawn error.
     * Used for all lifecycle operations where failure is unexpected.
     */
    private run(binary: string, args: string[]): GpgExecResult {
        const result: SpawnSyncReturns<string> = spawnSync(binary, args, {
            encoding: 'latin1',
            env: this.env,
            timeout: 30000
        });
        if (result.error) {
            throw new Error(`GpgCli: ${binary} spawn failed: ${result.error.message}`);
        }
        if (result.status !== 0) {
            throw new Error(
                `GpgCli: ${binary} ${args.join(' ')} exited ${result.status}: ${result.stderr ?? '(no stderr)'}`
            );
        }
        return { exitCode: result.status ?? 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
    }

    /**
     * Spawn binary with args; return result without throwing.
     * Used for crypto ops where the caller needs to inspect exit code.
     */
    private runRaw(binary: string, args: string[]): GpgExecResult {
        const result: SpawnSyncReturns<string> = spawnSync(binary, args, {
            encoding: 'latin1',
            env: this.env,
            timeout: 30000
        });
        if (result.error) {
            throw new Error(`GpgCli: ${binary} spawn failed: ${result.error.message}`);
        }
        return {
            exitCode: result.status ?? -1,
            stdout: result.stdout ?? '',
            stderr: result.stderr ?? ''
        };
    }

    // -------------------------------------------------------------------------
    // Agent lifecycle (called from runTest.ts, in runner process)
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
    launchAgent(): void {
        this.run(this.gpgconfPath, ['--launch', 'gpg-agent']);
    }

    /**
     * Kill gpg-agent for this GNUPGHOME.
     * Does not throw if the agent is already dead (gracefully ignores exit code 2).
     */
    killAgent(): void {
        const result: SpawnSyncReturns<string> = spawnSync(
            this.gpgconfPath, ['--kill', 'gpg-agent'],
            { encoding: 'latin1', env: this.env, timeout: 10000 }
        );
        if (result.error) {
            throw new Error(`GpgCli: gpgconf spawn failed: ${result.error.message}`);
        }
        // gpgconf --kill returns non-zero when agent is already dead — that is fine.
    }

    // -------------------------------------------------------------------------
    // Key lifecycle (called from Mocha before()/after(), inside extension host)
    // -------------------------------------------------------------------------

    /**
     * Generate a no-passphrase Ed25519/cv25519 test key in GNUPGHOME.
     * Key types are specified explicitly (EDDSA + ECDH) rather than relying on
     * 'Key-Type: default', which resolves unreliably on some Gpg4win installations.
     */
    generateKey(name: string, email: string): void {
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
            this.run(this.gpgPath, ['--batch', '--gen-key', tmpFile]);
        } finally {
            try { fs.unlinkSync(tmpFile); } catch { /* tmp cleanup, ignore */ }
        }
    }

    /**
     * Delete a key (secret + public) by fingerprint.
     * Equivalent to: gpg --batch --yes --delete-secret-and-public-key <fingerprint>
     */
    deleteKey(fingerprint: string): void {
        this.run(this.gpgPath, ['--batch', '--yes', '--delete-secret-and-public-key', fingerprint]);
    }

    /**
     * Return the fingerprint for the primary key matching email.
     * Parses `gpg --with-colons --fingerprint` output for the first `fpr:` record.
     */
    getFingerprint(email: string): string {
        const { stdout } = this.run(this.gpgPath, ['--with-colons', '--fingerprint', email]);
        for (const line of stdout.split('\n')) {
            if (line.startsWith('fpr:')) {
                // Colon-delimited: fpr:::::::::<fingerprint>:
                const fpr = line.split(':')[9];
                if (fpr) {
                    return fpr.trim();
                }
            }
        }
        throw new Error(`GpgCli: no fingerprint found for ${email}`);
    }

    /**
     * Return the keygrip of the primary signing key matching email.
     *
     * gpg --with-colons --with-keygrip output interleaves records in order:
     *   pub:  — primary key metadata
     *   fpr:  — primary key fingerprint (field 10)
     *   grp:  — primary key keygrip    (field 10)
     *   sub:  — subkey metadata
     *   fpr:  — subkey fingerprint
     *   grp:  — subkey keygrip
     *
     * We return the first grp: record, which is always the primary (signing) key.
     */
    getKeygrip(email: string): string {
        const { stdout } = this.run(this.gpgPath, [
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
        throw new Error(`GpgCli: no keygrip found for ${email}`);
    }

    /**
     * Export the armored public key for a fingerprint.
     * Returns the ASCII-armored public key block.
     */
    exportPublicKey(fingerprint: string): string {
        const { stdout } = this.run(this.gpgPath, ['--export', '--armor', fingerprint]);
        return stdout;
    }

    /**
     * Import a public key from ASCII-armored or binary key data.
     * Writes keyData to a temp file and imports it; latin1 preserves binary material.
     */
    importPublicKey(keyData: string): void {
        const tmpFile = path.join(
            this.gnupgHome,
            `gpg-import-${crypto.randomBytes(4).toString('hex')}.asc`
        );
        try {
            fs.writeFileSync(tmpFile, keyData, 'latin1');
            this.run(this.gpgPath, ['--import', tmpFile]);
        } finally {
            try { fs.unlinkSync(tmpFile); } catch { /* tmp cleanup, ignore */ }
        }
    }

    // -------------------------------------------------------------------------
    // Crypto ops (called from Phase 3 test file, inside dev container)
    // These return exit code rather than throwing so callers can assert on failure.
    // -------------------------------------------------------------------------

    /** Sign inputPath; returns { exitCode, stdout, stderr }. */
    signFile(inputPath: string, userId: string): GpgExecResult {
        return this.runRaw(this.gpgPath, [
            '--batch', '--no-tty', '--sign', '--local-user', userId, inputPath
        ]);
    }

    /** Verify sigPath; returns { exitCode, stdout, stderr }. */
    verifyFile(sigPath: string): GpgExecResult {
        return this.runRaw(this.gpgPath, ['--verify', sigPath]);
    }

    /** Encrypt inputPath to recipient; returns { exitCode, stdout, stderr }. */
    encryptFile(inputPath: string, recipient: string): GpgExecResult {
        return this.runRaw(this.gpgPath, [
            '--batch', '--encrypt', '--recipient', recipient, inputPath
        ]);
    }

    /** Decrypt inputPath; returns { exitCode, stdout, stderr }. */
    decryptFile(inputPath: string): GpgExecResult {
        return this.runRaw(this.gpgPath, ['--batch', '--decrypt', inputPath]);
    }
}
