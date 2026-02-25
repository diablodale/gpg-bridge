import * as vscode from 'vscode';
import type { GpgCli, KeyFilter } from '@gpg-bridge/shared';

// ============================================================================
// Dependency injection
// ============================================================================

export interface PublicKeyExportDeps {
    /**
     * Injectable QuickPick for unit testing.
     * Production default: wraps `vscode.window.showQuickPick` with `canPickMany: true`.
     * Returns the selected items, or `undefined` if the user cancels.
     */
    quickPick?: (
        items: vscode.QuickPickItem[],
        options: { canPickMany: true; placeHolder: string }
    ) => Promise<readonly vscode.QuickPickItem[] | undefined>;

    /**
     * Injectable warning message display for unit testing.
     * Production default: calls `vscode.window.showWarningMessage` (fire-and-forget).
     */
    showWarningMessage?: (message: string) => void;
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
 *   - other string         → pass directly to `gpg --export` as an identifier
 *
 * Interactive path (UI required):
 *   - `filter === undefined` → show a multi-select QuickPick populated from paired keys;
 *     QuickPick item label is `<first-user-ID> [<last-8-chars-of-fingerprint>]`.
 *     User cancel → returns `undefined` without exporting.
 *
 * In all cases a zero-byte result shows a VS Code warning and returns `undefined`.
 *
 * @param gpgCli  Active `GpgCli` instance (provided internally by `AgentProxy.exportPublicKeys()`).
 * @param filter  Export filter — see `KeyFilter` type docs.
 * @param deps    Optional injected dependencies (for unit testing without VS Code runtime).
 * @returns       Exported key bytes as `Uint8Array`, or `undefined` if nothing was exported.
 */
export async function exportPublicKeys(
    gpgCli: GpgCli,
    filter: KeyFilter | undefined,
    deps: Partial<PublicKeyExportDeps> = {}
): Promise<Uint8Array | undefined> {
    const quickPick = deps.quickPick ??
        ((items, options) => vscode.window.showQuickPick(items, options));
    const showWarningMessage = deps.showWarningMessage ??
        ((message) => { void vscode.window.showWarningMessage(message); });

    let keyData: Uint8Array;

    if (filter === 'all') {
        keyData = await gpgCli.exportPublicKeys();
    } else if (filter === 'pairs') {
        const keys = await gpgCli.listPairedKeys();
        keyData = await gpgCli.exportPublicKeys(keys.map(k => k.fingerprint).join(' '));
    } else if (filter !== undefined) {
        keyData = await gpgCli.exportPublicKeys(filter);
    } else {
        // Interactive: populate QuickPick from owned key pairs
        const keys = await gpgCli.listPairedKeys();
        const items: vscode.QuickPickItem[] = keys.map(k => ({
            label: `${k.userIds[0] ?? '(no user ID)'} [${k.fingerprint.slice(-8)}]`,
            description: k.fingerprint,
        }));
        const selected = await quickPick(items, {
            canPickMany: true,
            placeHolder: 'Select public keys to export',
        });
        if (!selected || selected.length === 0) {
            return undefined;
        }
        keyData = await gpgCli.exportPublicKeys(selected.map(i => i.description!).join(' '));
    }

    if (keyData.length === 0) {
        showWarningMessage('No public key data exported. The filter did not match any keys in the keyring.');
        return undefined;
    }

    return keyData;
}
