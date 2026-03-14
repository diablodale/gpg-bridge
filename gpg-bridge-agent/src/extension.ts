/**
 * GPG Bridge Agent VS Code Extension
 *
 * This extension implements the local "agent" side of the GPG Bridge architecture:
 * it connects to the gpg-agent extra socket, proxies commands from the request
 * extension, and returns responses. It also provides a command to export public
 * keys for the request extension to sync public keys to the remote side.
 *
 * It activates automatically on startup and runs in the background, showing status
 * in the status bar and output channel.
 */

import * as os from 'os';
import * as vscode from 'vscode';
import { AgentProxy } from './services/agentProxy';
import {
  GpgCli,
  isTestEnvironment,
  isIntegrationTestEnvironment,
  extractErrorMessage,
} from '@gpg-bridge/shared';
import type { VersionCheckResult } from '@gpg-bridge/shared';
import type { KeyFilter } from '@gpg-bridge/shared';

// Global GPG Bridge Agent service instance
let agentProxyService: AgentProxy | null = null;
let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;
let extensionVersion: string | null = null;

/**
 * Pure version-compatibility check called by the request extension via
 * `_gpg-bridge-agent.checkVersion`. No VS Code API calls, no logging.
 *
 * Returns a `VersionCheckResult` plain object rather than throwing so the result
 * survives VS Code command tunnel serialization without corruption.
 */
export function checkVersionHandler(
  agentVersion: string,
  remoteVersion: string,
): VersionCheckResult {
  if (remoteVersion === agentVersion) {
    return { match: true };
  }
  return { match: false, agentVersion, requestVersion: remoteVersion };
}

// This method is called when your extension is activated
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  outputChannel = vscode.window.createOutputChannel('GPG Bridge Agent');
  const agentVersion = context.extension.packageJSON.version as string;
  extensionVersion = agentVersion;
  statusBarItem = vscode.window.createStatusBarItem(
    context.extension.id,
    vscode.StatusBarAlignment.Right,
    100,
  );

  // Register three command handlers for inter-extension communication
  context.subscriptions.push(
    // ── Trust model for internal commands ──────────────────────────────────
    // The underscore prefix is the VS Code convention for "internal" commands:
    // it hides them from the command palette so users don't see them, but it
    // does NOT restrict which extensions can call them. Any co-installed VS Code
    // extension running in the same extension host can invoke these commands via
    // vscode.commands.executeCommand('_gpg-bridge-agent.*', ...).
    //
    // This is an accepted architectural constraint for the single-user
    // dev-container scenario this extension targets. The practical mitigations are:
    //   1. Each handler throws (rejects) when agentProxyService === null, so
    //      commands called before activation or after deactivation are rejected.
    //   2. The bridge connects only to agent-extra-socket, where gpg-agent itself
    //      enforces command restrictions — returning ERR 67109115 Forbidden for
    //      sensitive operations (PRESET_PASSPHRASE, CLEAR_PASSPHRASE, etc.).
    //   3. On startup, AgentProxy.start() actively verifies the socket IS the extra
    //      socket by sending GETEVENTCOUNTER and asserting ERR Forbidden. This
    //      command has been forbidden on the extra socket since GnuPG 2.1.
    //      If it succeeds (standard socket or renamed/linked substitute), startup
    //      is aborted. This is a pure read — no gpg-agent state is modified.
    //   4. All operations require a caller-provided sessionId that maps to an
    //      active session; unknown sessionIds are silently ignored or rejected.
    //   5. `_gpg-bridge-agent.checkVersion` is a pure synchronous check that
    //      throws VersionMismatchError on mismatch. It carries no secrets and cannot
    //      modify agent state.
    // ────────────────────────────────────────────────────────────────────────

    // Internal commands called by request-proxy extension, hidden from user with underscore prefix
    vscode.commands.registerCommand('_gpg-bridge-agent.checkVersion', (v: string) =>
      checkVersionHandler(agentVersion, v),
    ),
    vscode.commands.registerCommand('_gpg-bridge-agent.connectAgent', connectAgent),
    vscode.commands.registerCommand('_gpg-bridge-agent.sendCommands', sendCommands),
    vscode.commands.registerCommand('_gpg-bridge-agent.disconnectAgent', disconnectAgent),
    vscode.commands.registerCommand('_gpg-bridge-agent.exportPublicKeys', exportPublicKeysCommand),
    // UI commands visible to user
    vscode.commands.registerCommand('gpg-bridge-agent.start', startAgentProxy),
    vscode.commands.registerCommand('gpg-bridge-agent.stop', stopAgentProxy),
    vscode.commands.registerCommand('gpg-bridge-agent.showStatus', showStatus),
    outputChannel,
    statusBarItem,
    // Handle vscode://hidale.gpg-bridge-agent/... URIs
    vscode.window.registerUriHandler({
      handleUri(uri: vscode.Uri): void {
        const path = uri.path.toLowerCase();
        if (path === '/showstatus') {
          void vscode.commands.executeCommand('gpg-bridge-agent.showStatus');
        } else if (path === '/showaboutdialog') {
          void vscode.commands.executeCommand('workbench.action.showAboutDialog');
        }
      },
    }),
  );

  // Update status bar
  statusBarItem.name = 'GPG Bridge Agent';
  statusBarItem.command = 'gpg-bridge-agent.showStatus';
  updateStatusBar();
  statusBarItem.show();

  // Start GPG Bridge Agent (detects GnuPG bin dir, resolves socket path, and runs the
  // extra-socket probe — all inside start()). Throws on any failure.
  // isIntegrationTestEnvironment() overrides isTestEnvironment() so integration
  // tests get full extension initialization (unit tests still skip init).
  if (!isTestEnvironment() || isIntegrationTestEnvironment()) {
    try {
      await startAgentProxy();
    } catch (error: unknown) {
      // startAgentProxy() logs, shows its own error dialog, and cleans up agentProxyService
      outputChannel.appendLine(`Start failed: ${extractErrorMessage(error)}`);
    }
  }
}

export function deactivate() {
  return agentProxyService?.stop();
}

// TODO Issue Reporting as defined at https://code.visualstudio.com/api/get-started/wrapping-up#issue-reporting

// ==============================================================================
// Command handlers for inter-extension communication
// ==============================================================================

/**
 * Command: _gpg-bridge-agent.exportPublicKeys
 *
 * Called by request-proxy (or for manual use) to export public keys from the GPG keyring.
 * Returns the exported key data as an ASCII-armored string, or undefined if nothing was exported.
 */
async function exportPublicKeysCommand(filter?: KeyFilter): Promise<string | undefined> {
  if (!agentProxyService) {
    throw new Error('GPG Bridge Agent not initialized. Please start the extension.');
  }

  // TODO updateStatusBar to indicate export in progress
  try {
    return await agentProxyService.exportPublicKeys(filter);
  } catch (error) {
    const msg = extractErrorMessage(error);
    outputChannel.appendLine(`[exportPublicKeys] Error: ${msg}`);
    throw error;
  }
}

/**
 * Command: _gpg-agent-proxy.connectAgent
 *
 * Called by request-proxy to establish a connection to gpg-agent.
 * Returns a sessionId and greeting that must be relayed to the client.
 */
async function connectAgent(sessionId?: string): Promise<{ sessionId: string; greeting: string }> {
  if (!agentProxyService) {
    throw new Error('GPG Bridge Agent not initialized. Please start the extension.');
  }

  try {
    return await agentProxyService.connectAgent(sessionId);
  } catch (error) {
    const msg = extractErrorMessage(error);
    outputChannel.appendLine(`[connectAgent] Error: ${msg}`);
    throw error;
  }
}

/**
 * Command: _gpg-agent-proxy.sendCommands
 *
 * Called by request-proxy to send a command block to gpg-agent.
 * commandBlock: complete command (e.g., "GETINFO version\n" or "D data\nEND\n")
 * Returns the complete response from gpg-agent.
 */
async function sendCommands(
  sessionId: string,
  commandBlock: string,
): Promise<{ response: string }> {
  if (!agentProxyService) {
    throw new Error('GPG Bridge Agent not initialized. Please start the extension.');
  }

  try {
    return await agentProxyService.sendCommands(sessionId, commandBlock);
  } catch (error) {
    const msg = extractErrorMessage(error);
    outputChannel.appendLine(`[sendCommands] Session ${sessionId}: Error: ${msg}`);
    throw error;
  }
}

/**
 * Command: _gpg-agent-proxy.disconnectAgent
 *
 * Called by request-proxy to close a session.
 * sessionId: the session to disconnect
 */
async function disconnectAgent(sessionId: string): Promise<void> {
  if (!agentProxyService) {
    throw new Error('GPG Bridge Agent not initialized.');
  }

  try {
    await agentProxyService.disconnectAgent(sessionId);
  } catch (error) {
    const msg = extractErrorMessage(error);
    outputChannel.appendLine(`[disconnectAgent] Session ${sessionId}: Error: ${msg}`);
    throw error;
  }
}

// ==============================================================================
// UI command handlers
// ==============================================================================

/**
 * Start the GPG Bridge Agent service
 */
async function startAgentProxy(): Promise<void> {
  if (isTestEnvironment() && !isIntegrationTestEnvironment()) {
    return;
  }
  if (agentProxyService) {
    vscode.window.showWarningMessage('GPG Bridge Agent already running');
    return;
  }

  try {
    outputChannel.appendLine('Starting GPG Bridge Agent...');

    const config = vscode.workspace.getConfiguration('gpgBridgeAgent');
    const gpgBinDir = config.get<string>('gpgBinDir') ?? '';
    const debugLogging = config.get<boolean>('debugLogging') ?? false;
    const logCallback = debugLogging
      ? (message: string) => outputChannel.appendLine(message)
      : undefined;

    agentProxyService = new AgentProxy(
      { logCallback, statusBarCallback: () => updateStatusBar() },
      { gpgCliFactory: { create: () => new GpgCli({ gpgBinDir: gpgBinDir || undefined }) } },
    );
    await agentProxyService.start();

    // start() includes the extra-socket probe — reaching here means probe succeeded
    updateStatusBar();
    outputChannel.appendLine('GPG Bridge Agent is READY');
  } catch (error) {
    const errorMessage = extractErrorMessage(error);
    outputChannel.appendLine(`Error starting GPG Bridge Agent: ${errorMessage}`);
    outputChannel.show(true);
    vscode.window.showErrorMessage(`Failed to start GPG Bridge Agent: ${errorMessage}`);
    await agentProxyService?.stop(); // clean any partially-initialized resources before we discard the instance
    agentProxyService = null;
    throw error;
  }
}

/**
 * Stop the GPG Bridge Agent service
 */
async function stopAgentProxy(): Promise<void> {
  if (!agentProxyService) {
    vscode.window.showInformationMessage('GPG Bridge Agent is not running');
    return;
  }

  outputChannel.appendLine('Stopping GPG Bridge Agent...');
  await agentProxyService.stop();
  agentProxyService = null;

  updateStatusBar();
  outputChannel.appendLine('GPG Bridge Agent stopped');
  vscode.window.showInformationMessage('GPG Bridge Agent stopped');
}

/**
 * Show GPG Bridge Agent status
 */
async function showStatus(): Promise<void> {
  const gpgBinDir = agentProxyService?.getGpgBinDir() ?? '(unknown)';
  const agentSocket = agentProxyService?.getSocketPath() ?? '(unknown)';
  const gpgVersion = (await agentProxyService?.getGpgVersion().catch(() => null)) ?? '(unknown)';

  let state = 'Inactive';
  let sessionCount = 0;
  if (agentProxyService) {
    sessionCount = agentProxyService.getSessionCount();
    state = sessionCount > 0 ? 'Active' : 'Ready';
  }

  const status = [
    'GPG Bridge Agent Status',
    `State: ${state}${sessionCount > 0 ? ` (${sessionCount} session${sessionCount > 1 ? 's' : ''})` : ''}`,
    `Version: ${extensionVersion ?? '(unknown)'}`,
    `OS: ${os.platform()} ${os.arch()} ${os.release()}`,
    `GPG version: ${gpgVersion}`,
    `GPG bin dir: ${gpgBinDir}`,
    `GPG socket: ${agentSocket}`,
  ].join('\n');

  const copyItem: vscode.MessageItem = { title: 'Copy' };
  const okItem: vscode.MessageItem = { title: 'OK', isCloseAffordance: true };
  const result = await vscode.window.showInformationMessage(
    status,
    { modal: true },
    copyItem,
    okItem,
  );
  if (result === copyItem) {
    await vscode.env.clipboard.writeText(status);
  }
}

/**
 * Update the status bar item
 */
function updateStatusBar(): void {
  let icon = '$(circle-slash)';
  let tooltip = 'GPG Bridge Agent is not ready';

  if (agentProxyService) {
    const sessionCount = agentProxyService.getSessionCount();
    if (sessionCount > 0) {
      icon = '$(sync~spin)';
      tooltip = `GPG Bridge Agent is active with ${sessionCount} session${sessionCount > 1 ? 's' : ''}`;
    } else {
      icon = '$(check)';
      tooltip = 'GPG Bridge Agent is ready';
    }
  }

  statusBarItem.text = `${icon} GPG`;
  statusBarItem.tooltip = tooltip;
  statusBarItem.accessibilityInformation = {
    label: tooltip,
  };
}
