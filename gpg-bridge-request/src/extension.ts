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
import { extractErrorMessage } from '@gpg-bridge/shared';
import type { KeyFilter } from '@gpg-bridge/shared';
import { VSCodeCommandExecutor } from './services/commandExecutor';
import { isTestEnvironment, isIntegrationTestEnvironment } from '@gpg-bridge/shared';

let requestProxyService: RequestProxy | null = null;
let publicKeySyncService: PublicKeySync | null = null;
let outputChannel: vscode.OutputChannel;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    outputChannel = vscode.window.createOutputChannel('GPG Bridge Request');

    // This extension is the remote (Linux/macOS) half of the bridge.
    // The os field in package.json prevents marketplace installs on win32, but
    // local VSIX installs bypass that check. Guard at runtime so nothing starts.
    if (process.platform === 'win32') {
        const msg = 'GPG Bridge Request is inactive. It can only be installed on a Linux/macOS remote (dev container, SSH, WSL).';
        outputChannel.appendLine(msg);
        void vscode.window.showErrorMessage(msg);
        return;
    }

    try {
        outputChannel.appendLine(`Remote context (${vscode.env.remoteName}) activated`);

        // Register commands
        context.subscriptions.push(
            vscode.commands.registerCommand('gpg-bridge-request.start', async () => {
                await startRequestProxy();
            }),
            vscode.commands.registerCommand('gpg-bridge-request.stop', async () => {
                await stopRequestProxy();
            }),
            vscode.commands.registerCommand('gpg-bridge-request.syncPublicKeys', async (filter?: KeyFilter) => {
                await publicKeySyncService?.syncPublicKeys(filter);
            }),
            outputChannel
        );

        // Integration test helper commands — only registered when integration tests are running
        // without a configured GNUPGHOME (e.g. Phase 2 and Phase 5 runners).
        if (isIntegrationTestEnvironment() && !process.env.GNUPGHOME) {
            context.subscriptions.push(
                // Returns the socket path that the request proxy is listening on, or null if not running.
                // Tests connect to the proxy socket directly via AssuanSocketClient and need the socket
                // path via this command. Phase 3 sets GNUPGHOME so gpg finds the socket
                // at $GNUPGHOME/S.gpg-agent naturally; this command is not needed and must not be registered there.
                vscode.commands.registerCommand('_gpg-bridge-request.test.getSocketPath', () => {
                    return requestProxyService?.getSocketPath() ?? null;
                })
            );
        }

        // Start request proxy on remote
        // isIntegrationTestEnvironment() overrides isTestEnvironment() so integration
        // tests get full extension initialization (unit tests still skip init).
        if (!isTestEnvironment() || isIntegrationTestEnvironment()) {
            try {
                void startPublicKeySync(); // fire and forget
                await startRequestProxy();
            } catch (err) {
                // Error already logged by handler, but show output
                outputChannel.show();
            }
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
        const debugLogging = config.get<boolean>('debugLogging') || true;   // TODO remove forced debug logging
        const logCallback = debugLogging ? (message: string) => outputChannel.appendLine(message) : undefined;

        // Create the service and start auto-syncing with the current filter config
        publicKeySyncService = new PublicKeySync({ logCallback });
        const autoSyncFilter = config.get<KeyFilter | ''>('autoSyncPublicKeys') ?? '';
        void publicKeySyncService.autoSync(autoSyncFilter);
    } catch (error) {
        const message = `Failed to start public key sync: ${extractErrorMessage(error)}`;
        outputChannel.appendLine(message);
        outputChannel.show(true);
        vscode.window.showErrorMessage(message);
        throw error
    }
}

async function startRequestProxy(): Promise<void> {
    if (requestProxyService) {
        outputChannel.appendLine('Request proxy already running');
        return;
    }

    try {
        outputChannel.appendLine('Starting request proxy...');

        // Create a log callback that respects the debugLogging setting
        const config = vscode.workspace.getConfiguration('gpgBridgeRequest');
        const debugLogging = config.get<boolean>('debugLogging') || true;   // TODO remove forced debug logging
        const logCallback = debugLogging ? (message: string) => outputChannel.appendLine(message) : undefined;

        // GpgCli.gpgconfListDirs() resolves the socket path at start() time, so no
        // path override is needed here. Both Phase 2 (no GNUPGHOME — defaults to
        // ~/.gnupg) and Phase 3 (GNUPGHOME=/tmp/gpg-test-phase3) work transparently
        // because the base devcontainer image has gnupg2 pre-installed.
        requestProxyService = new RequestProxy({
            logCallback: logCallback
        }, {
            commandExecutor: new VSCodeCommandExecutor()
        });
        await requestProxyService.start();

        outputChannel.appendLine('Request proxy is READY');
    } catch (error) {
        const message = extractErrorMessage(error);
        outputChannel.appendLine(`Failed to start request proxy: ${message}`);
        outputChannel.show(true);
        vscode.window.showErrorMessage(`Failed to start request proxy: ${message}`);
        throw error;
    }
}

async function stopRequestProxy(): Promise<void> {
    if (!requestProxyService) {
        outputChannel.appendLine('Request proxy is not running');
        return;
    }

    try {
        outputChannel.appendLine('Stopping request proxy...');
        await requestProxyService.stop();
        requestProxyService = null;
        outputChannel.appendLine('Request proxy stopped');
    } catch (error) {
        const message = extractErrorMessage(error);
        outputChannel.appendLine(`Error stopping request proxy: ${message}`);
        outputChannel.show(true);
    }
}

export function deactivate(): Promise<void> | undefined {
    return requestProxyService?.stop();
}


