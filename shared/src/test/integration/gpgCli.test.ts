/**
 * Integration tests for GpgCli (production base class) and GpgTestHelper (test subclass).
 *
 * Uses real gpg subprocesses — gpg must be on PATH or in a well-known location.
 * GpgTestHelper extends GpgCli, so all base-class methods are exercised here.
 *
 * Run: `npm test` in shared/
 */

import * as fs from 'fs';
import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import { GpgTestHelper } from './gpgCli';

describe('GpgCli integration (via GpgTestHelper)', function () {
    // Key generation can be slow on some systems; allow up to 60 s per test
    this.timeout(60000);

    describe('GpgTestHelper constructor', () => {
        it('sets gnupgHome to a non-empty string pointing to a real temp directory', async () => {
            const helper = new GpgTestHelper();
            try {
                expect(helper.gnupgHome.length).to.be.greaterThan(0);
                expect(fs.existsSync(helper.gnupgHome), `expected dir to exist: ${helper.gnupgHome}`).to.equal(true);
            } finally {
                await helper.cleanup();
            }
        });

        it('does NOT mutate process.env.GNUPGHOME', async () => {
            const before = process.env.GNUPGHOME;
            const helper = new GpgTestHelper();
            const after = process.env.GNUPGHOME;
            try {
                expect(after).to.equal(before, 'GpgTestHelper constructor must not mutate process.env.GNUPGHOME');
                expect(helper.gnupgHome).not.to.equal('', 'gnupgHome must be non-empty');
            } finally {
                await helper.cleanup();
            }
        });
    });

    describe('GpgTestHelper inherited methods', () => {
        let helper: GpgTestHelper;
        beforeEach(() => { helper = new GpgTestHelper(); });
        afterEach(async () => { await helper.cleanup(); });

        it('getBinDir() returns a non-empty string', () => {
            const dir = helper.getBinDir();
            expect(dir.length).to.be.greaterThan(0, 'expected getBinDir() to return a non-empty string');
        });

        it("gpgconfListDirs('homedir') returns the same path as gnupgHome", async () => {
            // gpg normalises paths; on Windows it may use forward slashes or lowercase,
            // so compare case-insensitively with both separators normalised.
            const result = await helper.gpgconfListDirs('homedir');
            const normalise = (p: string) => p.toLowerCase().replace(/\\/g, '/').replace(/\/$/, '');
            expect(normalise(result)).to.equal(
                normalise(helper.gnupgHome),
                `expected gpgconfListDirs('homedir') === gnupgHome; got: ${result}`
            );
        });

        it("gpgconfListDirs('agent-socket') returns a non-empty absolute path string", async () => {
            const result = await helper.gpgconfListDirs('agent-socket');
            expect(result.length).to.be.greaterThan(0, 'expected a non-empty path string');
            expect(
                result.startsWith('/') || /^[A-Za-z]:/.test(result),
                `expected an absolute path, got: ${result}`
            ).to.equal(true);
        });

        it('listPairedKeys() returns an empty array on a fresh empty keyring', async () => {
            const keys = await helper.listPairedKeys();
            expect(keys).to.deep.equal([]);
        });

        it('listPairedKeys() returns correct PairedKeyInfo[] for a generated key', async () => {
            await helper.generateKey('Phase Two', 'phasetwo@example.com');
            const keys = await helper.listPairedKeys();

            expect(keys.length).to.equal(1, 'expected exactly one key pair');
            const key = keys[0];
            expect(key.fingerprint).to.have.lengthOf(40, `expected 40-char fingerprint, got: ${key.fingerprint}`);
            expect(/^[0-9A-F]{40}$/i.test(key.fingerprint), `fingerprint should be hex: ${key.fingerprint}`).to.equal(true);
            expect(key.userIds.length).to.equal(1, 'expected exactly one UID');
            expect(key.userIds.some(u => u.includes('phasetwo@example.com'))).to.equal(true);
        });

        it('exportPublicKeys() returns non-empty armored string for a key pair', async () => {
            await helper.generateKey('Export P2', 'exportp2@example.com');
            const result = await helper.exportPublicKeys();
            expect(result).to.be.a('string');
            expect(result).to.include('-----BEGIN PGP PUBLIC KEY BLOCK-----');
            expect(result.length).to.be.greaterThanOrEqual(300, 'expected at least 300 chars for an Ed25519+cv25519 key pair export');
        });

        it('importPublicKeys() imports into a second keyring; imported: 1', async () => {
            await helper.generateKey('Import P2', 'importp2@example.com');
            const keyData = await helper.exportPublicKeys();
            expect(keyData.length).to.be.greaterThanOrEqual(300, 'expected at least 300 chars for an Ed25519+cv25519 key pair export');

            const helper2 = new GpgTestHelper();
            try {
                const result = await helper2.importPublicKeys(keyData);
                expect(result.imported).to.equal(1, `expected 1 imported, got: ${JSON.stringify(result)}`);
                expect(result.errors).to.equal(0, `expected 0 errors, got: ${JSON.stringify(result)}`);
            } finally {
                await helper2.cleanup();
            }
        });
    });

    describe('GpgTestHelper.cleanup()', () => {
        it('removes the temp directory', async () => {
            const helper = new GpgTestHelper();
            const dir = helper.gnupgHome;
            expect(fs.existsSync(dir), 'dir should exist before cleanup').to.equal(true);
            await helper.cleanup();
            expect(fs.existsSync(dir), 'dir should be removed after cleanup').to.equal(false);
        });
    });
});
