/**
 * GpgCli — Production base class for gpg/gpgconf subprocess operations.
 *
 * Handles:
 *   - Binary detection: explicit path validation, PATH probe (whichSync), or
 *     well-known Gpg4win locations (Windows fallback)
 *   - Optional GNUPGHOME injection into every subprocess call
 *   - gpgconf --list-dirs<br>   - gpg --list-secret-keys --with-colons  (listPairedKeys)
 *   - gpg --export                             (exportPublicKeys)
 *   - gpg --import via stdin                   (importPublicKeys)
 *
 * All subprocess I/O uses latin1 encoding to preserve binary key material.
 *
 * Subclassed by GpgTestHelper (shared/src/test/integration/gpgCli.ts) which
 * adds test-only methods and manages an isolated temp GNUPGHOME.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import which from 'which';

const execFileRaw = promisify(execFile);

// ============================================================================
// Well-known Gpg4win installation paths probed on Windows when PATH misses
// ============================================================================

const WELL_KNOWN_WINDOWS_PATHS = [
    'C:\\Program Files\\GnuPG\\bin',
    'C:\\Program Files\\Gpg4win\\bin',
    'C:\\Program Files (x86)\\GnuPG\\bin',
    'C:\\Program Files (x86)\\Gpg4win\\bin',
];

// ============================================================================
// Public interfaces
// ============================================================================

/** One entry per key pair you own (parsed from `gpg --list-secret-keys --with-colons`). */
export interface PairedKeyInfo {
    /** 40-char hex primary key fingerprint. */
    fingerprint: string;
    /** One or more UID strings (e.g. `'Alice <alice@example.com>'`). May be empty if key has no UIDs. */
    userIds: string[];
}

export interface GpgCliOpts {
    /** Absolute directory path containing gpg and gpgconf. If omitted or `''`, detection runs at construction time. */
    gpgBinDir?: string;
    /** If set, injected as GNUPGHOME in every subprocess call. */
    gnupgHome?: string;
}

/**
 * Shape of errors thrown by `promisify(execFile)` on non-zero exit.
 * `code` is `null` when the process was killed by a signal rather than exiting normally.
 */
export interface ExecFileError {
    code?: number | null;
    stdout?: string;
    stderr?: string;
}

/** Normalised result returned by every GpgCli subprocess helper. */
export interface GpgExecResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

// ============================================================================
// Dependency injection interfaces (for unit testing without real gpg)
// ============================================================================

/** Low-level subprocess execution function signature (injectable for tests). */
export type ExecFileFn = (
    binary: string,
    args: readonly string[],
    // `shell: false` is a literal type — the type system rejects any attempt to pass `shell: true`
    opts: { encoding: BufferEncoding; env: NodeJS.ProcessEnv; timeout?: number; maxBuffer?: number; readonly shell: false }
) => Promise<{ stdout: string; stderr: string }>;

/** Stdin-piping subprocess function signature (injectable for tests). */
export type SpawnForStdinFn = (
    binary: string,
    args: readonly string[],
    input: Buffer,
    env: NodeJS.ProcessEnv
) => Promise<GpgExecResult>;

/** Optional dependencies — all have production defaults. */
export interface GpgCliDeps {
    /** Override `fs.existsSync` (used in detection). */
    existsSync?: (p: string) => boolean;
    /** Override `which.sync` (used in PATH probe during detection). */
    whichSync?: (cmd: string) => string | null;
    /** Override the subprocess executor (used by run / runRaw). */
    execFileAsync?: ExecFileFn;
    /** Override the stdin-piping subprocess executor (used by importPublicKeys). */
    spawnForStdin?: SpawnForStdinFn;
}

// ============================================================================
// Default production implementations
// ============================================================================

/** Wraps `promisify(execFile)` with the simpler `ExecFileFn` signature. */
const defaultExecFileAsync: ExecFileFn = (binary, args, opts) =>
    // execFile's promisify overload returns { stdout: string; stderr: string }
    // when encoding is set; cast is safe here.
    execFileRaw(binary, [...args], opts) as unknown as Promise<{ stdout: string; stderr: string }>;

/** Spawns a process and pipes `input` to stdin; collects stdout/stderr as latin1. */
function defaultSpawnForStdin(
    binary: string,
    args: readonly string[],
    input: Buffer,
    env: NodeJS.ProcessEnv
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
        const child = spawn(binary, [...args], {
            env,
            shell: false,   // never allow shell interpolation — binary is invoked directly
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];

        child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
        child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

        child.stdin.write(input);
        child.stdin.end();

        child.on('close', (code) => {
            const stdout = Buffer.concat(stdoutChunks).toString('latin1');
            const stderr = Buffer.concat(stderrChunks).toString('latin1');
            resolve({ stdout, stderr, exitCode: code ?? 0 });
        });

        child.on('error', reject);
    });
}

// ============================================================================
// --with-colons output parser (pure function — unit testable without subprocess)
// ============================================================================

/**
 * Parse `gpg --list-secret-keys --with-colons` output into `PairedKeyInfo[]`.
 *
 * Record layout (relevant fields only):
 *   sec:  — primary key marker; starts a new entry
 *   fpr:  — fingerprint; field[9] is the 40-char hex fingerprint
 *   uid:  — user ID; field[9] is the UID string
 *   ssb:  — subkey marker; following fpr: records belong to the subkey, not primary
 *
 * The fingerprint immediately following a `sec:` record is the primary key fingerprint.
 * All `uid:` records up to the next `sec:` (or end of output) belong to that key.
 */
export function parsePairedKeys(output: string): PairedKeyInfo[] {
    const results: PairedKeyInfo[] = [];
    let current: PairedKeyInfo | null = null;
    let expectingPrimaryFpr = false;

    for (const line of output.split('\n')) {
        const fields = line.split(':');
        const recType = fields[0];

        if (recType === 'sec') {
            // Save the previous complete entry before starting a new one
            if (current?.fingerprint) {
                results.push(current);
            }
            current = { fingerprint: '', userIds: [] };
            expectingPrimaryFpr = true;
        } else if (recType === 'fpr' && expectingPrimaryFpr) {
            if (current) {
                current.fingerprint = fields[9]?.trim() ?? '';
            }
            expectingPrimaryFpr = false;
        } else if (recType === 'uid' && current) {
            const uid = fields[9]?.trim() ?? '';
            if (uid) {
                current.userIds.push(uid);
            }
        } else if (recType === 'ssb') {
            // Subkey — following fpr: records belong to the subkey, not the primary
            expectingPrimaryFpr = false;
        }
    }

    // Flush the last entry
    if (current?.fingerprint) {
        results.push(current);
    }

    return results;
}

// ============================================================================
// gpg --import stdout/stderr parser (pure function — unit testable)
// ============================================================================

/**
 * Parse `gpg --import` stderr output for summary statistics.
 *
 * Example stderr (success):
 *   gpg: key 0xABCDEF: public key "Alice <alice@example.com>" imported
 *   gpg: Total number processed: 1
 *   gpg:               imported: 1
 *
 * Example stderr (already imported):
 *   gpg: key 0xABCDEF: "Alice <alice@example.com>" not changed
 *   gpg: Total number processed: 1
 *   gpg:            unchanged: 1
 */
export function parseImportResult(output: string): { imported: number; unchanged: number; errors: number } {
    const importedMatch = output.match(/(?<!not )imported:\s*(\d+)/);
    const unchangedMatch = output.match(/\bunchanged:\s*(\d+)/);
    // gpg reports errors as "not imported: N" or "errors: N" depending on version
    const errorsMatch = output.match(/\bnot imported:\s*(\d+)/) ?? output.match(/\berrors:\s*(\d+)/);

    return {
        imported: importedMatch ? parseInt(importedMatch[1], 10) : 0,
        unchanged: unchangedMatch ? parseInt(unchangedMatch[1], 10) : 0,
        errors: errorsMatch ? parseInt(errorsMatch[1], 10) : 0,
    };
}

// ============================================================================
// Main class
// ============================================================================

export class GpgCli {
    private readonly binDir: string;
    // Protected so GpgTestHelper can call gpg/gpgconf directly via run()/runRaw()
    protected readonly gpgBin: string;
    protected readonly gpgconfBin: string;
    // Protected so GpgTestHelper can expose it as a narrowed public readonly string
    protected readonly gnupgHome: string | undefined;

    // Resolved deps (all fields populated — no optional at runtime)
    private readonly _existsSync: (p: string) => boolean;
    private readonly _whichSync: (cmd: string) => string | null;
    private readonly _execFileAsync: ExecFileFn;
    private readonly _spawnForStdin: SpawnForStdinFn;

    constructor(opts?: GpgCliOpts, deps?: Partial<GpgCliDeps>) {
        this._existsSync = deps?.existsSync ?? fs.existsSync;
        this._whichSync = deps?.whichSync ?? ((cmd) => which.sync(cmd, { nothrow: true }));
        this._execFileAsync = deps?.execFileAsync ?? defaultExecFileAsync;
        this._spawnForStdin = deps?.spawnForStdin ?? defaultSpawnForStdin;

        this.gnupgHome = opts?.gnupgHome;
        this.binDir = this.detect(opts?.gpgBinDir ?? '');

        const exe = (name: string) => path.join(this.binDir, process.platform === 'win32' ? `${name}.exe` : name);
        this.gpgBin = exe('gpg');
        this.gpgconfBin = exe('gpgconf');
    }

    // -------------------------------------------------------------------------
    // Private: detection (runs once at construction)
    // -------------------------------------------------------------------------

    private detect(gpgBinDir: string): string {
        const gpgconfName = process.platform === 'win32' ? 'gpgconf.exe' : 'gpgconf';

        if (gpgBinDir) {
            // Explicit path provided: validate it strictly — no fallback
            const gpgconfPath = path.join(gpgBinDir, gpgconfName);
            if (!this._existsSync(gpgconfPath)) {
                throw new Error(`GnuPG bin not found at configured path: ${gpgBinDir}`);
            }
            return gpgBinDir;
        }

        // Auto-detect: try PATH first (cross-platform, respects user environment)
        const fromPath = this._whichSync('gpgconf');
        if (fromPath) {
            return path.dirname(fromPath);
        }

        // Windows fallback: probe well-known Gpg4win locations
        if (process.platform === 'win32') {
            for (const dir of WELL_KNOWN_WINDOWS_PATHS) {
                if (this._existsSync(path.join(dir, gpgconfName))) {
                    return dir;
                }
            }
        }

        throw new Error('GnuPG bin not found. Please install Gpg4win or set gpgBridgeAgent.gpgBinDir.');
    }

    // -------------------------------------------------------------------------
    // Public: metadata
    // -------------------------------------------------------------------------

    /** Return the resolved bin directory path (useful for status display). */
    getBinDir(): string {
        return this.binDir;
    }

    // -------------------------------------------------------------------------
    // Protected: subprocess helpers (available to subclasses)
    // -------------------------------------------------------------------------

    /** Effective environment for subprocess calls. Always explicit (never inherits undefined). */
    protected get env(): NodeJS.ProcessEnv {
        return this.gnupgHome ? { ...process.env, GNUPGHOME: this.gnupgHome } : { ...process.env };
    }

    /**
     * Run a subprocess. Rejects (throws) on non-zero exit or spawn error.
     * Use for operations where failure is unexpected (gpgconf, key listing, export).
     */
    protected async run(binary: string, args: string[]): Promise<GpgExecResult> {
        const { stdout, stderr } = await this._execFileAsync(binary, args, {
            encoding: 'latin1',
            env: this.env,
            shell: false,   // never allow shell interpolation — binary is invoked directly
            timeout: 10000,
            maxBuffer: 1024 * 1024, // 1 MB — largest expected: ~256 KB for bulk export
        });
        return { exitCode: 0, stdout, stderr };
    }

    /**
     * Run a subprocess. Returns exit code instead of rejecting on non-zero exit.
     * Use for operations where the caller needs to inspect the exit code.
     */
    protected async runRaw(binary: string, args: string[]): Promise<GpgExecResult> {
        try {
            return await this.run(binary, args);
        } catch (err: unknown) {
            // promisify(execFile) rejects with ExecFileError on non-zero exit;
            // code is null only when the process was killed by a signal.
            // Extract those values and return normally.
            const e = err as ExecFileError;
            if (typeof e.code === 'number' && typeof e.stdout === 'string') {
                return { exitCode: e.code, stdout: e.stdout, stderr: e.stderr ?? '' };
            }
            throw err; // spawn error (ENOENT, timeout, etc.) — propagate
        }
    }

    // -------------------------------------------------------------------------
    // Public: gpgconf
    // -------------------------------------------------------------------------

    /**
     * Run `gpgconf --list-dirs <dirName>` and return the trimmed path string.
     * Throws on non-zero exit or empty output.
     */
    async gpgconfListDirs(dirName: string): Promise<string> {
        const { stdout } = await this.run(this.gpgconfBin, ['--list-dirs', dirName]);
        const trimmed = stdout.trim();
        if (!trimmed) {
            throw new Error(`gpgconf --list-dirs ${dirName} returned empty output`);
        }
        return trimmed;
    }

    // -------------------------------------------------------------------------
    // Public: key operations
    // -------------------------------------------------------------------------

    /**
     * List all key pairs in the keyring.
     * Runs `gpg --list-secret-keys --with-colons` and parses the output.
     * Returns an empty array if the keyring has no secret keys.
     */
    async listPairedKeys(): Promise<PairedKeyInfo[]> {
        const { stdout } = await this.run(this.gpgBin, ['--list-secret-keys', '--with-colons']);
        return parsePairedKeys(stdout);
    }

    /**
     * Export public keys as binary data.
     * @param filter Optional GPG identifier (fingerprint, email, key ID) or space-separated list.
     *               If omitted, exports all public keys.
     * @returns Binary key data as `Uint8Array`. Empty if no keys match the filter.
     */
    async exportPublicKeys(filter?: string): Promise<Uint8Array> {
        const args = ['--export'];
        if (filter) {
            // Space-separated identifiers are passed as individual arguments
            args.push(...filter.split(' ').filter(Boolean));
        }
        const { stdout } = await this.run(this.gpgBin, args);
        return Buffer.from(stdout, 'latin1');
    }

    /**
     * Import public keys from binary data.
     * Key data is passed via stdin — no temp file written to disk.
     * @returns Parsed statistics from `gpg --import` output.
     */
    async importPublicKeys(keyData: Uint8Array): Promise<{ imported: number; unchanged: number; errors: number }> {
        const { stderr } = await this._spawnForStdin(
            this.gpgBin,
            ['--import'],
            Buffer.from(keyData),
            this.env
        );
        // gpg --import writes its summary statistics to stderr
        return parseImportResult(stderr);
    }

    /**
     * No-op in base class.
     * Overridden by `GpgTestHelper` to kill the test gpg-agent and delete the temp GNUPGHOME.
     */
    async cleanup(): Promise<void> {
        // no-op
    }
}
