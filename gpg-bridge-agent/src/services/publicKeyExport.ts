import * as vscode from 'vscode';
import type { GpgCli, KeyFilter, PairedKeyInfo } from '@gpg-bridge/shared';

// ============================================================================
// Dependency injection
// ============================================================================

export interface PublicKeyExportDeps {
    /**
     * Injectable QuickPick for unit testing.
     * Production default: wraps `vscode.window.showQuickPick`.
     * Returns the selected items, or `undefined` if the user cancels.
     */
    quickPick?: (
        items: vscode.QuickPickItem[],
        options: vscode.QuickPickOptions
    ) => Promise<readonly vscode.QuickPickItem[] | undefined>;

    /**
     * Injectable warning message display for unit testing.
     * Production default: calls `vscode.window.showWarningMessage` (fire-and-forget).
     */
    showWarningMessage?: (message: string) => void;
}

// ============================================================================
// QuickPick item builder
// ============================================================================

/**
 * Convert a {@link PairedKeyInfo} to a VS Code {@link vscode.QuickPickItem}.
 *
 * - `label`: first user ID (or `'(no user ID)'`)
 * - `iconPath`: icon shown to the left of the label
 *   - `ThemeIcon('x')`   — revoked key (takes priority)
 *   - `ThemeIcon('key')` — key pair (secret key accessible)
 *   - `undefined`        — public-only, non-revoked key
 * - `description`: last 16 hex characters of the fingerprint in 4-char groups
 *   (e.g. `'AABB CCDD EEFF 0011'`)
 */
export function keyInfoToQuickPickItem(key: PairedKeyInfo): vscode.QuickPickItem {
    const label = key.userIds[0] ?? '(no user ID)';
    const shortFp = key.fingerprint.slice(-16);
    const description = shortFp.match(/.{1,4}/g)?.join(' ') ?? shortFp;
    const iconPath = key.revoked
        ? new vscode.ThemeIcon('error')
        : key.expired
        ? new vscode.ThemeIcon('history')
        : key.hasSecret
        ? new vscode.ThemeIcon('key')
        : new vscode.ThemeIcon('blank'); // reserves icon gutter space for alignment
    return { label, description, iconPath };
}

// ============================================================================
// Internal type: QuickPickItem extended with the full fingerprint
// ============================================================================

/** Carries the full 40-char fingerprint alongside the display-only description. */
interface KeyPickItem extends vscode.QuickPickItem {
    readonly _fingerprint: string;
}

// ============================================================================
// Service
// ============================================================================

/**
 * Export public keys from the GPG keyring.
 *
 * Headless paths (no UI):
 *   - `filter === 'all'`   → export every public key in the keyring
 *   - `filter === 'pairs'` → export the public key for each owned key pair
 *   - `string[]`           → each element passed as a separate `gpg --export` argument (preserves spaces in UIDs)
 *
 * Interactive path (UI required):
 *   - `filter === undefined` → show a multi-select QuickPick populated from all public keys;
 *     icons indicate key-pair / revoked; description shows the last 16 fingerprint chars in
 *     4-char groups. Keys are grouped: normal keys first (sorted by UID), then a separator
 *     labeled 'Expired and revoked', then revoked/expired keys (sorted by UID).
 *     User cancel → returns `undefined` without exporting.
 *
 * In all cases a zero-length result shows a VS Code warning and returns `undefined`.
 *
 * @param gpgCli  Active `GpgCli` instance (provided internally by `AgentProxy.exportPublicKeys()`).
 * @param filter  Export filter — see `KeyFilter` type docs.
 * @param deps    Optional injected dependencies (for unit testing without VS Code runtime).
 * @returns       ASCII-armored key data as a `string`, or `undefined` if nothing was exported.
 */
export async function exportPublicKeys(
    gpgCli: GpgCli,
    filter: KeyFilter | undefined,
    deps: Partial<PublicKeyExportDeps> = {}
): Promise<string | undefined> {
    const quickPick = deps.quickPick ??
        ((items, options) => vscode.window.showQuickPick(items, options) as Promise<readonly vscode.QuickPickItem[] | undefined>);
    const showWarningMessage = deps.showWarningMessage ??
        ((message) => { void vscode.window.showWarningMessage(message); });

    let keyData: string;

    if (filter === 'all') {
        keyData = await gpgCli.exportPublicKeys();
    } else if (filter === 'pairs') {
        const keys = await gpgCli.listPairedKeys();
        keyData = await gpgCli.exportPublicKeys(keys.map(k => k.fingerprint));
    } else if (filter !== undefined) {
        // string[] — each element passed as a distinct gpg --export argument
        keyData = await gpgCli.exportPublicKeys(filter);
    } else {
        // Interactive: populate QuickPick from all public keys.
        // listPublicKeys() uses --with-secret so hasSecret is already populated.
        const keys = await gpgCli.listPublicKeys();

        // Group B: normal keys (neither revoked nor expired) — shown first, sorted by first UID
        // Group A: revoked or expired keys — shown after a separator, sorted by first UID
        const compareUid = (a: typeof keys[0], b: typeof keys[0]) =>
            (a.userIds[0] ?? '').localeCompare(b.userIds[0] ?? '');
        const groupB = keys.filter(k => !k.revoked && !k.expired).sort(compareUid);
        const groupA = keys.filter(k =>  k.revoked || k.expired).sort(compareUid);

        const makeItem = (k: typeof keys[0]): KeyPickItem => ({
            ...keyInfoToQuickPickItem(k),
            _fingerprint: k.fingerprint,
        });

        const items: vscode.QuickPickItem[] = [
            ...groupB.map(makeItem),
            ...(groupA.length > 0 ? [
                { label: 'Expired and revoked', kind: vscode.QuickPickItemKind.Separator } as vscode.QuickPickItem,
                ...groupA.map(makeItem),
            ] : []),
        ];
        const selected = await quickPick(items, {
            canPickMany: true,
            matchOnDescription: true,
            placeHolder: 'Select public keys to export',
        });
        if (!selected || selected.length === 0) {
            return undefined;
        }
        keyData = await gpgCli.exportPublicKeys(
            Array.from(selected)
                .map(i => (i as KeyPickItem)._fingerprint)
                .filter((fp): fp is string => fp !== undefined)
        );
    }

    if (keyData.length === 0) {
        showWarningMessage('No public key data exported. The filter did not match any keys in the keyring.');
        return undefined;
    }

    return keyData;
}
