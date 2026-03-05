/**
 * Remote Extension Context
 *
 * This code runs on the remote (WSL/container/SSH).
 * It activates automatically when VS Code connects to any remote.
 *
 * Creates a Unix socket server on the GPG agent socket path and implements
 * a state machine to forward protocol operations to the agent-proxy extension
 * via VS Code commands.
 */

import * as vscode from 'vscode';
import { RequestProxy } from './services/requestProxy';
import { PublicKeySync } from './services/publicKeySync';
import { GpgCli, extractErrorMessage, VersionError } from '@gpg-bridge/shared';
import type { KeyFilter } from '@gpg-bridge/shared';
import { VSCodeCommandExecutor } from './services/commandExecutor';
import { isTestEnvironment, isIntegrationTestEnvironment } from '@gpg-bridge/shared';

let requestProxyService: RequestProxy | null = null;
let publicKeySyncService: PublicKeySync | null = null;
let outputChannel: vscode.OutputChannel;

/**
 * Calls `_gpg-bridge-agent.checkVersion` with the request extension's own version.
 * Returns `true` if the versions match exactly, throws on any error (including
 * `VersionError` on mismatch).
 *
 * On mismatch an error notification is shown with an "Open Extensions" button;
 * clicking it opens the VS Code Extensions search panel filtered to the bridge.
 * The notification is fire-and-forget so the throw is not delayed.
 * All VS Code API calls are injectable via `deps` for unit testing.
 */
export async function runVersionCheck(
  requestVersion: string,
  deps?: {
    executeCommand?: (cmd: string, ...args: unknown[]) => Thenable<boolean>;
    showErrorMessage?: (message: string, ...items: string[]) => Thenable<string | undefined>;
    executeSearchCommand?: (command: string, query: string) => Thenable<void>;
  },
): Promise<boolean> {
  const execCmd = deps?.executeCommand ?? vscode.commands.executeCommand<boolean>;
  const showErr =
    deps?.showErrorMessage ??
    ((message: string, ...items: string[]) => vscode.window.showErrorMessage(message, ...items));
  const execSearch =
    deps?.executeSearchCommand ??
    ((cmd: string, query: string) => vscode.commands.executeCommand(cmd, query) as Promise<void>);

  try {
    return await execCmd('_gpg-bridge-agent.checkVersion', requestVersion);
  } catch (error: unknown) {
    if (error instanceof VersionError) {
      showErr(
        `GPG Bridge extension version mismatch. Install matching versions. Details: ${extractErrorMessage(error)}`,
        'Open Extensions',
      ).then(async (action) => {
        if (action === 'Open Extensions') {
          await execSearch('workbench.extensions.search', 'hidale.gpg-bridge');
        }
      });
    }
    throw error;
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  outputChannel = vscode.window.createOutputChannel('GPG Bridge Request');
  const requestVersion = context.extension.packageJSON.version as string;

  // This extension is the remote (Linux/macOS) half of the bridge.
  // The os field in package.json prevents marketplace installs on win32, but
  // local VSIX installs bypass that check. Guard at runtime so nothing starts.
  if (process.platform === 'win32') {
    const msg =
      'GPG Bridge Request is inactive. It can only be installed on a Linux/macOS remote (dev container, SSH, WSL).';
    outputChannel.appendLine(msg);
    void vscode.window.showErrorMessage(msg);
    return;
  }

  try {
    outputChannel.appendLine(`Remote context (${vscode.env.remoteName}) activated`);

    // Register commands
    context.subscriptions.push(
      vscode.commands.registerCommand('gpg-bridge-request.start', startRequestProxy),
      vscode.commands.registerCommand('gpg-bridge-request.stop', stopRequestProxy),
      vscode.commands.registerCommand(
        'gpg-bridge-request.syncPublicKeys',
        async (filter?: KeyFilter) => {
          await publicKeySyncService?.syncPublicKeys(filter);
        },
      ),
      outputChannel,
    );

    // Integration test helper commands — only registered when integration tests are running
    // without a configured GNUPGHOME (e.g. Phase 2 and Phase 5 runners).
    if (isIntegrationTestEnvironment() && !process.env.GNUPGHOME) {
      context.subscriptions.push(
        // Returns the socket path that the GPG Bridge Request is listening on, or null if not running.
        // Tests connect to the proxy socket directly via AssuanSocketClient and need the socket
        // path via this command. Phase 3 sets GNUPGHOME so gpg finds the socket
        // at $GNUPGHOME/S.gpg-agent naturally; this command is not needed and must not be registered there.
        vscode.commands.registerCommand('_gpg-bridge-request.test.getSocketPath', () => {
          return requestProxyService?.getSocketPath() ?? null;
        }),
      );
    }

    // Start GPG Bridge Request on remote
    // isIntegrationTestEnvironment() overrides isTestEnvironment() so integration
    // tests get full extension initialization (unit tests still skip init).
    if (!isTestEnvironment() || isIntegrationTestEnvironment()) {
      await runVersionCheck(requestVersion);
      void startPublicKeySync(); // fire and forget
      await startRequestProxy();
    }
  } catch (error) {
    const message = extractErrorMessage(error);
    outputChannel.appendLine(`Error: ${message}`);
    outputChannel.show(true);
  }
}

// Export public keys from the agent and import remotely on the request
// Run once on extension activation, should not re-run on request stop/restart
async function startPublicKeySync(): Promise<void> {
  if (publicKeySyncService) {
    return;
  }

  try {
    // Create a log callback that respects the debugLogging setting
    const config = vscode.workspace.getConfiguration('gpgBridgeRequest');
    const debugLogging = config.get<boolean>('debugLogging') ?? false;
    const logCallback = debugLogging
      ? (message: string) => outputChannel.appendLine(message)
      : undefined;

    // Create the service and start auto-syncing with the current filter config
    publicKeySyncService = new PublicKeySync({ logCallback });
    const autoSyncFilter = config.get<KeyFilter | ''>('autoSyncPublicKeys') ?? '';
    void publicKeySyncService.autoSync(autoSyncFilter);
  } catch (error) {
    const message = `Failed to start public key sync: ${extractErrorMessage(error)}`;
    outputChannel.appendLine(message);
    outputChannel.show(true);
    vscode.window.showErrorMessage(message);
    throw error;
  }
}

async function startRequestProxy(): Promise<void> {
  if (requestProxyService) {
    outputChannel.appendLine('GPG Bridge Request already running');
    return;
  }

  try {
    outputChannel.appendLine('Starting GPG Bridge Request...');

    // Create a log callback that respects the debugLogging setting
    const config = vscode.workspace.getConfiguration('gpgBridgeRequest');
    const debugLogging = config.get<boolean>('debugLogging') ?? false;
    const logCallback = debugLogging
      ? (message: string) => outputChannel.appendLine(message)
      : undefined;
    const gpgBinDir = config.get<string>('gpgBinDir') ?? '';

    // GpgCli.gpgconfListDirs() resolves the socket path at start() time, so no
    // socket path override is needed here. Both Phase 2 (no GNUPGHOME — defaults
    // to ~/.gnupg) and Phase 3 (GNUPGHOME=/tmp/gpg-test-phase3) work
    // transparently because the base devcontainer image has gnupg2 pre-installed.
    requestProxyService = new RequestProxy(
      {
        logCallback: logCallback,
      },
      {
        commandExecutor: new VSCodeCommandExecutor(),
        gpgCliFactory: { create: () => new GpgCli({ gpgBinDir: gpgBinDir || undefined }) },
      },
    );
    await requestProxyService.start();

    outputChannel.appendLine('GPG Bridge Request is READY');
  } catch (error) {
    const message = extractErrorMessage(error);
    outputChannel.appendLine(`Failed to start GPG Bridge Request: ${message}`);
    outputChannel.show(true);
    vscode.window.showErrorMessage(`Failed to start GPG Bridge Request: ${message}`);
    throw error;
  }
}

async function stopRequestProxy(): Promise<void> {
  if (!requestProxyService) {
    outputChannel.appendLine('GPG Bridge Request is not running');
    return;
  }

  try {
    outputChannel.appendLine('Stopping GPG Bridge Request...');
    await requestProxyService.stop();
    requestProxyService = null;
    outputChannel.appendLine('GPG Bridge Request stopped');
  } catch (error) {
    const message = extractErrorMessage(error);
    outputChannel.appendLine(`Error stopping GPG Bridge Request: ${message}`);
    outputChannel.show(true);
  }
}

export function deactivate(): Promise<void> | undefined {
  return requestProxyService?.stop();
}
