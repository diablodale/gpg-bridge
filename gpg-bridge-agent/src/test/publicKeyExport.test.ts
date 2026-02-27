/**
 * Unit tests: publicKeyExport service
 *
 * Tests `exportPublicKeys()` and `keyInfoToQuickPickItem()` using mocked GpgCli instances
 * (no real gpg or VS Code required). VS Code UI calls (showQuickPick, showWarningMessage)
 * are injected via deps.
 */

import { expect } from 'chai';
import { GpgCli } from '@gpg-bridge/shared';
import type { PairedKeyInfo } from '@gpg-bridge/shared';
import { exportPublicKeys, keyInfoToQuickPickItem } from '../services/publicKeyExport';
import type { PublicKeyExportDeps } from '../services/publicKeyExport';
import * as vscode from 'vscode';

// ---------------------------------------------------------------------------
// Mock GpgCli — overrides only the methods under test; no subprocess calls
// ---------------------------------------------------------------------------

class MockExportGpgCli extends GpgCli {
  public listPairedKeysResult: PairedKeyInfo[] = [];
  public listPublicKeysResult: PairedKeyInfo[] = [];
  public exportPublicKeysResult: string = 'FAKEARMOR';
  public exportPublicKeysCalls: Array<string[] | undefined> = [];
  public listPairedKeysCalled = false;
  public listPublicKeysCalled = false;

  constructor() {
    // Explicit gpgBinDir + stubbed existsSync prevents base-class detection
    super({ gpgBinDir: '/fake/bin' }, { existsSync: () => true });
  }

  override async listPairedKeys(): Promise<PairedKeyInfo[]> {
    this.listPairedKeysCalled = true;
    return this.listPairedKeysResult;
  }

  override async listPublicKeys(): Promise<PairedKeyInfo[]> {
    this.listPublicKeysCalled = true;
    return this.listPublicKeysResult;
  }

  override async exportPublicKeys(filter?: string[]): Promise<string> {
    this.exportPublicKeysCalls.push(filter);
    return this.exportPublicKeysResult;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQuickPickDep(result: readonly vscode.QuickPickItem[] | 'all' | undefined): {
  quickPick: NonNullable<PublicKeyExportDeps['quickPick']>;
  calls: Array<{ items: vscode.QuickPickItem[]; options: vscode.QuickPickOptions }>;
} {
  const calls: Array<{ items: vscode.QuickPickItem[]; options: vscode.QuickPickOptions }> = [];
  return {
    calls,
    quickPick: async (items, options) => {
      calls.push({ items, options });
      // 'all' selector: return every item as-is (preserves _fingerprint on KeyPickItem objects)
      if (result === 'all') {
        return items;
      }
      return result;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('exportPublicKeys', () => {
  let gpgCli: MockExportGpgCli;
  const fakeKeyData =
    '-----BEGIN PGP PUBLIC KEY BLOCK-----\nFAKEKEYDATA\n-----END PGP PUBLIC KEY BLOCK-----\n';

  const sampleKeys: PairedKeyInfo[] = [
    {
      fingerprint: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBBB',
      userIds: ['Alice <alice@example.com>'],
    },
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

  it("filter=['Alice Smith <alice@example.com>', 'FP2']: array passed directly to exportPublicKeys()", async () => {
    const result = await exportPublicKeys(gpgCli, ['Alice Smith <alice@example.com>', 'FP2']);

    expect(result).to.deep.equal(fakeKeyData);
    expect(gpgCli.exportPublicKeysCalls).to.deep.equal([
      ['Alice Smith <alice@example.com>', 'FP2'],
    ]);
    expect(gpgCli.listPairedKeysCalled, 'listPairedKeys should not be called').to.be.false;
  });

  it("filter='pairs': calls listPairedKeys() and passes fingerprints as array to exportPublicKeys()", async () => {
    gpgCli.listPairedKeysResult = sampleKeys;

    const result = await exportPublicKeys(gpgCli, 'pairs');

    expect(result).to.deep.equal(fakeKeyData);
    expect(gpgCli.listPairedKeysCalled).to.be.true;
    expect(gpgCli.exportPublicKeysCalls).to.deep.equal([
      ['AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBBB', 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCDDDD'],
    ]);
  });

  it('filter=undefined: QuickPick is shown, populated with items from listPublicKeys()', async () => {
    gpgCli.listPublicKeysResult = sampleKeys;
    const { quickPick, calls } = makeQuickPickDep([]);

    await exportPublicKeys(gpgCli, undefined, { quickPick });

    expect(gpgCli.listPublicKeysCalled, 'listPublicKeys should be called for QuickPick items').to.be
      .true;
    expect(
      gpgCli.listPairedKeysCalled,
      'listPairedKeys should not be called; hasSecret comes from --with-secret',
    ).to.be.false;
    expect(calls).to.have.length(1);
    expect(calls[0].options.canPickMany).to.be.true;
    expect(calls[0].items).to.have.length(2);
  });

  it('filter=undefined, user cancels QuickPick: returns undefined; exportPublicKeys() not called', async () => {
    gpgCli.listPublicKeysResult = sampleKeys;
    const { quickPick } = makeQuickPickDep(undefined);

    const result = await exportPublicKeys(gpgCli, undefined, { quickPick });

    expect(result).to.be.undefined;
    expect(gpgCli.exportPublicKeysCalls).to.have.length(0);
  });

  it('zero-byte export result: VS Code warning message shown; returns undefined', async () => {
    gpgCli.exportPublicKeysResult = '';
    const warnings: string[] = [];
    const showWarningMessage = (msg: string) => {
      warnings.push(msg);
    };

    const result = await exportPublicKeys(gpgCli, 'all', { showWarningMessage });

    expect(result).to.be.undefined;
    expect(warnings).to.have.length(1);
    expect(warnings[0]).to.match(/no public key data/i);
  });

  it('QuickPick items have UID-only label and grouped last-16 fingerprint description', async () => {
    gpgCli.listPublicKeysResult = sampleKeys;
    const { quickPick, calls } = makeQuickPickDep([]);

    await exportPublicKeys(gpgCli, undefined, { quickPick });

    const items = calls[0].items;
    // sampleKeys[0].fingerprint = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBBB'
    //   last 16: 'AAAAAAAAAAAABBBB' → grouped: 'AAAA AAAA AAAA BBBB'
    expect(items[0].label).to.equal('Alice <alice@example.com>');
    expect(items[0].description).to.equal('AAAA AAAA AAAA BBBB');
    // sampleKeys[1].fingerprint = 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCDDDD'
    //   last 16: 'CCCCCCCCCCCCDDDD' → grouped: 'CCCC CCCC CCCC DDDD'
    expect(items[1].label).to.equal('Bob <bob@example.com>');
    expect(items[1].description).to.equal('CCCC CCCC CCCC DDDD');
  });

  it('hasSecret from listPublicKeys() (--with-secret) drives the key icon', async () => {
    // parsePublicKeys() populates hasSecret from field 15; no separate listPairedKeys() needed
    gpgCli.listPublicKeysResult = [
      { ...sampleKeys[0], hasSecret: true }, // Alice: secret key available
      { ...sampleKeys[1], hasSecret: false }, // Bob: public-only
    ];
    const { quickPick, calls } = makeQuickPickDep([]);

    await exportPublicKeys(gpgCli, undefined, { quickPick });

    const items = calls[0].items;
    expect((items[0].iconPath as vscode.ThemeIcon).id).to.equal('key'); // Alice: has secret
    expect((items[1].iconPath as vscode.ThemeIcon).id).to.equal('blank'); // Bob: public-only
  });

  it('QuickPick grouping: normal keys first sorted by UID, separator, then revoked/expired sorted by UID', async () => {
    gpgCli.listPublicKeysResult = [
      {
        fingerprint: 'R'.padEnd(40, '0'),
        userIds: ['Zelda <z@example.com>'],
        revoked: true,
        expired: false,
      },
      {
        fingerprint: 'B'.padEnd(40, '0'),
        userIds: ['Charlie <c@example.com>'],
        revoked: false,
        expired: false,
      },
      {
        fingerprint: 'E'.padEnd(40, '0'),
        userIds: ['Aaron <a@example.com>'],
        revoked: false,
        expired: true,
      },
      {
        fingerprint: 'N'.padEnd(40, '0'),
        userIds: ['Bob <b@example.com>'],
        revoked: false,
        expired: false,
      },
    ];
    const { quickPick, calls } = makeQuickPickDep([]);

    await exportPublicKeys(gpgCli, undefined, { quickPick });

    const items = calls[0].items;
    // group B: normal keys, ascending UID
    expect(items[0].label).to.equal('Bob <b@example.com>');
    expect(items[1].label).to.equal('Charlie <c@example.com>');
    // separator
    expect((items[2] as vscode.QuickPickItem).kind).to.equal(vscode.QuickPickItemKind.Separator);
    expect(items[2].label).to.equal('Expired and revoked');
    // group A: revoked/expired keys, ascending UID
    expect(items[3].label).to.equal('Aaron <a@example.com>');
    expect(items[4].label).to.equal('Zelda <z@example.com>');
    expect(items).to.have.length(5);
  });

  it('multi-select: all selected fingerprints are passed in a single exportPublicKeys() call', async () => {
    gpgCli.listPublicKeysResult = sampleKeys;
    // 'all' selector returns the items as-is; KeyPickItem._fingerprint carries the full fingerprint
    const { quickPick } = makeQuickPickDep('all');

    await exportPublicKeys(gpgCli, undefined, { quickPick });

    expect(gpgCli.exportPublicKeysCalls).to.deep.equal([
      ['AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBBB', 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCDDDD'],
    ]);
  });
});

// ---------------------------------------------------------------------------
// keyInfoToQuickPickItem
// ---------------------------------------------------------------------------

describe('keyInfoToQuickPickItem', () => {
  it('plain public key: no icon, UID label, grouped last-16 description', () => {
    const key: PairedKeyInfo = {
      fingerprint: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBBB',
      userIds: ['Alice <alice@example.com>'],
      hasSecret: false,
      revoked: false,
    };
    const item = keyInfoToQuickPickItem(key);
    expect(item.label).to.equal('Alice <alice@example.com>');
    expect(item.description).to.equal('AAAA AAAA AAAA BBBB');
    // ThemeIcon('blank') reserves the icon gutter space to keep labels aligned
    expect(item.iconPath).to.be.instanceOf(vscode.ThemeIcon);
    expect((item.iconPath as vscode.ThemeIcon).id).to.equal('blank');
  });

  it('key pair (hasSecret=true): ThemeIcon key shown left of label', () => {
    const key: PairedKeyInfo = {
      fingerprint: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBBB',
      userIds: ['Alice <alice@example.com>'],
      hasSecret: true,
      revoked: false,
    };
    const item = keyInfoToQuickPickItem(key);
    expect(item.label).to.equal('Alice <alice@example.com>');
    expect(item.iconPath).to.be.instanceOf(vscode.ThemeIcon);
    expect((item.iconPath as vscode.ThemeIcon).id).to.equal('key');
  });

  it('revoked key: ThemeIcon error takes priority over hasSecret', () => {
    const key: PairedKeyInfo = {
      fingerprint: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBBB',
      userIds: ['Alice <alice@example.com>'],
      hasSecret: true,
      revoked: true,
    };
    const item = keyInfoToQuickPickItem(key);
    expect(item.label).to.equal('Alice <alice@example.com>');
    expect(item.iconPath).to.be.instanceOf(vscode.ThemeIcon);
    expect((item.iconPath as vscode.ThemeIcon).id).to.equal('error');
  });

  it('no user IDs: falls back to (no user ID)', () => {
    const key: PairedKeyInfo = {
      fingerprint: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABBBB',
      userIds: [],
    };
    const item = keyInfoToQuickPickItem(key);
    expect(item.label).to.equal('(no user ID)');
  });

  it('description groups last 16 fingerprint chars into 4-char blocks', () => {
    const key: PairedKeyInfo = {
      fingerprint: '0011223344556677889900AABBCCDDEEFF001122',
      userIds: ['Test'],
    };
    const item = keyInfoToQuickPickItem(key);
    // last 16 of '0011223344556677889900AABBCCDDEEFF001122' = 'CCDDEEFF001122' wait...
    // fingerprint length 40, last 16 = chars [24..39] = 'AABBCCDDEEFF0011' wait let me count:
    // '0011223344556677889900AABBCCDDEEFF001122'
    //  0123456789012345678901234567890123456789
    // last 16 = chars 24-39 = 'CCDDEEFF001122' ... actually:
    // position 24: 'C', 25:'C', 26:'D', 27:'D', 28:'E',29:'E',30:'F',31:'F',32:'0',33:'0',34:'1',35:'1',36:'2',37:'2', wait
    // Let me recount: '0011223344556677889900AABBCCDDEEFF001122' has 40 chars
    // 0-1: '00', 2-3: '11', 4-5: '22', 6-7: '33', 8-9: '44', 10-11: '55', 12-13: '66', 14-15: '77'
    // 16-17: '88', 18-19: '99', 20-21: '00', 22-23: 'AA', 24-25: 'BB', 26-27: 'CC', 28-29: 'DD'
    // 30-31: 'EE', 32-33: 'FF', 34-35: '00', 36-37: '11', 38-39: '22'
    // last 16 = chars 24-39 = 'BBCCDDEEFF001122'
    // grouped: 'BBCC DDEE FF00 1122'
    expect(item.description).to.equal('BBCC DDEE FF00 1122');
  });
});
