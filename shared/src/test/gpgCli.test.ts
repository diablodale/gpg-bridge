/**
 * Unit tests for GpgCli, parsePairedKeys, parsePublicKeys, and parseImportResult.
 *
 * All subprocess calls are mocked — no real gpg required, no keyring access.
 * Dependency injection via GpgCliDeps parameter of the GpgCli constructor.
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import * as path from 'path';
import {
    GpgCli,
    parsePairedKeys,
    parsePublicKeys,
    parseImportResult,
    unescapeGpgColonField,
    type GpgCliDeps,
    type ExecFileFn,
    type SpawnForStdinFn,
} from '../gpgCli';

// ============================================================================
// Mock factories
// ============================================================================

/** existsSync that returns true only for the given path. */
function existsAt(...allowed: string[]): GpgCliDeps['existsSync'] {
    return (p: string) => allowed.includes(p);
}

/** whichSync that always returns null (gpgconf not on PATH). */
const whichMiss: GpgCliDeps['whichSync'] = () => null;

/** whichSync that returns the given full path when queried for 'gpgconf'. */
function whichReturns(fullPath: string): GpgCliDeps['whichSync'] {
    return (cmd: string) => cmd === 'gpgconf' ? fullPath : null;
}

/** execFileAsync that resolves with the given stdout. */
function execReturns(stdout: string, stderr = ''): ExecFileFn {
    return () => Promise.resolve({ stdout, stderr });
}

/** execFileAsync that rejects simulating a non-zero exit (like promisify(execFile) does). */
function execFails(exitCode: number, stdout = '', stderr = ''): ExecFileFn {
    return () => Promise.reject(Object.assign(new Error('process exited with non-zero'), { code: exitCode, stdout, stderr }));
}

/** execFileAsync that records the last call's arguments and resolves with given output. */
function execCapture(stdout: string, stderr = ''): { fn: ExecFileFn; lastArgs: { binary: string; args: readonly string[]; opts: object } | null } {
    const capture = { fn: null as unknown as ExecFileFn, lastArgs: null as { binary: string; args: readonly string[]; opts: object } | null };
    capture.fn = (binary, args, opts) => {
        capture.lastArgs = { binary, args, opts };
        return Promise.resolve({ stdout, stderr });
    };
    return capture;
}

/** spawnForStdin that resolves with given output. */
function spawnReturns(stdout: string, stderr: string, exitCode = 0): SpawnForStdinFn {
    return () => Promise.resolve({ stdout, stderr, exitCode });
}

/** spawnForStdin that records passed-in stdin buffer and args. */
function spawnCapture(stderr: string): { fn: SpawnForStdinFn; lastInput: Buffer | null; lastArgs: readonly string[] | null } {
    const capture = { fn: null as unknown as SpawnForStdinFn, lastInput: null as Buffer | null, lastArgs: null as readonly string[] | null };
    capture.fn = (_binary, args, input, _env) => {
        capture.lastInput = input;
        capture.lastArgs = args;
        return Promise.resolve({ stdout: '', stderr, exitCode: 0 });
    };
    return capture;
}

// ============================================================================
// A valid fake bin dir for use across tests (existence checked via mock)
// ============================================================================

const FAKE_BIN = 'C:\\Fake\\GnuPG\\bin';
const FAKE_GPGCONF_EXE = path.join(FAKE_BIN, process.platform === 'win32' ? 'gpgconf.exe' : 'gpgconf');
const FAKE_GPG_EXE = path.join(FAKE_BIN, process.platform === 'win32' ? 'gpg.exe' : 'gpg');
const FAKE_GPGCONF_BIN = path.join(FAKE_BIN, process.platform === 'win32' ? 'gpgconf.exe' : 'gpgconf');

/** Build a GpgCli with a pre-validated fake bin dir and injectable exec. */
function makeCli(execFn: ExecFileFn, spawnFn?: SpawnForStdinFn, gnupgHome?: string): GpgCli {
    return new GpgCli(
        { gpgBinDir: FAKE_BIN, gnupgHome },
        {
            existsSync: existsAt(FAKE_GPGCONF_EXE),
            whichSync: whichMiss,
            execFileAsync: execFn,
            spawnForStdin: spawnFn ?? spawnReturns('', '', 0),
        }
    );
}

// ============================================================================
// GpgCli constructor
// ============================================================================

describe('GpgCli', () => {
    describe('constructor', () => {
        it('throws when gpgBinDir points to a directory without gpgconf[.exe]', () => {
            expect(() => new GpgCli(
                { gpgBinDir: FAKE_BIN },
                { existsSync: () => false, whichSync: whichMiss }
            )).to.throw(/GnuPG bin not found at configured path/);
        });

        it('succeeds when gpgBinDir is valid (mocked existsSync confirms gpgconf exists)', () => {
            expect(() => new GpgCli(
                { gpgBinDir: FAKE_BIN },
                { existsSync: existsAt(FAKE_GPGCONF_EXE), whichSync: whichMiss }
            )).not.to.throw();
        });

        it('succeeds via PATH probe when whichSync returns a path', () => {
            const whichPath = '/usr/bin/gpgconf';
            expect(() => new GpgCli(
                {},
                { existsSync: () => false, whichSync: whichReturns(whichPath) }
            )).not.to.throw();
        });

        it('throws when both PATH probe and explicit path fail', () => {
            expect(() => new GpgCli(
                {},
                { existsSync: () => false, whichSync: () => null }
            )).to.throw(/GnuPG bin not found/);
        });
    });

    // ============================================================================
    // getBinDir
    // ============================================================================

    describe('getBinDir()', () => {
        it('returns the resolved bin directory', () => {
            const cli = new GpgCli(
                { gpgBinDir: FAKE_BIN },
                { existsSync: existsAt(FAKE_GPGCONF_EXE), whichSync: whichMiss }
            );
            expect(cli.getBinDir()).to.equal(FAKE_BIN);
        });

        it('returns dirname of the path found by whichSync when gpgBinDir is omitted', () => {
            const whichPath = '/usr/bin/gpgconf';
            const cli = new GpgCli(
                {},
                { existsSync: () => false, whichSync: whichReturns(whichPath) }
            );
            expect(cli.getBinDir()).to.equal(path.dirname(whichPath));
        });
    });

    // ============================================================================
    // gpgconfListDirs
    // ============================================================================

    describe('gpgconfListDirs()', () => {
        it('returns trimmed path string on success', async () => {
            const cli = makeCli(execReturns('/run/user/1000/gnupg/S.gpg-agent\n'));
            const result = await cli.gpgconfListDirs('agent-socket');
            expect(result).to.equal('/run/user/1000/gnupg/S.gpg-agent');
        });

        it('passes the correct binary and arguments to execFileAsync', async () => {
            const capture = execCapture('/tmp/S.gpg-agent\n');
            const cli = makeCli(capture.fn);
            await cli.gpgconfListDirs('agent-extra-socket');
            expect(capture.lastArgs!.binary).to.equal(FAKE_GPGCONF_BIN);
            expect(capture.lastArgs!.args).to.deep.equal(['--list-dirs', 'agent-extra-socket']);
        });

        it('throws on non-zero exit (mock subprocess rejects)', async () => {
            const cli = makeCli(execFails(2));
            try {
                await cli.gpgconfListDirs('agent-socket');
                expect.fail('Expected gpgconfListDirs to throw on non-zero exit');
            } catch (error: unknown) {
                expect(error).to.be.instanceOf(Error);
            }
        });
    });

    // ============================================================================
    // listPairedKeys
    // ============================================================================

    describe('listPairedKeys()', () => {
        it('parses --with-colons output and returns PairedKeyInfo[]', async () => {
            // Minimal colon-format output for one key with one UID
            const output = [
                'sec::255:20230101T000000Z:::::::sc:::::23::0:',
                'fpr:::::::::AABBCCDDAABBCCDDAABBCCDDAABBCCDDAABBCCDD:',
                'uid:::1::::::Alice <alice@example.com>:::::::::0:',
            ].join('\n');
            const cli = makeCli(execReturns(output));
            const keys = await cli.listPairedKeys();
            expect(keys).to.have.length(1);
            expect(keys[0].fingerprint).to.equal('AABBCCDDAABBCCDDAABBCCDDAABBCCDDAABBCCDD');
            expect(keys[0].userIds).to.deep.equal(['Alice <alice@example.com>']);
        });

        it('returns empty array when output is empty', async () => {
            const cli = makeCli(execReturns(''));
            const keys = await cli.listPairedKeys();
            expect(keys).to.deep.equal([]);
        });

        it('passes correct arguments to execFileAsync', async () => {
            const capture = execCapture('');
            const cli = makeCli(capture.fn);
            await cli.listPairedKeys();
            expect(capture.lastArgs!.binary).to.equal(FAKE_GPG_EXE);
            expect(capture.lastArgs!.args).to.deep.equal(['--list-secret-keys', '--with-colons']);
        });

        it('decodes UTF-8 UIDs correctly (e.g. umlauts appear as single characters)', async () => {
            // run() is called with encoding:'utf8' for --with-colons output;
            // the mock returns the UTF-8 string directly, as Node would.
            const utf8Uid = 'Horst M\u00fcller <horst@example.com>';  // \u00fc = ü
            const output = [
                'sec::255:::::::AABBCCDD:::sc:',
                'fpr:::::::::AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:',
                `uid:::::::::${utf8Uid}::::::::::0:`,
            ].join('\n');
            const cli = makeCli(execReturns(output));
            const keys = await cli.listPairedKeys();
            expect(keys[0].userIds[0]).to.equal(utf8Uid);
        });
    });

    // ============================================================================
    // listPublicKeys
    // ============================================================================

    describe('listPublicKeys()', () => {
        it('parses --with-colons output and returns PairedKeyInfo[]', async () => {
            // Minimal colon-format output for one public key with one UID
            const output = [
                'pub::255:20230101T000000Z:::::::sc:::::23::0:',
                'fpr:::::::::AABBCCDDAABBCCDDAABBCCDDAABBCCDDAABBCCDD:',
                'uid:::1::::::Alice <alice@example.com>:::::::::0:',
            ].join('\n');
            const cli = makeCli(execReturns(output));
            const keys = await cli.listPublicKeys();
            expect(keys).to.have.length(1);
            expect(keys[0].fingerprint).to.equal('AABBCCDDAABBCCDDAABBCCDDAABBCCDDAABBCCDD');
            expect(keys[0].userIds).to.deep.equal(['Alice <alice@example.com>']);
        });

        it('returns empty array when output is empty', async () => {
            const cli = makeCli(execReturns(''));
            const keys = await cli.listPublicKeys();
            expect(keys).to.deep.equal([]);
        });

        it('passes correct arguments to execFileAsync', async () => {
            const capture = execCapture('');
            const cli = makeCli(capture.fn);
            await cli.listPublicKeys();
            expect(capture.lastArgs!.binary).to.equal(FAKE_GPG_EXE);
            expect(capture.lastArgs!.args).to.deep.equal(['--list-keys', '--with-colons', '--with-secret']);
        });

        it('decodes UTF-8 UIDs correctly (e.g. umlauts appear as single characters)', async () => {
            // run() is called with encoding:'utf8' for --with-colons output;
            // the mock returns the UTF-8 string directly, as Node would.
            const utf8Uid = 'K\u00f6nig Josef <josef@example.com>';  // \u00f6 = ö
            const output = [
                'pub::255:::::::AABBCCDD:::sc:',
                'fpr:::::::::AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:',
                `uid:::::::::${utf8Uid}::::::::::0:`,
            ].join('\n');
            const cli = makeCli(execReturns(output));
            const keys = await cli.listPublicKeys();
            expect(keys[0].userIds[0]).to.equal(utf8Uid);
        });
    });

    // ============================================================================
    // exportPublicKeys
    // ============================================================================

    describe('exportPublicKeys()', () => {
        it('returns armored string of key data', async () => {
            const armorText = '-----BEGIN PGP PUBLIC KEY BLOCK-----\nFAKEKEYDATA\n-----END PGP PUBLIC KEY BLOCK-----\n';
            const cli = makeCli(execReturns(armorText));
            const result = await cli.exportPublicKeys('AABBCCDD');
            expect(result).to.be.a('string');
            expect(result).to.equal(armorText);
        });

        it('returns empty string when subprocess produces no output', async () => {
            const cli = makeCli(execReturns(''));
            const result = await cli.exportPublicKeys('nobody@example.com');
            expect(result).to.be.a('string');
            expect(result).to.equal('');
        });

        it('calls gpg with --export and no args when filter is omitted', async () => {
            const capture = execCapture('');
            const cli = makeCli(capture.fn);
            await cli.exportPublicKeys();
            expect(capture.lastArgs!.args).to.deep.equal(['--armor', '--export']);
        });

        it('splits space-separated filter into individual arguments', async () => {
            const capture = execCapture('');
            const cli = makeCli(capture.fn);
            await cli.exportPublicKeys('FPR1 FPR2');
            expect(capture.lastArgs!.args).to.deep.equal(['--armor', '--export', 'FPR1', 'FPR2']);
        });
    });

    // ============================================================================
    // importPublicKeys
    // ============================================================================

    describe('importPublicKeys()', () => {
        it('parses success result: { imported: 1, unchanged: 0, errors: 0 }', async () => {
            const stderr = [
                'gpg: key AABBCCDD: public key "Alice <alice@example.com>" imported',
                'gpg: Total number processed: 1',
                'gpg:               imported: 1',
            ].join('\n');
            const cli = makeCli(execReturns(''), spawnReturns('', stderr, 0));
            const result = await cli.importPublicKeys('armor-stub');
            expect(result).to.deep.equal({ imported: 1, unchanged: 0, errors: 0 });
        });

        it('parses already-imported result: { imported: 0, unchanged: 1, errors: 0 }', async () => {
            const stderr = [
                'gpg: key AABBCCDD: "Alice <alice@example.com>" not changed',
                'gpg: Total number processed: 1',
                'gpg:            unchanged: 1',
            ].join('\n');
            const cli = makeCli(execReturns(''), spawnReturns('', stderr, 0));
            const result = await cli.importPublicKeys('armor-stub');
            expect(result).to.deep.equal({ imported: 0, unchanged: 1, errors: 0 });
        });

        it('passes keyData as latin1 stdin to spawnForStdin', async () => {
            const capture = spawnCapture('gpg: Total number processed: 0\n');
            const cli = makeCli(execReturns(''), capture.fn);
            const keyData = 'armor-test-data';
            await cli.importPublicKeys(keyData);
            expect(capture.lastInput).not.to.be.null;
            expect(capture.lastInput!.toString('latin1')).to.equal(keyData);
        });

        it('passes --no-autostart to prevent gpg contacting the agent socket', async () => {
            // On the remote machine the agent socket is the bridge relay — connecting
            // to it during import would cause a feedback loop.
            const capture = spawnCapture('gpg: Total number processed: 0\n');
            const cli = makeCli(execReturns(''), capture.fn);
            await cli.importPublicKeys('armor-stub');
            expect(capture.lastArgs).to.include('--no-autostart');
        });
    });

    // ============================================================================
    // GNUPGHOME injection
    // ============================================================================

    describe('GNUPGHOME injection', () => {
        it('injects GNUPGHOME into env when gnupgHome opt is set', async () => {
            const capture = execCapture('/tmp/S.gpg-agent\n');
            const cli = makeCli(capture.fn, undefined, '/tmp/my-gnupghome');
            await cli.gpgconfListDirs('agent-socket');
            const opts = capture.lastArgs!.opts as { env?: NodeJS.ProcessEnv };
            expect(opts.env?.GNUPGHOME).to.equal('/tmp/my-gnupghome');
        });

        it('does NOT set GNUPGHOME in env when gnupgHome opt is not provided', async () => {
            // Build cli WITHOUT gnupgHome
            const capture = execCapture('/tmp/S.gpg-agent\n');
            const cli = new GpgCli(
                { gpgBinDir: FAKE_BIN },
                {
                    existsSync: existsAt(FAKE_GPGCONF_EXE),
                    whichSync: whichMiss,
                    execFileAsync: capture.fn,
                }
            );
            await cli.gpgconfListDirs('agent-socket');
            const opts = capture.lastArgs!.opts as { env?: NodeJS.ProcessEnv };
            // GNUPGHOME from the ambient process.env may or may not exist; the key
            // we care about is that GpgCli did NOT inject it from opts (value would
            // be undefined or whatever process.env already had).
            // We test this by verifying that gnupgHome was NOT passed as our sentinel.
            expect(opts.env?.GNUPGHOME).not.to.equal('/tmp/my-gnupghome');
        });
    });
});

// ============================================================================
// parsePairedKeys (pure function — no subprocess)
// ============================================================================

describe('parsePairedKeys()', () => {
    it('returns empty array for empty input', () => {
        expect(parsePairedKeys('')).to.deep.equal([]);
    });

    it('parses a single key with one UID', () => {
        const output = [
            'sec::255:::::::AABBCCDD:::sc:',
            'fpr:::::::::AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:',
            'uid:::::::::Alice <alice@example.com>:::::::::0:',
        ].join('\n');
        const result = parsePairedKeys(output);
        expect(result).to.have.length(1);
        expect(result[0].fingerprint).to.equal('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
        expect(result[0].userIds).to.deep.equal(['Alice <alice@example.com>']);
        expect(result[0].hasSecret, 'parsePairedKeys sets hasSecret=true').to.be.true;
        expect(result[0].revoked, 'non-revoked key: revoked=false').to.be.false;
        expect(result[0].expired, 'non-expired key: expired=false').to.be.false;
    });

    it('parses multiple keys', () => {
        const output = [
            'sec::255:::::::KEY1:::sc:',
            'fpr:::::::::AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:',
            'uid:::::::::Alice <alice@example.com>:::::::::0:',
            'sec::255:::::::KEY2:::sc:',
            'fpr:::::::::BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB:',
            'uid:::::::::Bob <bob@example.com>:::::::::0:',
        ].join('\n');
        const result = parsePairedKeys(output);
        expect(result).to.have.length(2);
        expect(result[0].fingerprint).to.equal('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
        expect(result[1].fingerprint).to.equal('BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
    });

    it('collects multiple UIDs for a single key', () => {
        const output = [
            'sec::255:::::::KEY1:::sc:',
            'fpr:::::::::AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:',
            'uid:::::::::Alice <alice@example.com>:::::::::0:',
            'uid:::::::::Alice Work <alice@work.example.com>:::::::::0:',
        ].join('\n');
        const result = parsePairedKeys(output);
        expect(result[0].userIds).to.deep.equal([
            'Alice <alice@example.com>',
            'Alice Work <alice@work.example.com>',
        ]);
    });

    it('does not include subkey fingerprints as the primary fingerprint', () => {
        const output = [
            'sec::255:::::::KEY1:::sc:',
            'fpr:::::::::AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:',
            'uid:::::::::Alice <alice@example.com>:::::::::0:',
            'ssb::255:::::::SUB1:::e:',
            'fpr:::::::::CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC:',  // subkey fpr — must not replace primary
        ].join('\n');
        const result = parsePairedKeys(output);
        expect(result).to.have.length(1);
        expect(result[0].fingerprint).to.equal('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    });

    it('skips keys with no fingerprint', () => {
        // sec: record without a following fpr: record — malformed, should be ignored
        const output = [
            'sec::255:::::::KEY1:::sc:',
            'uid:::::::::Alice <alice@example.com>:::::::::0:',
        ].join('\n');
        const result = parsePairedKeys(output);
        expect(result).to.deep.equal([]);
    });

    it('unescapes \\xNN sequences in UID field (e.g. \\x3a → colon)', () => {
        // GPG escapes `:` as `\x3a` to avoid breaking the colon-delimited format;
        // any UID containing a literal colon must be round-tripped correctly.
        const output = [
            'sec::255:::::::KEY1:::sc:',
            'fpr:::::::::AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:',
            'uid:::::::::Display Name \\x3a Subtitle <test@example.com>:::::::::0:',
        ].join('\n');
        const result = parsePairedKeys(output);
        expect(result[0].userIds[0]).to.equal('Display Name : Subtitle <test@example.com>');
    });

    it('ignores grp: records between fpr: and uid: without affecting parsing', () => {
        // grp: (keygrip) records appear after every fpr: in real gpg output
        const output = [
            'sec::255:::::::KEY1:::sc:',
            'fpr:::::::::AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:',
            'grp:::::::::0000000000000000000000000000000000000000:',
            'uid:::::::::Alice <alice@example.com>:::::::::0:',
        ].join('\n');
        const result = parsePairedKeys(output);
        expect(result).to.have.length(1);
        expect(result[0].fingerprint).to.equal('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
        expect(result[0].userIds).to.deep.equal(['Alice <alice@example.com>']);
    });

    it('includes revoked keys (sec:r: status field)', () => {
        // revoked keys still appear in --list-secret-keys output; parser must not filter by status
        const output = [
            'sec:r:2048:1:AABBCCDDAABBCCDD:::sc:',
            'fpr:::::::::AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:',
            'grp:::::::::0000000000000000000000000000000000000000:',
            'uid:r::::::::Revoked User <revoked@example.com>:::::::::0:',
        ].join('\n');
        const result = parsePairedKeys(output);
        expect(result).to.have.length(1);
        expect(result[0].fingerprint).to.equal('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
        expect(result[0].userIds).to.deep.equal(['Revoked User <revoked@example.com>']);
        expect(result[0].revoked, 'sec:r: sets revoked=true').to.be.true;
        expect(result[0].hasSecret, 'revoked paired key still has hasSecret=true').to.be.true;
    });

    it('includes expired keys (sec:e: status field)', () => {
        const output = [
            'sec:e:2048:1:AABBCCDDAABBCCDD:::sc:',
            'fpr:::::::::AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:',
            'uid:e::::::::Expired User <expired@example.com>:::::::::0:',
        ].join('\n');
        const result = parsePairedKeys(output);
        expect(result).to.have.length(1);
        expect(result[0].expired, 'sec:e: sets expired=true').to.be.true;
        expect(result[0].revoked, 'expired key: revoked=false').to.be.false;
        expect(result[0].hasSecret, 'expired paired key: hasSecret=true').to.be.true;
    });

    it('ignores all subkey fpr: and grp: records when key has many subkeys', () => {
        // Each ssb: is followed by its own fpr: and grp: — none must become the primary fingerprint
        const output = [
            'sec::255:::::::KEY1:::sc:',
            'fpr:::::::::AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:',
            'grp:::::::::GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG:',
            'uid:::::::::Alice <alice@example.com>:::::::::0:',
            'ssb::255:::::::SUB1:::s:',
            'fpr:::::::::BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB:',
            'grp:::::::::HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH:',
            'ssb::255:::::::SUB2:::e:',
            'fpr:::::::::CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC:',
            'grp:::::::::IIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII:',
            'ssb::255:::::::SUB3:::a:',
            'fpr:::::::::DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD:',
            'grp:::::::::JJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJ:',
        ].join('\n');
        const result = parsePairedKeys(output);
        expect(result).to.have.length(1);
        expect(result[0].fingerprint).to.equal('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    });

    it('parses complex output: revoked key, multiple subkeys, grp: records, multiple UIDs', () => {
        // Synthetic --with-colons output matching real gpg format structure:
        // Key 1: revoked, RSA-2048, one UID, one subkey
        // Key 2: ultimate trust, RSA-4096, two UIDs, fourteen subkeys (s/e/a × 4 generations + s/e ed25519/cv25519)
        // All hex values are synthetic — no real key material.
        //   h40(n) → 40-char fingerprint/keygrip: the byte 'n' repeated 20 times
        //   h16(n) → 16-char key ID:              the byte 'n' repeated 8 times
        const h40 = (n: number): string => n.toString(16).padStart(2, '0').repeat(20).toUpperCase();
        const h16 = (n: number): string => n.toString(16).padStart(2, '0').repeat(8).toUpperCase();

        const K1_FPR = h40(0x10);  // Key 1 primary fingerprint (asserted below)
        const K2_FPR = h40(0x20);  // Key 2 primary fingerprint (asserted below)

        const output = [
            // --- Key 1: revoked, RSA-2048, one UID, one subkey ---
            `sec:r:2048:1:${h16(0x11)}:1234567890:::-:::sc:::+:::23::0:`,
            `fpr:::::::::${K1_FPR}:`,
            `grp:::::::::${h40(0x12)}:`,
            `uid:r::::1234567890::${h40(0x13)}::Test User One (primary) <one@example.com>::::::::::0:`,
            `ssb:r:2048:1:${h16(0x14)}:1234567890::::::e:::+:::23:`,
            `fpr:::::::::${h40(0x15)}:`,
            `grp:::::::::${h40(0x16)}:`,
            // --- Key 2: ultimate trust, RSA-4096, two UIDs, fourteen subkeys ---
            `sec:u:4096:1:${h16(0x21)}:1234567890:::u:::scESC:::+:::23::0:`,
            `fpr:::::::::${K2_FPR}:`,
            `grp:::::::::${h40(0x22)}:`,
            `uid:u::::1234567890::${h40(0x23)}::Test User Two <two@example.com>::::::::::0:`,
            `uid:u::::1234567890::${h40(0x24)}::Test User Two Alt <two.alt@example.com>::::::::::0:`,
            // generation 1: s/e/a, RSA-2048
            `ssb:e:2048:1:${h16(0x31)}:1234567890:1234567890:::::s:::+:::23:`,
            `fpr:::::::::${h40(0x31)}:`,
            `grp:::::::::${h40(0x32)}:`,
            `ssb:e:2048:1:${h16(0x33)}:1234567890:1234567890:::::e:::+:::23:`,
            `fpr:::::::::${h40(0x33)}:`,
            `grp:::::::::${h40(0x34)}:`,
            `ssb:e:2048:1:${h16(0x35)}:1234567890:1234567890:::::a:::+:::23:`,
            `fpr:::::::::${h40(0x35)}:`,
            `grp:::::::::${h40(0x36)}:`,
            // generation 2: s/e/a, RSA-2048
            `ssb:e:2048:1:${h16(0x41)}:1234567890:1234567890:::::s:::+:::23:`,
            `fpr:::::::::${h40(0x41)}:`,
            `grp:::::::::${h40(0x42)}:`,
            `ssb:e:2048:1:${h16(0x43)}:1234567890:1234567890:::::e:::+:::23:`,
            `fpr:::::::::${h40(0x43)}:`,
            `grp:::::::::${h40(0x44)}:`,
            `ssb:e:2048:1:${h16(0x45)}:1234567890:1234567890:::::a:::+:::23:`,
            `fpr:::::::::${h40(0x45)}:`,
            `grp:::::::::${h40(0x46)}:`,
            // generation 3: s/e/a, RSA-3072
            `ssb:e:3072:1:${h16(0x51)}:1234567890:1234567890:::::s:::+:::23:`,
            `fpr:::::::::${h40(0x51)}:`,
            `grp:::::::::${h40(0x52)}:`,
            `ssb:e:3072:1:${h16(0x53)}:1234567890:1234567890:::::e:::+:::23:`,
            `fpr:::::::::${h40(0x53)}:`,
            `grp:::::::::${h40(0x54)}:`,
            `ssb:e:3072:1:${h16(0x55)}:1234567890:1234567890:::::a:::+:::23:`,
            `fpr:::::::::${h40(0x55)}:`,
            `grp:::::::::${h40(0x56)}:`,
            // generation 4: s/e/a, RSA-3072
            `ssb:e:3072:1:${h16(0x61)}:1234567890:1234567890:::::s:::+:::23:`,
            `fpr:::::::::${h40(0x61)}:`,
            `grp:::::::::${h40(0x62)}:`,
            `ssb:e:3072:1:${h16(0x63)}:1234567890:1234567890:::::e:::+:::23:`,
            `fpr:::::::::${h40(0x63)}:`,
            `grp:::::::::${h40(0x64)}:`,
            `ssb:e:3072:1:${h16(0x65)}:1234567890:1234567890:::::a:::+:::23:`,
            `fpr:::::::::${h40(0x65)}:`,
            `grp:::::::::${h40(0x66)}:`,
            // generation 5: s/e, ed25519/cv25519
            `ssb:u:255:22:${h16(0x71)}:1234567890:1234567890:::::s:::+::ed25519::`,
            `fpr:::::::::${h40(0x71)}:`,
            `grp:::::::::${h40(0x72)}:`,
            `ssb:u:255:18:${h16(0x73)}:1234567890:1234567890:::::e:::+::cv25519::`,
            `fpr:::::::::${h40(0x73)}:`,
            `grp:::::::::${h40(0x74)}:`,
        ].join('\n');

        const result = parsePairedKeys(output);

        expect(result).to.have.length(2);

        // Key 1: revoked; one UID; one subkey — primary fingerprint must not be replaced by subkey fpr
        expect(result[0].fingerprint).to.equal(K1_FPR);
        expect(result[0].userIds).to.deep.equal([
            'Test User One (primary) <one@example.com>',
        ]);

        // Key 2: ultimate trust; two UIDs; fourteen subkeys — none should pollute fingerprint
        expect(result[1].fingerprint).to.equal(K2_FPR);
        expect(result[1].userIds).to.deep.equal([
            'Test User Two <two@example.com>',
            'Test User Two Alt <two.alt@example.com>',
        ]);
    });
});

// ============================================================================
// parsePublicKeys (pure function — no subprocess)
// ============================================================================

describe('parsePublicKeys()', () => {
    it('returns empty array for empty input', () => {
        expect(parsePublicKeys('')).to.deep.equal([]);
    });

    it('parses a single public key with one UID', () => {
        const output = [
            'pub::255:::::::AABBCCDD:::sc:',
            'fpr:::::::::AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:',
            'uid:::::::::Alice <alice@example.com>:::::::::0:',
        ].join('\n');
        const result = parsePublicKeys(output);
        expect(result).to.have.length(1);
        expect(result[0].fingerprint).to.equal('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
        expect(result[0].userIds).to.deep.equal(['Alice <alice@example.com>']);
        expect(result[0].hasSecret, 'parsePublicKeys sets hasSecret=false').to.be.false;
        expect(result[0].revoked, 'non-revoked pub key: revoked=false').to.be.false;
        expect(result[0].expired, 'non-expired pub key: expired=false').to.be.false;
    });

    it('parses multiple public keys', () => {
        const output = [
            'pub::255:::::::KEY1:::sc:',
            'fpr:::::::::AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:',
            'uid:::::::::Alice <alice@example.com>:::::::::0:',
            'pub::255:::::::KEY2:::sc:',
            'fpr:::::::::BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB:',
            'uid:::::::::Bob <bob@example.com>:::::::::0:',
        ].join('\n');
        const result = parsePublicKeys(output);
        expect(result).to.have.length(2);
        expect(result[0].fingerprint).to.equal('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
        expect(result[1].fingerprint).to.equal('BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
    });

    it('collects multiple UIDs for a single public key', () => {
        const output = [
            'pub::255:::::::KEY1:::sc:',
            'fpr:::::::::AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:',
            'uid:::::::::Alice <alice@example.com>:::::::::0:',
            'uid:::::::::Alice Work <alice@work.example.com>:::::::::0:',
        ].join('\n');
        const result = parsePublicKeys(output);
        expect(result[0].userIds).to.deep.equal([
            'Alice <alice@example.com>',
            'Alice Work <alice@work.example.com>',
        ]);
    });

    it('does not include subkey fingerprints as the primary fingerprint', () => {
        // sub: is the public-keyring equivalent of ssb: in the secret keyring
        const output = [
            'pub::255:::::::KEY1:::sc:',
            'fpr:::::::::AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:',
            'uid:::::::::Alice <alice@example.com>:::::::::0:',
            'sub::255:::::::SUB1:::e:',
            'fpr:::::::::CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC:',
        ].join('\n');
        const result = parsePublicKeys(output);
        expect(result).to.have.length(1);
        expect(result[0].fingerprint).to.equal('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    });

    it('skips keys with no fingerprint', () => {
        const output = [
            'pub::255:::::::KEY1:::sc:',
            'uid:::::::::Alice <alice@example.com>:::::::::0:',
        ].join('\n');
        const result = parsePublicKeys(output);
        expect(result).to.deep.equal([]);
    });

    it('unescapes \\xNN sequences in UID field (e.g. \\x3a → colon)', () => {
        const output = [
            'pub::255:::::::KEY1:::sc:',
            'fpr:::::::::AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:',
            'uid:::::::::Display Name \\x3a Subtitle <test@example.com>:::::::::0:',
        ].join('\n');
        const result = parsePublicKeys(output);
        expect(result[0].userIds[0]).to.equal('Display Name : Subtitle <test@example.com>');
    });

    it('ignores grp: records between fpr: and uid: without affecting parsing', () => {
        const output = [
            'pub::255:::::::KEY1:::sc:',
            'fpr:::::::::AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:',
            'grp:::::::::0000000000000000000000000000000000000000:',
            'uid:::::::::Alice <alice@example.com>:::::::::0:',
        ].join('\n');
        const result = parsePublicKeys(output);
        expect(result).to.have.length(1);
        expect(result[0].fingerprint).to.equal('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
        expect(result[0].userIds).to.deep.equal(['Alice <alice@example.com>']);
    });

    it('--with-secret: field 15 "+" sets hasSecret=true, missing field sets hasSecret=false', () => {
        // pub: record with "+" at index 14 (field 15) → secret key available
        // pub: record without field 14 → no secret key
        const output = [
            'pub::255:::::::KEY1:::sc::+:',  // fields[14] = '+'
            'fpr:::::::::AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:',
            'uid:::::::::Alice <alice@example.com>:::::::::0:',
            'pub::255:::::::KEY2:::sc:',     // fields[14] = undefined → no secret
            'fpr:::::::::BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB:',
            'uid:::::::::Bob <bob@example.com>:::::::::0:',
        ].join('\n');
        const result = parsePublicKeys(output);
        expect(result[0].hasSecret, 'key with + at field 15: hasSecret=true').to.be.true;
        expect(result[1].hasSecret, 'key without field 15: hasSecret=false').to.be.false;
    });

    it('includes revoked public keys (pub:r: status field)', () => {
        const output = [
            'pub:r:2048:1:AABBCCDDAABBCCDD:::sc:',
            'fpr:::::::::AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:',
            'uid:r::::::::Revoked User <revoked@example.com>:::::::::0:',
        ].join('\n');
        const result = parsePublicKeys(output);
        expect(result).to.have.length(1);
        expect(result[0].revoked, 'pub:r: sets revoked=true').to.be.true;
        expect(result[0].hasSecret, 'public key has hasSecret=false').to.be.false;
    });

    it('includes expired public keys (pub:e: status field)', () => {
        const output = [
            'pub:e:2048:1:AABBCCDDAABBCCDD:::sc:',
            'fpr:::::::::AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:',
            'uid:e::::::::Expired User <expired@example.com>:::::::::0:',
        ].join('\n');
        const result = parsePublicKeys(output);
        expect(result).to.have.length(1);
        expect(result[0].expired, 'pub:e: sets expired=true').to.be.true;
        expect(result[0].revoked, 'expired key: revoked=false').to.be.false;
        expect(result[0].hasSecret, 'expired public key has hasSecret=false').to.be.false;
    });

    it('does not parse sec: records (secret keyring format — wrong function)', () => {
        // parsePairedKeys handles sec:; parsePublicKeys must ignore sec: records
        const output = [
            'sec::255:::::::KEY1:::sc:',
            'fpr:::::::::AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:',
            'uid:::::::::Alice <alice@example.com>:::::::::0:',
        ].join('\n');
        const result = parsePublicKeys(output);
        expect(result).to.deep.equal([]);
    });
});

// ============================================================================
// unescapeGpgColonField (pure function — no subprocess)
// ============================================================================

describe('unescapeGpgColonField()', () => {
    it('returns plain strings unchanged', () => {
        expect(unescapeGpgColonField('Alice <alice@example.com>')).to.equal('Alice <alice@example.com>');
    });

    it('unescapes \\x3a to a colon', () => {
        // GPG escapes `:` as `\x3a` to avoid breaking its colon-delimited format
        expect(unescapeGpgColonField('Display Name \\x3a Extra')).to.equal('Display Name : Extra');
    });

    it('unescapes \\x0a to a newline', () => {
        expect(unescapeGpgColonField('line1\\x0aline2')).to.equal('line1\nline2');
    });

    it('unescapes multiple escape sequences in a single field', () => {
        expect(unescapeGpgColonField('a\\x3ab\\x3ac')).to.equal('a:b:c');
    });

    it('is case-insensitive for hex digits', () => {
        expect(unescapeGpgColonField('a\\x3Ab')).to.equal('a:b');
        expect(unescapeGpgColonField('a\\x3ab')).to.equal('a:b');
    });

    it('does not alter UTF-8 characters', () => {
        // UIDs come in as proper UTF-8 strings; unescapeGpgColonField must not corrupt them
        expect(unescapeGpgColonField('M\u00fcller')).to.equal('M\u00fcller');
    });
});

// ============================================================================
// parseImportResult (pure function — no subprocess)
// ============================================================================

describe('parseImportResult()', () => {
    it('parses { imported: 1, unchanged: 0, errors: 0 }', () => {
        const stderr = [
            'gpg: key AABBCCDD: public key "Test" imported',
            'gpg: Total number processed: 1',
            'gpg:               imported: 1',
        ].join('\n');
        expect(parseImportResult(stderr)).to.deep.equal({ imported: 1, unchanged: 0, errors: 0 });
    });

    it('parses { imported: 0, unchanged: 1, errors: 0 } (already-imported key)', () => {
        const stderr = [
            'gpg: key AABBCCDD: "Test" not changed',
            'gpg: Total number processed: 1',
            'gpg:            unchanged: 1',
        ].join('\n');
        expect(parseImportResult(stderr)).to.deep.equal({ imported: 0, unchanged: 1, errors: 0 });
    });

    it('parses errors from "not imported: N" format', () => {
        const stderr = 'gpg: Total number processed: 1\ngpg:         not imported: 1';
        expect(parseImportResult(stderr)).to.deep.equal({ imported: 0, unchanged: 0, errors: 1 });
    });

    it('returns zeros when output is empty', () => {
        expect(parseImportResult('')).to.deep.equal({ imported: 0, unchanged: 0, errors: 0 });
    });
});
