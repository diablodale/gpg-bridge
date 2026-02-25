/**
 * Unit tests: publicKeyExport service
 *
 * Tests `exportPublicKeys()` using mocked GpgCli instances (no real gpg or VS Code required).
 * VS Code UI calls (showQuickPick, showWarningMessage) are injected via deps.
 */

import { expect } from 'chai';
import { GpgCli } from '@gpg-bridge/shared';
import type { PairedKeyInfo } from '@gpg-bridge/shared';
import { exportPublicKeys } from '../services/publicKeyExport';
import type { PublicKeyExportDeps } from '../services/publicKeyExport';
import type * as vscode from 'vscode';

// ---------------------------------------------------------------------------
// Mock GpgCli — overrides only the methods under test; no subprocess calls
// ---------------------------------------------------------------------------

class MockExportGpgCli extends GpgCli {
    public listPairedKeysResult: PairedKeyInfo[] = [];
    public exportPublicKeysResult: string = 'FAKEARMOR';
    public exportPublicKeysCalls: Array<string | undefined> = [];
    public listPairedKeysCalled = false;

    constructor() {
        // Explicit gpgBinDir + stubbed existsSync prevents base-class detection
        super({ gpgBinDir: '/fake/bin' }, { existsSync: () => true });
    }

    override async listPairedKeys(): Promise<PairedKeyInfo[]> {
        this.listPairedKeysCalled = true;
        return this.listPairedKeysResult;
    }

    override async exportPublicKeys(filter?: string): Promise<string> {
        this.exportPublicKeysCalls.push(filter);
        return this.exportPublicKeysResult;
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQuickPickDep(result: readonly vscode.QuickPickItem[] | undefined): {
    quickPick: NonNullable<PublicKeyExportDeps['quickPick']>;
    calls: Array<{ items: vscode.QuickPickItem[]; options: { canPickMany: true; placeHolder: string } }>;
} {
    const calls: Array<{ items: vscode.QuickPickItem[]; options: { canPickMany: true; placeHolder: string } }> = [];
    return {
        calls,
        quickPick: async (items, options) => {
            calls.push({ items, options });
            return result;
        },
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('exportPublicKeys', () => {
    let gpgCli: MockExportGpgCli;
    const fakeKeyData = '-----BEGIN PGP PUBLIC KEY BLOCK-----\nFAKEKEYDATA\n-----END PGP PUBLIC KEY BLOCK-----\n';

    const sampleKeys: PairedKeyInfo[] = [
        { fingerprint: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBBB', userIds: ['Alice <alice@example.com>'] },
        { fingerprint: 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCDDDD', userIds: ['Bob <bob@example.com>'] },
    ];

    beforeEach(() => {
        gpgCli = new MockExportGpgCli();
        gpgCli.exportPublicKeysResult = fakeKeyData;
    });

    it("filter='all': calls exportPublicKeys() with no args", async () => {
        const result = await exportPublicKeys(gpgCli, 'all');

        expect(result).to.deep.equal(fakeKeyData);
        expect(gpgCli.exportPublicKeysCalls).to.deep.equal([undefined]);
        expect(gpgCli.listPairedKeysCalled, 'listPairedKeys should not be called').to.be.false;
    });

    it("filter='pairs': calls listPairedKeys() and passes all fingerprints joined to exportPublicKeys()", async () => {
        gpgCli.listPairedKeysResult = sampleKeys;

        const result = await exportPublicKeys(gpgCli, 'pairs');

        expect(result).to.deep.equal(fakeKeyData);
        expect(gpgCli.listPairedKeysCalled).to.be.true;
        expect(gpgCli.exportPublicKeysCalls).to.deep.equal([
            'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBBB CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCDDDD',
        ]);
    });

    it("filter='user@example.com': passes string directly to exportPublicKeys()", async () => {
        const result = await exportPublicKeys(gpgCli, 'user@example.com');

        expect(result).to.deep.equal(fakeKeyData);
        expect(gpgCli.exportPublicKeysCalls).to.deep.equal(['user@example.com']);
        expect(gpgCli.listPairedKeysCalled, 'listPairedKeys should not be called').to.be.false;
    });

    it('filter=undefined: QuickPick is shown, populated with items from listPairedKeys()', async () => {
        gpgCli.listPairedKeysResult = sampleKeys;
        const { quickPick, calls } = makeQuickPickDep([
            { label: 'Alice <alice@example.com> [AAAABBBB]', description: sampleKeys[0].fingerprint },
        ]);

        await exportPublicKeys(gpgCli, undefined, { quickPick });

        expect(gpgCli.listPairedKeysCalled, 'listPairedKeys should be called for QuickPick items').to.be.true;
        expect(calls).to.have.length(1);
        expect(calls[0].options.canPickMany).to.be.true;
        expect(calls[0].items).to.have.length(2);
    });

    it('filter=undefined, user cancels QuickPick: returns undefined; exportPublicKeys() not called', async () => {
        gpgCli.listPairedKeysResult = sampleKeys;
        const { quickPick } = makeQuickPickDep(undefined);

        const result = await exportPublicKeys(gpgCli, undefined, { quickPick });

        expect(result).to.be.undefined;
        expect(gpgCli.exportPublicKeysCalls).to.have.length(0);
    });

    it('zero-byte export result: VS Code warning message shown; returns undefined', async () => {
        gpgCli.exportPublicKeysResult = ''
        const warnings: string[] = [];
        const showWarningMessage = (msg: string) => { warnings.push(msg); };

        const result = await exportPublicKeys(gpgCli, 'all', { showWarningMessage });

        expect(result).to.be.undefined;
        expect(warnings).to.have.length(1);
        expect(warnings[0]).to.match(/no public key data/i);
    });

    it("QuickPick items are formatted as '<User-ID> [<short-key-ID>]'", async () => {
        gpgCli.listPairedKeysResult = sampleKeys;
        const { quickPick, calls } = makeQuickPickDep([]);

        await exportPublicKeys(gpgCli, undefined, { quickPick });

        const items = calls[0].items;
        expect(items[0].label).to.equal('Alice <alice@example.com> [AAAABBBB]');
        expect(items[0].description).to.equal(sampleKeys[0].fingerprint);
        expect(items[1].label).to.equal('Bob <bob@example.com> [CCCCDDDD]');
        expect(items[1].description).to.equal(sampleKeys[1].fingerprint);
    });

    it('multi-select: all selected fingerprints are passed in a single exportPublicKeys() call', async () => {
        gpgCli.listPairedKeysResult = sampleKeys;
        const selectedItems: vscode.QuickPickItem[] = [
            { label: 'Alice <alice@example.com> [AAAABBBB]', description: sampleKeys[0].fingerprint },
            { label: 'Bob <bob@example.com> [CCCCDDDD]', description: sampleKeys[1].fingerprint },
        ];
        const { quickPick } = makeQuickPickDep(selectedItems);

        await exportPublicKeys(gpgCli, undefined, { quickPick });

        expect(gpgCli.exportPublicKeysCalls).to.deep.equal([
            'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBBB CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCDDDD',
        ]);
    });
});
