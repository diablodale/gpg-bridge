/**
 * Public key sync service.
 *
 * Calls `_gpg-bridge-agent.exportPublicKeys` (on Windows via VS Code commands) to
 * retrieve the bytes, then passes them to `gpg --import` on the remote side.
 *
 * All VS Code API calls are injectable so the service can be unit-tested without
 * a real extension host or cross-host VS Code command bridge.
 */

import * as vscode from 'vscode';
import { GpgCli, extractErrorMessage, log } from '@gpg-bridge/shared';
import type { LogConfig, KeyFilter, IGpgCliFactory } from '@gpg-bridge/shared';

/**
 * Injectable dependencies for {@link PublicKeySync}.
 * All fields are optional; production defaults use the real VS Code API and a new GpgCli.
 */
export interface PublicKeySyncDeps {
    /**
     * Executes a VS Code command and returns its result.
     * Defaults to `vscode.commands.executeCommand`.
     */
    executeCommand?: (command: string, ...args: unknown[]) => Thenable<unknown>;
    /**
     * Factory used to construct the `GpgCli` instance.
     * Defaults to `new GpgCli()`. Inject a mock factory in tests.
     */
    gpgCliFactory?: IGpgCliFactory;
    /**
     * Show a VS Code information message.
     * Defaults to `vscode.window.showInformationMessage`.
     */
    showInformationMessage?: (message: string) => void;
    /**
     * Show a VS Code error message.
     * Defaults to `vscode.window.showErrorMessage`.
     */
    showErrorMessage?: (message: string) => void;
}

export class PublicKeySync {
    private readonly config: LogConfig;
    private readonly gpgCli: GpgCli;
    private readonly executeCommandFn: (command: string, ...args: unknown[]) => Thenable<unknown>;
    private readonly showInformationMessageFn: (message: string) => void;
    private readonly showErrorMessageFn: (message: string) => void;

    constructor(config: LogConfig, deps?: Partial<PublicKeySyncDeps>) {
        this.config = config;
        this.gpgCli = deps?.gpgCliFactory?.create() ?? new GpgCli();
        this.executeCommandFn = deps?.executeCommand
            ?? ((cmd, ...args) => vscode.commands.executeCommand(cmd, ...args));
        this.showInformationMessageFn = deps?.showInformationMessage
            ?? ((msg) => { void vscode.window.showInformationMessage(msg); });
        this.showErrorMessageFn = deps?.showErrorMessage
            ?? ((msg) => { void vscode.window.showErrorMessage(msg); });
    }

    /**
     * Called on extension activation. Runs `syncPublicKeys(setting)` only when
     * `setting` is a non-empty string. Silently does nothing for `""`.
     *
     * Enables a one-liner in `extension.ts` that is trivially testable without
     * replicating the guard condition outside of this class.
     */
    async autoSync(setting: string): Promise<void> {
        if (!setting) { return; }
        await this.syncPublicKeys(setting);
    }

    /**
     * Export public keys from the agent extension (running on Windows) and import them
     * into the local GPG keyring on the remote host.
     *
     * @param filter - Key filter forwarded to `_gpg-bridge-agent.exportPublicKeys`:
     *   - `'all'`    — all public keys in the keyring
     *   - `'pairs'`  — only keys that have a local secret key
     *   - other      — passed verbatim as a `gpg --export` identifier
     *   - omitted    — agent shows an interactive QuickPick; may return `undefined`
     */
    async syncPublicKeys(filter?: KeyFilter): Promise<void> {
        log(this.config, `[syncPublicKeys] Requesting export. filter=${filter ?? '(interactive)'}`);

        let keyData: Uint8Array | undefined;
        try {
            const args: unknown[] = filter !== undefined ? [filter] : [];
            keyData = await this.executeCommandFn('_gpg-bridge-agent.exportPublicKeys', ...args) as Uint8Array | undefined;
        } catch (err) {
            // Agent extension is absent, not initialized, or threw during export
            const msg = `Could not export public keys from agent: ${extractErrorMessage(err)}`;
            log(this.config, `[syncPublicKeys] ${msg}`);
            this.showErrorMessageFn(msg);
            return;
        }

        if (keyData === undefined) {
            // User cancelled the interactive QuickPick — nothing to import, no error
            log(this.config, '[syncPublicKeys] No keys to import (agent returned undefined)');
            return;
        }

        // VS Code JSON-serializes TypedArrays when passing values across extension hosts
        // (local ↔ remote). Two possible shapes depending on the runtime type:
        //   - Buffer (extends Uint8Array): Buffer.toJSON() → {type: 'Buffer', data: number[]}
        //   - Uint8Array (plain): serialized as indexed object {0: n, 1: n, ...}
        // Normalize to Uint8Array so importPublicKeys receives valid binary in all code paths.
        let keyBytes: Uint8Array;
        if (keyData instanceof Uint8Array) {
            keyBytes = keyData;
        } else if (
            keyData !== null &&
            typeof keyData === 'object' &&
            (keyData as { type?: unknown }).type === 'Buffer' &&
            Array.isArray((keyData as { data?: unknown }).data)
        ) {
            keyBytes = Uint8Array.from((keyData as { data: number[] }).data);
        } else {
            keyBytes = Uint8Array.from(Object.values(keyData as Record<string, number>));
        }

        const result = await this.gpgCli.importPublicKeys(keyBytes);
        const summary = `imported: ${result.imported}, unchanged: ${result.unchanged}, errors: ${result.errors}`;
        log(this.config, `[syncPublicKeys] Import complete — ${summary}`);
        this.showInformationMessageFn(`GPG Bridge: public key sync complete — ${summary}`);
    }
}
