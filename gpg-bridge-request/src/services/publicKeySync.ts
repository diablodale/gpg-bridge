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
    this.executeCommandFn =
      deps?.executeCommand ?? ((cmd, ...args) => vscode.commands.executeCommand(cmd, ...args));
    this.showInformationMessageFn =
      deps?.showInformationMessage ??
      ((msg) => {
        void vscode.window.showInformationMessage(msg);
      });
    this.showErrorMessageFn =
      deps?.showErrorMessage ??
      ((msg) => {
        void vscode.window.showErrorMessage(msg);
      });
  }

  /**
   * Called on extension activation. Runs `syncPublicKeys(setting)` only when
   * `setting` is a non-empty string or non-empty array. Silently does nothing
   * for `""` or `[]`.
   *
   * Rejects invalid strings (not `'all'` or `'pairs'`) with an error message —
   * arbitrary identifiers must be configured as a JSON array, e.g. `["John Doe"]`.
   *
   * Enables a one-liner in `extension.ts` that is trivially testable without
   * replicating the guard condition outside of this class.
   */
  async autoSync(setting: KeyFilter | ''): Promise<void> {
    const isEmpty = Array.isArray(setting) ? setting.length === 0 : !setting;
    if (isEmpty) {
      return;
    }
    if (typeof setting === 'string' && setting !== 'all' && setting !== 'pairs') {
      const msg = `gpgBridgeRequest.autoSyncPublicKeys: invalid value "${setting}". Use "all", "pairs", or a JSON array of identifiers, e.g. ["${setting}"]`;
      log(this.config, `[autoSync] ${msg}`);
      this.showErrorMessageFn(msg);
      return;
    }
    await this.syncPublicKeys(setting as KeyFilter);
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
    log(
      this.config,
      `[syncPublicKeys] Request agent export public keys: ${filter ?? '(interactive)'}`,
    );

    let keyData: string | undefined;
    try {
      const args: unknown[] = filter !== undefined ? [filter] : [];
      keyData = (await this.executeCommandFn('_gpg-bridge-agent.exportPublicKeys', ...args)) as
        | string
        | undefined;
    } catch (err) {
      // Agent extension is absent, not initialized, or threw during export
      const msg = `Request agent export public keys failed: ${extractErrorMessage(err)}`;
      log(this.config, `[syncPublicKeys] ${msg}`);
      this.showErrorMessageFn(msg);
      return;
    }

    if (keyData === undefined) {
      // User cancelled the interactive QuickPick — nothing to import, no error
      log(this.config, '[syncPublicKeys] No public keys to import');
      return;
    }

    const result = await this.gpgCli.importPublicKeys(keyData);
    const summary = `${result.imported} imported, ${result.unchanged} unchanged, ${result.errors} errors`;
    log(this.config, `[syncPublicKeys] Public key import complete: ${summary}`);
    this.showInformationMessageFn(`Public key sync complete: ${summary}`);
  }
}
